# Verification record

## Community follow-up, 2026-10-12

Publication preparation: initialized an isolated deployment repository, verified
that the saved patch reproduces the exact customized source tree from its pinned
upstream commit, and validated the deployment/workflow YAML. Five backend tests
and seven focused Community UI tests passed, as did Web typecheck. Updated
Fastify to 5.12.5 and compatible fast-uri patch versions after a current audit;
the backend then reported zero dependency advisories. This does not certify the
upstream Web dependency tree or NAS deployment. No NAS or domain changes were
made during publication preparation.

Registered Community and Request media in the modern router and drawer, replaced the home footer link with a native section heading and message cards, and connected both pages to Jellyfin's `viewshow` lifecycle. The gateway was rebuilt and recreated. An unauthenticated browser visit to `/web/#/community` reached Jellyfin sign-in with `/community` preserved as the return destination. Authenticated visual and board interaction checks require signing in in the test browser.

Authenticated follow-up: after reloading stale assets, Community displayed its heading, privacy checkbox, message composer, Post button, and empty state. Moved its home preview above My Media at the user's request. Removed HTML fallback for missing assets and added revalidation headers to prevent outdated JavaScript references being served as HTML.

Profile pictures: added an authenticated, message-scoped avatar endpoint using Jellyfin's user image route and authorization headers, with initials fallback. Five backend tests and focused UI lint passed; production images built and were applied. Live browser screenshots confirmed Community above My Media, the existing author's photo beside the name on all three preview cards, and the same photos in the full board. No test messages were posted or deleted.

Online now: added a matching sidebar to the home preview and full Community board, showing names, fitted avatars, a count, and green presence markers. Narrow-screen observation confirmed the panel stacks above the board. Polling pauses with its page and skips hidden documents; current privacy and expiry remain enforced by the backend, including avatar access. Five backend tests (including hidden-presence image denial), focused lint, typecheck, and production builds passed. Live screenshots confirmed one visible signed-in user in both panels; the temporary viewport override was reset.

Presence cadence and slider: online panels/header now poll every five seconds, retaining the 90-second heartbeat expiry. Unchanged online lists retain their existing avatar elements. Added home-preview arrows with lazy older-history loading and a five-advance cap per hold. Focused tests verify the cap and release cancellation during an asynchronous step; lint and typecheck passed. Browsing older cards suspends automatic preview replacement until the home view resumes.

Live slider verification: holding the right arrow for 1.7 seconds expanded the preview from three existing messages to eight (five additional messages) and stopped at the end of history. No messages were created or deleted during verification.

Chevron presentation: matched the native row controls, disabled the left arrow at the start, and hid horizontal scrollbar chrome. After rebuilding and applying the gateway, a live held-arrow check confirmed five-card progression and no drag bar at the end of the row.

Home privacy switch: added a prominent “Remain invisible” switch inside Online now, backed by the existing account-wide SQLite preference. Switching on removes the current user's published row immediately, updates the count/header, and retains invisibility across reloads and heartbeats. Two focused UI tests passed for immediate removal and stale polling-response rejection; focused lint, typecheck, and production build passed. Live home-page toggling showed count 1 when visible and 0 immediately after hiding. Reload preserved the checked invisible state; the user's original invisible preference was restored after verification.

Emoji picker: added 28 face choices, the Israel flag (🇮🇱), and juice box (🧃) to the message composer. Insertion preserves the cursor, replaces selected text, and counts Unicode code points consistently with the backend. Three focused insertion/limit tests, lint, typecheck, and production build passed. Live accessibility observation confirmed every picker option and the updated composer character count; a subsequent home screenshot showed a user-posted emoji message rendered literally. The agent did not submit a message or alter the user's draft during this check.

## Automated with mocks

Run on 2026-09-14 with Node 24.11.0 and Fastify 5.12.4:

- Invalid/missing authentication fails; forged `X-API-User` does not establish identity.
- Presence sessions deduplicate, privacy clears sessions, hidden heartbeat is suppressed, and controlled-clock expiry occurs after 90 seconds.
- Board HTML remains literal text, ownership/moderation work, and the sixth post per minute is rejected.
- Restricted direct-ID and artwork access fail server-side; requester/trusted outcomes differ; idempotent repeats return their recorded response; changed input with one key fails.

Result: 4 tests passed. Backend production dependency audit: 0 vulnerabilities.

## Build

- Jellyfin Web `npm run build:check`: passed.
- Focused Jellyfin ESLint on all modified JavaScript: passed.
- Jellyfin Web `npm run build:production`: passed with upstream bundle-size warnings.
- `docker compose config --quiet`: passed.
- Final community and gateway container images: built successfully; community health endpoint passed in a temporary localhost container; packaged Caddy configuration validated.

The upstream Jellyfin Web lock reports inherited dependency advisories. This project did not rewrite that upstream lock or claim those advisories are remediated; review them before distribution.

## Not live-tested

No Jellyfin, Seerr, Sonarr, Radarr, browser automation, playback, backup/restore, or real request credentials were available. Production requests therefore default disabled. Complete `LIVE-GATE.md` before enabling them.
