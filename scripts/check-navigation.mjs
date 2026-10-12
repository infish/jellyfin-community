// Regression check for the actual hash-router mode used by Jellyfin Web.
// This does not assert that every application-provided external URL is trusted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../upstream/jellyfin-web/package.json', import.meta.url));
const rootSource = readFileSync(new URL('../upstream/jellyfin-web/src/RootAppRouter.tsx', import.meta.url), 'utf8');
assert.match(rootSource, /const router = createHashRouter\(/, 'Reassess navigation advisories if the routing mode changes');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://jellyfin.test/web/#/home' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { createHashRouter, RouterProvider, Link } = require('react-router-dom');

const relativeTargets = [
    '/\\example.invalid',
    '\\example.invalid',
    '\\\\example.invalid',
    '/\\/example.invalid',
    '/%5cexample.invalid'
];
for (const target of relativeTargets) {
    window.history.replaceState(null, '', '/web/#/home');
    const router = createHashRouter([{ path: '*', element: React.createElement(Link, { to: target }, 'Continue') }]);
    const root = createRoot(document.getElementById('root'));
    try {
        await React.act(async () => root.render(React.createElement(RouterProvider, { router })));
        const link = document.querySelector('a');
        assert.ok(link, 'Router link must render');
        assert.equal(new URL(link.href).origin, 'https://jellyfin.test', 'Relative navigation must stay on the app origin');
        assert.ok(new URL(link.href).hash, 'Internal links must remain inside the hash router');
        await React.act(async () => router.navigate(target));
        assert.equal(window.location.origin, 'https://jellyfin.test', 'Programmatic hash navigation must stay on the app origin');
    } finally {
        await React.act(async () => root.unmount());
        router.dispose();
    }
}
dom.window.close();
console.log('Hash routing: five malformed relative targets stay on the app origin for links and navigation.');
