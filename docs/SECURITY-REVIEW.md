# Initial release security review (2026-10-12)

This is a prerelease, not a claim that the whole upstream dependency tree has no
advisories. The custom backend's current production audit reports zero findings
after Fastify 5.12.5 and compatible fast-uri fixes. Its five tests pass.

Web source keeps the Jellyfin v12.0 base, with targeted dependency fixes for
Axios 1.20.0, Markdown-it 14.3.2, React Router DOM 6.30.6 and DOMPurify 3.4.17.
EPUB.js retains its API version with its XML parser overridden to xmldom 0.8.15.
Compatible lockfile fixes were applied without `audit fix --force`. The full
169-test suite, typecheck and production build pass.

The production-dependency audit still reports five package findings:

- `pdfjs-dist`: the existing Jellyfin PDF player explicitly sets
  `isEvalSupported: false`, matching the upstream mitigation for
  GHSA-wgrm-67xf-hhpq. A future PDF.js upgrade still needs viewer compatibility
  testing; the audit finding is not erased by the configuration mitigation.
- `tar` and its parent `@mapbox/node-pre-gyp`: reached through PDF.js's Node
  `canvas` dependency. These are build dependencies, not a Node service inside
  the deployed gateway. The runtime image contains Caddy and compiled browser
  assets, not `node_modules`. Build-tool updates remain tracked separately.
- `react-router` and `react-router-dom`: 6.30.6 resolves the earlier directly
  fixable version findings but further advisories recommend a v7 upgrade.
  SSR hydration is not used by this static gateway. The open-redirect advisory
  remains a reviewed follow-up; do not claim every untrusted navigation path is
  audited. Test a compatible fix before production promotion.

Development-tool advisories also remain. Never expose a dev server, test runner,
build workspace, Docker socket or source dependency tree as a production app.
Static serving does not by itself prove that every browser dependency is safe.

Release images may be published as an explicitly marked preview for isolated
NAS validation. Public-domain cutover and production promotion require the
remaining navigation review and the live deployment/playback/backup checks.
