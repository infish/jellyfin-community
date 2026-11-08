# Scoped LG webOS fallback

Implemented and approved for publication and TrueNAS deployment as v0.1.0-alpha.9 on 2026-11-08.

## Scope

Disable household Community, Requests, chat and online presence only when the user agent identifies LG webOS (`Web0S` or `webOS`, case insensitive) and `Element.prototype.replaceChildren` is not a function. The reported LG 65NANO913NA on webOS 5.6 uses Chromium 68; replaceChildren requires Chromium 86. TV user agents do not reliably identify individual models, so the exclusion targets this compatibility case, not a guessed model name.

A webOS client with the required API retains all custom features. Non-webOS devices retain their existing behavior, even when missing that API. This deliberately does not introduce a general unsupported-browser policy or change upstream Jellyfin compatibility.

## Behavior

Skip construction of custom homepage previews and the global chat/presence initializer. Standard homepage loading, resume, pause and teardown remain operational. Hide the custom header control and both interfaces' custom navigation entries. Exclude the Community and Requests routes on the affected clients. Guard the chat initializer and heartbeat as well, preventing accidental later initialization or presence polling.

Do not change authentication, library access, media, database records, playback settings, or the volume-wheel fix. The deferred 24-hour Declined-request cleanup remains unimplemented.

## Verification

Two orchestration tests first failed against the previous code because the old LG client still constructed homepage previews and initialized chat. After gating, they pass and confirm standard library sections still load/resume. Additional tests cover LG spelling variants, supported LG clients, desktop/mobile/Tizen controls, and exclusion/preservation of custom routes in both interfaces. All 201 web tests and the TypeScript check pass. The production build passes with the two existing bundle-size warnings. The aggregate distribution patch was applied using git am in a disposable checkout and reproduced every changed file.

Actual TV startup, remote navigation and playback still require acceptance testing on the affected television. A simulated older DOM is not a physical webOS test.

## Release prerequisite

Alpha.8 was stopped by the backend dependency audit before image publication. The follow-up release updates Fastify 5.12.5 to 5.12.6 and compatible fast-uri dependencies to patched versions. All 23 backend tests pass and the production audit reports zero vulnerabilities. No backend product behavior or schema changes were added.
