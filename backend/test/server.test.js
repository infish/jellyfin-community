import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { buildServer } from '../src/server.js';
import { Upstreams } from '../src/upstreams.js';

function setup(start = 1_700_000_000_000) {
    let now = start;
    const store = new Store(':memory:', () => now);
    const app = buildServer({ config: { databasePath: ':memory:', mockUpstreams: true, liveCompatibilityVerified: false, presenceEnabled: true, boardEnabled: true, requestsEnabled: true }, store, logger: false });
    const call = (method, url, token = 'requester-token', payload) => app.inject({ method, url, headers: { authorization: `Bearer ${token}`, origin: 'http://localhost', host: 'localhost' }, payload });
    return { app, store, call, advance: ms => { now += ms; } };
}

test('avatar gateway authenticates callers and resolves the stored message author', async t => {
    const { app, call } = setup(); t.after(() => app.close());
    const anonymous = await app.inject({ method: 'GET', url: '/api/community/messages/unknown/avatar' });
    assert.equal(anonymous.statusCode, 401);
    assert.equal((await call('GET', '/api/community/messages/unknown/avatar')).statusCode, 404);
    let fetched;
    const upstream = new Upstreams({ jellyfinUrl: 'http://jellyfin', upstreamTimeoutMs: 1000 }, async (url, options) => {
        fetched = { url, options };
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
    });
    const image = await upstream.avatar('author-id', 'Bearer example-token');
    assert.equal(image.type, 'image/png');
    assert.equal(fetched.url, 'http://jellyfin/Users/author-id/Images/Primary?width=80&height=80');
    assert.equal(fetched.options.redirect, 'manual');
    assert.ok(fetched.options.headers.Authorization.includes('example-token'));
    assert.ok(!fetched.url.includes('example-token'));
});

test('authentication is required and forged impersonation headers do not establish identity', async t => {
    const { app } = setup(); t.after(() => app.close());
    const missing = await app.inject({ method: 'GET', url: '/api/community/me', headers: { 'x-api-user': '1' } });
    assert.equal(missing.statusCode, 401);
    const invalid = await app.inject({ method: 'GET', url: '/api/community/me', headers: { authorization: 'Bearer invalid' } });
    assert.equal(invalid.statusCode, 401);
});

test('presence deduplicates users, expires on server time, and privacy removes all sessions', async t => {
    const { app, call, advance } = setup(); t.after(() => app.close());
    await call('PUT', '/api/community/presence/heartbeat', 'requester-token', { sessionId: 'aaaaaaaaaaaaaaaa' });
    await call('PUT', '/api/community/presence/heartbeat', 'requester-token', { sessionId: 'bbbbbbbbbbbbbbbb' });
    let list = await call('GET', '/api/community/presence');
    assert.equal(list.json().users.length, 1);
    await call('PUT', '/api/community/presence/preference', 'requester-token', { visible: false });
    list = await call('GET', '/api/community/presence');
    assert.equal(list.json().users.length, 0);
    const hiddenAvatar = await call('GET', '/api/community/presence/requester/avatar');
    assert.equal(hiddenAvatar.statusCode, 404);
    const hidden = await call('PUT', '/api/community/presence/heartbeat', 'requester-token', { sessionId: 'cccccccccccccccc' });
    assert.equal(hidden.json().visible, false);
    await call('PUT', '/api/community/presence/preference', 'requester-token', { visible: true });
    await call('PUT', '/api/community/presence/heartbeat', 'requester-token', { sessionId: 'dddddddddddddddd' });
    advance(90_001);
    list = await call('GET', '/api/community/presence');
    assert.equal(list.json().users.length, 0);
});

test('board stores text literally, rate limits, and enforces deletion ownership', async t => {
    const { app, call } = setup(); t.after(() => app.close());
    const created = await call('POST', '/api/community/messages', 'requester-token', { body: '<img src=x onerror=alert(1)>' });
    assert.equal(created.statusCode, 201);
    const message = created.json();
    const listed = await call('GET', '/api/community/messages', 'trusted-token');
    assert.equal(listed.json().items[0].body, '<img src=x onerror=alert(1)>');
    const forbidden = await call('DELETE', `/api/community/messages/${message.id}`, 'trusted-token');
    assert.equal(forbidden.statusCode, 403);
    const removed = await call('DELETE', `/api/community/messages/${message.id}`, 'admin-token');
    assert.equal(removed.statusCode, 200);
    for (let i = 0; i < 5; i++) await call('POST', '/api/community/messages', 'trusted-token', { body: `message ${i}` });
    const limited = await call('POST', '/api/community/messages', 'trusted-token', { body: 'one too many' });
    assert.equal(limited.statusCode, 429);
});

test('restricted discovery is server-side and request roles and idempotency are preserved', async t => {
    const { app, call } = setup(); t.after(() => app.close());
    const restricted = await call('GET', '/api/community/requests/details/movie/603', 'restricted-token');
    assert.equal(restricted.statusCode, 403);
    const restrictedArtwork = await call('GET', '/api/community/requests/artwork?path=%2Fposter.jpg', 'restricted-token');
    assert.equal(restrictedArtwork.statusCode, 403);
    const key = 'aaaaaaaaaaaaaaaaaaaa';
    const pending = await call('POST', '/api/community/requests', 'requester-token', { mediaType: 'movie', mediaId: 603, seasons: [], idempotencyKey: key });
    assert.equal(pending.statusCode, 201);
    assert.equal(pending.json().state, 'Awaiting approval');
    const repeated = await call('POST', '/api/community/requests', 'requester-token', { mediaType: 'movie', mediaId: 603, seasons: [], idempotencyKey: key });
    assert.equal(repeated.statusCode, 200);
    assert.deepEqual(repeated.json(), pending.json());
    const changed = await call('POST', '/api/community/requests', 'requester-token', { mediaType: 'movie', mediaId: 604, seasons: [], idempotencyKey: key });
    assert.equal(changed.statusCode, 409);
    const approved = await call('POST', '/api/community/requests', 'trusted-token', { mediaType: 'tv', mediaId: 1399, seasons: [2], idempotencyKey: 'bbbbbbbbbbbbbbbbbbbb' });
    assert.equal(approved.statusCode, 201);
    assert.equal(approved.json().state, 'Approved; awaiting availability');
});
