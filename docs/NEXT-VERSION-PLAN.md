# Next-version upgrade plan

Implementation authorized locally on 2026-10-13. The owner authorized publication and TrueNAS deployment on 2026-10-13.

## 1. Community reactions on the homepage

Show existing emoji reactions and counts beneath each Community preview message. Reuse the current reaction component and compact styling, preserving one reaction per person per message. Allow changing/removing one's own reaction directly from the homepage. Refresh alongside the existing Community polling without shifting cards unnecessarily.

Verify that reactions stay consistent between the homepage and Community page, switching emoji replaces the old reaction, and narrow layouts remain readable.

## 2. Messages positioning during playback

Review the launcher and open chat panel during windowed and fullscreen playback, including Jellyfin Desktop. Position them clear of playback controls and subtitles. Keep the launcher compact and unobtrusive when idle, with chat opened only on user action. Choose the exact placement from real playback review rather than the supplied homepage screenshot.

Verify seeking, pause, subtitle visibility, fullscreen transitions, and returning to the normal page layout. Retain the established mobile chat layout unless playback testing identifies a necessary change.

## 3. Admin title identifiers

Add an administrator-only details area on request cards containing a copyable IMDb ID and direct IMDb link when available. Show a clearly labelled TMDB ID/link as a fallback. Retrieve identifiers on the backend and enforce administrator access there, rather than merely hiding the interface. Do not reveal API credentials.

Verify accurate identifiers, missing-ID behavior, copy/link actions, and denial of identifier details to ordinary accounts. Trainspotting's `tt0117951` is the user-provided example, to be verified against catalogue metadata during implementation.

## 4. Automatic availability and cleanup

Periodically reconcile outstanding requests against Jellyfin. Match provider identifiers rather than fuzzy titles. A movie must physically exist; a show request requires all requested seasons/episodes to be available. Placeholders, incomplete seasons, failed scans, or ambiguous matches must not count as completion. Respect each requester's library access.

For a requested show with some requested content physically present but missing or incomplete requested seasons, automatically set In progress. A series placeholder alone does not count as progress. Evaluate only the seasons covered by that person's request: unrelated missing seasons do not prevent completion. Preserve administrator-declined requests unless explicitly reopened. Partial availability never starts the cleanup countdown.

Automatically mark confirmed completions Available and record an availability timestamp. Show the planned removal date so users understand why the card remains briefly. After 72 hours, recheck availability and soft-delete only the eligible request entry. Other requesters' entries retain their own completion times and eligibility. Never delete media files or expire other statuses.

If a successful check shows the media is no longer available, cancel the countdown; a later confirmed return begins a new three-day period. Failed checks defer changes and cleanup. Keep timestamps and cleanup state in the database so restarts preserve the countdown, and make cleanup repeatable without duplicate effects.

Implementation prerequisite: determine a supported authenticated background library-check mechanism that respects requester visibility. Do not store browser session tokens or silently expand service permissions to enable scheduled scans. Resolve this before promising unattended checks while all users are offline.

Verify movie completion, partial/full requested seasons, requester visibility, outages, restarts, the exact 72-hour boundary, disappearance/reappearance, and preservation of every non-Available request. Use a controlled test clock and isolated test data rather than waiting three days or altering production requests.

## Delivery sequence

1. Implement identifiers and homepage reactions, then review their appearance locally.
2. Test and adjust chat positioning during actual playback.
3. Implement availability reconciliation and cleanup after resolving authenticated background checks.
4. Run focused regression tests and check all changes together in the isolated preview.
5. Present the finished version for owner approval before any commit, push, or TrueNAS deployment. On approval, publish matching source/images, back up the NAS data, and update both pinned images together.
