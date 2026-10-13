function flag(name, fallback) {
    const value = process.env[name];
    return value == null ? fallback : /^(1|true|yes)$/i.test(value);
}

function requiredUrl(name, fallback = '') {
    const raw = process.env[name] || fallback;
    if (!raw) return '';
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must be an HTTP(S) URL`);
    return url.toString().replace(/\/$/, '');
}

export const config = {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT || 3096),
    databasePath: process.env.DATABASE_PATH || '/data/community.sqlite',
    jellyfinUrl: requiredUrl('JELLYFIN_URL', 'http://jellyfin:8096'),
    seerrUrl: requiredUrl('SEERR_URL', 'http://seerr:5055'),
    seerrApiKey: process.env.SEERR_API_KEY || '',
    publicSeerrUrl: process.env.PUBLIC_SEERR_URL || '',
    presenceEnabled: flag('PRESENCE_ENABLED', true),
    boardEnabled: flag('BOARD_ENABLED', true),
    requestsEnabled: flag('REQUESTS_ENABLED', false),
    requestBoardEnabled: flag('REQUEST_BOARD_ENABLED', true),
    jellyfinLibraryApiKey: process.env.JELLYFIN_LIBRARY_API_KEY || '',
    requestSyncIntervalMs: 300_000,
    tmdbReadToken: process.env.TMDB_READ_TOKEN || '',
    liveCompatibilityVerified: flag('LIVE_COMPAT_VERIFIED', false),
    mockUpstreams: flag('MOCK_UPSTREAMS', false),
    upstreamTimeoutMs: Math.min(Number(process.env.UPSTREAM_TIMEOUT_MS || 5000), 15000),
    trustProxy: flag('TRUST_PROXY', false)
};
