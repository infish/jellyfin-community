import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config as defaultConfig } from './config.js';
import { Store } from './store.js';
import { Upstreams } from './upstreams.js';

const cleanText = value => typeof value === 'string' ? value.trim() : '';
const codePoints = value => [...value].length;
const minimalSearch = item => ({ id: item.id, mediaType: item.mediaType, title: item.title || item.name || 'Untitled', year: Number((item.releaseDate || item.firstAirDate || '').slice(0, 4)) || null, posterUrl: item.posterPath ? `/api/community/requests/artwork?path=${encodeURIComponent(item.posterPath)}` : null });

export function buildServer(overrides = {}) {
    const config = { ...defaultConfig, ...overrides.config };
    const app = Fastify({ logger: overrides.logger ?? { redact: ['req.headers.authorization', 'req.headers.x-api-key', 'req.headers.x-api-user'] }, bodyLimit: 32 * 1024, trustProxy: config.trustProxy });
    const store = overrides.store || new Store(config.databasePath);
    const upstreams = overrides.upstreams || new Upstreams(config, overrides.fetch);
    const rateBuckets = new Map();

    app.decorateRequest('communityUser', null);
    app.addHook('onRequest', async request => {
        if (!request.url.startsWith('/api/community/') || request.url === '/api/community/health') return;
        if (request.headers.origin) {
            const forwarded = request.headers['x-forwarded-host'];
            const expected = forwarded || request.headers.host;
            if (new URL(request.headers.origin).host !== expected) throw Object.assign(new Error('Cross-origin request rejected'), { statusCode: 403 });
        }
        delete request.headers['x-api-key'];
        delete request.headers['x-api-user'];
        request.communityUser = await upstreams.authenticate(request.headers.authorization);
    });
    app.addHook('preHandler', async request => {
        if (!request.communityUser) return;
        const now = Date.now();
        const key = request.communityUser.id;
        const bucket = rateBuckets.get(key);
        if (!bucket || now - bucket.startedAt >= 60_000) {
            rateBuckets.set(key, { startedAt: now, count: 1 });
        } else if (++bucket.count > 120) {
            throw Object.assign(new Error('Request limit reached; try again in a minute'), { statusCode: 429 });
        }
    });

    app.get('/api/community/health', async () => ({ status: 'ok', features: { presence: config.presenceEnabled, board: config.boardEnabled, requests: config.requestsEnabled && (config.mockUpstreams || config.liveCompatibilityVerified) } }));
    app.get('/api/community/me', async request => ({ id: request.communityUser.id, name: request.communityUser.name, isAdmin: request.communityUser.isAdmin, presenceVisible: store.presenceVisible(request.communityUser.id), discoveryEligible: upstreams.isDiscoveryEligible(request.communityUser), adminUrl: request.communityUser.isAdmin ? config.publicSeerrUrl || null : null }));

    const requireFeature = (enabled, name) => { if (!enabled) throw Object.assign(new Error(`${name} is disabled`), { statusCode: 503 }); };
    const requireDiscovery = user => { requireFeature(config.requestsEnabled && (config.mockUpstreams || config.liveCompatibilityVerified), 'Requests'); if (!upstreams.isDiscoveryEligible(user)) throw Object.assign(new Error('External discovery is unavailable for this account'), { statusCode: 403 }); };

    app.put('/api/community/presence/heartbeat', async request => {
        requireFeature(config.presenceEnabled, 'Presence');
        const sessionId = cleanText(request.body?.sessionId);
        if (!/^[a-zA-Z0-9_-]{16,96}$/.test(sessionId)) throw Object.assign(new Error('Invalid session ID'), { statusCode: 400 });
        return { visible: store.setPresence(request.communityUser, sessionId), expiresIn: 90 };
    });
    app.delete('/api/community/presence/session/:id', async request => { requireFeature(config.presenceEnabled, 'Presence'); store.removeSession(request.communityUser.id, request.params.id); return { ok: true }; });
    app.get('/api/community/presence', async () => { requireFeature(config.presenceEnabled, 'Presence'); return { users: store.listPresence() }; });
    app.get('/api/community/presence/:id/avatar', async (request, reply) => {
        requireFeature(config.presenceEnabled, 'Presence');
        if (!store.listPresence().some(user => user.id === request.params.id)) return reply.code(404).send({ error: 'Profile picture unavailable' });
        const avatar = await upstreams.avatar(request.params.id, request.headers.authorization);
        return reply.header('Cache-Control', 'private, no-store').type(avatar.type).send(avatar.body);
    });
    app.put('/api/community/presence/preference', async request => { requireFeature(config.presenceEnabled, 'Presence'); if (typeof request.body?.visible !== 'boolean') throw Object.assign(new Error('visible must be boolean'), { statusCode: 400 }); store.setPresenceVisible(request.communityUser.id, request.body.visible); return { visible: request.body.visible }; });

    app.get('/api/community/messages', async request => { requireFeature(config.boardEnabled, 'Board'); const cursor = cleanText(request.query?.cursor); if (cursor && !/^\d+:[0-9a-f-]{36}$/.test(cursor)) throw Object.assign(new Error('Invalid cursor'), { statusCode: 400 }); return store.listMessages(cursor || null); });
    app.get('/api/community/messages/:id/avatar', async (request, reply) => {
        requireFeature(config.boardEnabled, 'Board');
        const authorId = store.messageAuthor(request.params.id);
        if (!authorId) return reply.code(404).send({ error: 'Profile picture unavailable' });
        const avatar = await upstreams.avatar(authorId, request.headers.authorization);
        return reply.header('Cache-Control', 'private, no-store').type(avatar.type).send(avatar.body);
    });
    app.post('/api/community/messages', async (request, reply) => { requireFeature(config.boardEnabled, 'Board'); const body = cleanText(request.body?.body); if (!body || codePoints(body) > 500) throw Object.assign(new Error('Message must be 1–500 characters'), { statusCode: 400 }); const item = store.createMessage(request.communityUser, body); if (!item) throw Object.assign(new Error('Post limit reached; try again in a minute'), { statusCode: 429 }); return reply.code(201).send(item); });
    app.delete('/api/community/messages/:id', async (request, reply) => { requireFeature(config.boardEnabled, 'Board'); const result = store.deleteMessage(request.communityUser, request.params.id); if (result === 'missing') return reply.code(404).send({ error: 'Message not found' }); if (result === 'forbidden') return reply.code(403).send({ error: 'Not permitted' }); return { ok: true }; });

    app.get('/api/community/requests/search', async request => { requireDiscovery(request.communityUser); const q = cleanText(request.query?.q); const page = Math.max(1, Math.min(50, Number(request.query?.page || 1))); if (q.length < 2 || q.length > 100) throw Object.assign(new Error('Search must be 2–100 characters'), { statusCode: 400 }); const mapped = await upstreams.mappedUser(request.communityUser); const data = await upstreams.search(mapped, q, page); return { page: data.page || page, totalPages: data.totalPages || 1, items: (data.results || []).filter(x => ['movie', 'tv'].includes(x.mediaType)).map(minimalSearch) }; });
    app.get('/api/community/requests/artwork', async (request, reply) => {
        requireDiscovery(request.communityUser);
        const path = cleanText(request.query?.path);
        if (!/^\/[a-zA-Z0-9_./-]{1,300}$/.test(path) || path.includes('..')) throw Object.assign(new Error('Invalid artwork path'), { statusCode: 400 });
        const mapped = await upstreams.mappedUser(request.communityUser);
        const artwork = await upstreams.artwork(mapped, path);
        reply.header('Cache-Control', 'private, max-age=300').type(artwork.type).send(artwork.body);
    });
    app.get('/api/community/requests/details/:type/:id', async request => { requireDiscovery(request.communityUser); if (!['movie', 'tv'].includes(request.params.type) || !/^\d+$/.test(request.params.id)) throw Object.assign(new Error('Invalid title'), { statusCode: 400 }); const mapped = await upstreams.mappedUser(request.communityUser); return upstreams.details(mapped, request.params.type, Number(request.params.id)); });
    app.get('/api/community/requests/mine', async request => { requireDiscovery(request.communityUser); const mapped = await upstreams.mappedUser(request.communityUser); const data = await upstreams.myRequests(mapped, Math.max(1, Number(request.query?.page || 1))); return { pageInfo: data.pageInfo || {}, items: (data.results || []).map(x => ({ id: x.id, createdAt: x.createdAt, type: x.type, status: x.status, mediaStatus: x.media?.status ?? 0, title: x.media?.title || x.media?.name || null })) }; });
    app.post('/api/community/requests', async (request, reply) => {
        requireDiscovery(request.communityUser);
        const { mediaType, mediaId, seasons, idempotencyKey } = request.body || {};
        if (!['movie', 'tv'].includes(mediaType) || !Number.isInteger(mediaId) || mediaId <= 0 || !/^[a-zA-Z0-9_-]{16,96}$/.test(idempotencyKey || '')) throw Object.assign(new Error('Invalid request'), { statusCode: 400 });
        const chosen = mediaType === 'tv' ? [...new Set(Array.isArray(seasons) ? seasons : [])].filter(x => Number.isInteger(x) && x > 0).sort((a,b) => a-b) : [];
        if (mediaType === 'tv' && !chosen.length) throw Object.assign(new Error('Select at least one season'), { statusCode: 400 });
        const mapped = await upstreams.mappedUser(request.communityUser);
        if (!upstreams.canRequest(mapped, mediaType)) throw Object.assign(new Error('Seerr does not permit this request type'), { statusCode: 403 });
        const details = await upstreams.details(mapped, mediaType, mediaId);
        if (mediaType === 'tv' && chosen.some(n => !details.seasons.some(s => s.seasonNumber === n))) throw Object.assign(new Error('Invalid season selection'), { statusCode: 400 });
        const payload = { mediaType, mediaId, ...(mediaType === 'tv' ? { seasons: chosen } : {}), is4k: false };
        const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        const start = store.beginSubmission({ key: idempotencyKey, userId: request.communityUser.id, fingerprint, titleKey: `${mediaType}:${mediaId}:standard` });
        if (start.kind === 'conflict') return reply.code(409).send({ error: 'Idempotency key was used for different input' });
        if (start.kind === 'busy') return reply.code(409).send({ error: 'A request for this title is being reconciled' });
        if (start.kind === 'existing') return reply.code(start.row.state === 'complete' ? 200 : 409).send(start.row.response_json ? JSON.parse(start.row.response_json) : { error: `Submission is ${start.row.state}` });
        try {
            const result = await upstreams.submit(mapped, payload);
            const response = { requestId: result.id, state: Number(result.status) === 1 ? 'Awaiting approval' : 'Approved; awaiting availability' };
            store.finishSubmission(idempotencyKey, 'complete', response, result.id);
            return reply.code(201).send(response);
        } catch (error) {
            store.finishSubmission(idempotencyKey, error.name === 'AbortError' ? 'uncertain' : 'failed', { error: error.name === 'AbortError' ? 'Outcome uncertain; administrator reconciliation required' : 'Request failed' });
            throw error;
        }
    });

    app.setErrorHandler((error, request, reply) => {
        const status = Number(error.statusCode) >= 400 && Number(error.statusCode) < 600 ? Number(error.statusCode) : 500;
        if (status >= 500) request.log.error({ err: error, url: request.url }, 'request failed');
        reply.code(status).send({ error: status === 500 ? 'Service unavailable' : error.message });
    });
    app.addHook('onClose', () => store.close());
    return app;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const app = buildServer();
    await app.listen({ host: defaultConfig.host, port: defaultConfig.port });
}
