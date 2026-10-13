# Local upgrade verification

The owner approved this upgrade for publication and TrueNAS deployment on 2026-10-13 as v0.1.0-alpha.5.

Implemented: homepage reactions/counts and direct reaction changes; playback-aware Messages placement; administrator-only catalogue IDs; partial-show In progress status; confirmed Available status and 72-hour soft cleanup; private optional background library connection with authenticated requester-only fallback.

Automated: 185 interface tests and 23 backend tests pass. Backend verification also passes on the deployed Node 24.11.0 image with networking disabled. Coverage includes requester scope/current policy, admin-only identifiers and setup, incomplete shows, unrequested seasons, the exact 72-hour boundary, outages, disappearance/reappearance, protected credentials, persistent countdowns across restart, and non-Available entries. Full typecheck passes; production build succeeds with the existing two size warnings. Patch applies cleanly to the pinned upstream without a new commit.

Live isolated preview: homepage reaction replacement keeps one reaction per person and agrees with the Community page; real TMDB identifiers displayed on a temporary movie request, then the request was removed; real browser video playback works and Messages uses the upper-right playback placement. The initial open panel overlapped subtitles and was shortened during review. Ordinary browser fullscreen entry was unavailable in the in-app browser; fullscreen reparenting/restoration is regression-tested. Jellyfin Desktop native playback/fullscreen still needs user acceptance.

The preview uses a separate database. No messages were sent to real users, and no NAS configuration was changed. The owner supplied the updater API key. It was validated against the real Jellyfin server and saved privately in the preview with mode 0600. A guarded preview-only fixture verified background requester-scoped availability and fresh-check soft cleanup after a controlled 72-hour timestamp; the fixture was removed. No browser session token is retained. Three-day timing is checked with a controlled test clock, not elapsed production time.

Playback inactivity follow-up: the Messages launcher now follows Jellyfin's SHOW_VIDEO_OSD event, hiding with the player GUI and returning on interaction. Explicitly opened conversations remain open. Regression coverage verifies hide/show, playback stop, normal-page visibility, and listener cleanup. The active owner playback tab was not reloaded during this follow-up; refresh the player to load the rebuilt code.
