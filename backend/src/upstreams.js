const PERMISSIONS = {
    ADMIN: 2,
    REQUEST: 32,
    AUTO_APPROVE_MOVIE: 256,
    AUTO_APPROVE_TV: 512,
    REQUEST_MOVIE: 262144,
    REQUEST_TV: 524288
};

export class Upstreams {
    constructor(config, fetchImpl = fetch) {
        this.config = config;
        this.fetch = fetchImpl;
    }

    async json(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);
        try {
            const response = await this.fetch(url, { ...options, redirect: 'manual', signal: controller.signal });
            if (!response.ok) throw Object.assign(new Error(`Upstream returned ${response.status}`), { statusCode: response.status });
            return await response.json();
        } finally { clearTimeout(timer); }
    }

    async artwork(mapped, path) {
        if (this.config.mockUpstreams) return { body: Buffer.from('mock-poster'), type: 'image/jpeg' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);
        try {
            const response = await this.fetch(`${this.config.seerrUrl}/imageproxy/t/p/w300${path}`, {
                headers: this.seerrHeaders(mapped),
                redirect: 'manual',
                signal: controller.signal
            });
            const type = response.headers.get('content-type') || '';
            if (!response.ok || !type.startsWith('image/')) throw Object.assign(new Error('Artwork unavailable'), { statusCode: 404 });
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength > 2_000_000) throw Object.assign(new Error('Artwork too large'), { statusCode: 502 });
            return { body: Buffer.from(bytes), type };
        } finally { clearTimeout(timer); }
    }

    async avatar(authorId, header) {
        const raw = header.replace(/^Bearer\s+/i, '');
        const authorization = /^MediaBrowser\s/i.test(header) ? header : `MediaBrowser Client="Jellyfin Household", Device="Community Gateway", DeviceId="community-gateway", Version="0.1.0", Token="${raw.replace(/["\\]/g, '')}"`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);
        try {
            const response = await this.fetch(`${this.config.jellyfinUrl}/Users/${encodeURIComponent(authorId)}/Images/Primary?width=80&height=80`, {
                headers: { Authorization: authorization }, redirect: 'manual', signal: controller.signal
            });
            const type = response.headers.get('content-type') || '';
            if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type.split(';')[0])) throw Object.assign(new Error('Profile picture unavailable'), { statusCode: 404 });
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength > 1_000_000) throw Object.assign(new Error('Profile picture unavailable'), { statusCode: 404 });
            return { body: Buffer.from(bytes), type };
        } finally { clearTimeout(timer); }
    }

    async authenticate(header) {
        if (!header) throw Object.assign(new Error('Missing authorization'), { statusCode: 401 });
        if (this.config.mockUpstreams) {
            const token = header.replace(/^Bearer\s+/i, '');
            if (!['requester-token', 'trusted-token', 'admin-token', 'restricted-token'].includes(token)) throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
            return {
                id: token.replace('-token', ''),
                name: token.replace('-token', '').replace(/^./, c => c.toUpperCase()),
                isAdmin: token === 'admin-token',
                policy: token === 'restricted-token' ? { EnableAllFolders: false } : { EnableAllFolders: true, BlockedTags: [], BlockUnratedItems: [], EnableContentDeletion: false }
            };
        }
        const raw = header.replace(/^Bearer\s+/i, '');
        const authorization = /^MediaBrowser\s/i.test(header) ? header : `MediaBrowser Client=\"Jellyfin Household\", Device=\"Community Gateway\", DeviceId=\"community-gateway\", Version=\"0.1.0\", Token=\"${raw.replace(/[\"\\]/g, '')}\"`;
        const data = await this.json(`${this.config.jellyfinUrl}/Users/Me`, { headers: { Authorization: authorization } });
        if (!data?.Id || data.Policy?.IsDisabled) throw Object.assign(new Error('Invalid or disabled Jellyfin user'), { statusCode: 401 });
        return { id: data.Id, name: data.Name || 'Jellyfin user', isAdmin: data.Policy?.IsAdministrator === true, policy: data.Policy || {} };
    }

    isDiscoveryEligible(user) {
        const p = user.policy || {};
        return p.EnableAllFolders === true
            && (!Array.isArray(p.EnabledFolders) || p.EnabledFolders.length === 0)
            && (!Array.isArray(p.BlockedTags) || p.BlockedTags.length === 0)
            && (!Array.isArray(p.BlockUnratedItems) || p.BlockUnratedItems.length === 0)
            && (p.MaxParentalRating == null || p.MaxParentalRating === '')
            && (!Array.isArray(p.AccessSchedules) || p.AccessSchedules.length === 0);
    }

    async mappedUser(user) {
        if (this.config.mockUpstreams) {
            const trusted = user.id === 'trusted';
            return { id: trusted ? 12 : 11, permissions: PERMISSIONS.REQUEST_MOVIE | PERMISSIONS.REQUEST_TV | (trusted ? PERMISSIONS.AUTO_APPROVE_MOVIE | PERMISSIONS.AUTO_APPROVE_TV : 0) };
        }
        if (!this.config.seerrApiKey) throw Object.assign(new Error('Seerr is not configured'), { statusCode: 503 });
        return this.json(`${this.config.seerrUrl}/api/v1/user/jellyfin/${encodeURIComponent(user.id)}`, { headers: { 'X-Api-Key': this.config.seerrApiKey } });
    }

    seerrHeaders(mapped) {
        if (!mapped?.id) throw Object.assign(new Error('Jellyfin user is not mapped in Seerr'), { statusCode: 409 });
        return { 'X-Api-Key': this.config.seerrApiKey, 'X-API-User': String(mapped.id), 'Content-Type': 'application/json' };
    }

    canRequest(mapped, type) {
        const value = Number(mapped.permissions || 0);
        return Boolean(value & PERMISSIONS.ADMIN) || Boolean(value & (type === 'movie' ? PERMISSIONS.REQUEST_MOVIE : PERMISSIONS.REQUEST_TV));
    }

    async search(mapped, query, page) {
        if (this.config.mockUpstreams) return { page, totalPages: 1, results: [
            { id: 603, mediaType: 'movie', title: 'The Matrix', releaseDate: '1999-03-30', posterPath: null },
            { id: 1399, mediaType: 'tv', name: 'Game of Thrones', firstAirDate: '2011-04-17', posterPath: null }
        ].filter(x => (x.title || x.name).toLowerCase().includes(query.toLowerCase())) };
        return this.json(`${this.config.seerrUrl}/api/v1/search?query=${encodeURIComponent(query)}&page=${page}`, { headers: this.seerrHeaders(mapped) });
    }

    async details(mapped, type, id) {
        if (this.config.mockUpstreams) return type === 'tv'
            ? { id, mediaType: 'tv', title: 'Game of Thrones', year: 2011, seasons: [{ seasonNumber: 1, name: 'Season 1' }, { seasonNumber: 2, name: 'Season 2' }] }
            : { id, mediaType: 'movie', title: 'The Matrix', year: 1999, seasons: [] };
        const data = await this.json(`${this.config.seerrUrl}/api/v1/${type}/${id}`, { headers: this.seerrHeaders(mapped) });
        return { id: data.id, mediaType: type, title: data.title || data.name, year: Number((data.releaseDate || data.firstAirDate || '').slice(0, 4)) || null,
            seasons: type === 'tv' ? (data.seasons || []).filter(x => x.seasonNumber > 0).map(x => ({ seasonNumber: x.seasonNumber, name: x.name })) : [] };
    }

    async submit(mapped, body) {
        if (this.config.mockUpstreams) return { id: Math.floor(Math.random() * 100000), status: mapped.id === 12 ? 2 : 1, media: { status: 2 } };
        return this.json(`${this.config.seerrUrl}/api/v1/request`, { method: 'POST', headers: this.seerrHeaders(mapped), body: JSON.stringify(body) });
    }

    async myRequests(mapped, page) {
        if (this.config.mockUpstreams) return { pageInfo: { page, pages: 1 }, results: [] };
        return this.json(`${this.config.seerrUrl}/api/v1/request?take=20&skip=${(page - 1) * 20}&requestedBy=${mapped.id}&sort=added`, { headers: this.seerrHeaders(mapped) });
    }
}
