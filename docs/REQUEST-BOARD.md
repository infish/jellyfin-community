# Request board

The owner approved publication and deployment on 2026-10-13 after the final audit.

Home shows a Requests row below Community. The full board is at `/web/#/request-media`.
Movies are selected by their catalogue identity and year. There are no cut, language,
or quality fields. Shows allow season selection. Requested titles are grouped, but
each person's request retains separate ownership and status.

## TMDB setup

Sign into the deployed interface as a Jellyfin administrator. Open Requests and the
Connect title search form. Obtain a developer **API Read Access Token** from
https://www.themoviedb.org/settings/api and enter it there, not into this chat.
The server validates the token with TMDB, stores it as mode 0600 in
`/data/catalog-credentials.json`, and returns only readiness status. The browser
clears the input after a successful save. `TMDB_READ_TOKEN` can also be supplied
as a private server environment variable. Never add credentials to Git or a
public Docker image. Preserve this credentials file separately when backing up
the database. Deployment must preserve this file or configure it through the admin form.

TMDB attribution appears under Credits on the request page with its approved,
unmodified logo. Search and title details use its fixed official API; poster
requests use validated paths on its fixed image host.

## Library check and permissions

The check runs for the person placing the request, using that person's Jellyfin
authorization and user ID. It matches TMDB, IMDb, and TVDB identifiers against
their visible movies or shows. A matching physical movie blocks submission;
title/year-only matches require the person to inspect the candidate before
confirming. Virtual placeholders do not count as available media. An incomplete
or failed library lookup blocks submission instead of claiming absence.

Series checks deduplicate episode numbers and handle multi-episode files. Complete
seasons are excluded from the request; missing or incomplete seasons remain
selectable. Submission repeats the check, so the initial search result cannot
bypass newly available media. The listing does not scan everyone's libraries:
the availability check belongs to the add-request workflow. Administrators set
board statuses manually: Requested, In progress, Available, or Declined.

Removal is soft deletion and is enforced on the server: only the original
requester or a verified Jellyfin administrator can remove a request. Removing
one request preserves other people requesting the same title. Media files and
Sonarr/Radarr are not changed. The existing guarded Seerr adapter remains disabled.
External discovery for restricted accounts remains blocked until its visibility
policy can be safely supported.

The board lists up to the latest 1,000 active request entries, grouped into title
cards. Library checks page through up to 5,000 visible movies/shows or episodes
and explicitly fail if they cannot finish. Short per-user caches reduce duplicate
checks, while submission bypasses the inventory cache.

## Verification boundary

Automated tests cover title/year distinction, provider-ID matches, library scope,
submission rechecks, outages, ambiguous matches, complete/partial seasons,
deduplication, grouped ownership, status permissions, missing setup, and private
credential responses. Old multiple-emoji reactions migrate to one per person,
and stale removal of a previous emoji does not remove the replacement reaction.

Final audit on 2026-10-13: live TMDB movie/show search and real Jellyfin library
checks passed using the owner's privately configured credential. An owned movie
was blocked, a distinct same-name movie from a different year was permitted,
and all seasons of a complete four-season show were recognised as available.
A local test request was added, its administrator status/filter checked, and the
test request removed. No existing requests or NAS data were modified.

The final audit fixed reuse of stale request cards and an unsaved token when
the next account's access check fails. Old asynchronous responses cannot restore
those cards after a view session changes, and the home preview clears cards on
access errors. Both cases have regression tests. The connected token remains
private and is not included in Git or source archives. Publication uses matching source archives and pinned web/backend images.

## Next upgrade (local, not committed or deployed)

Administrators can open Title IDs on request cards to copy IMDb/TMDB identifiers or follow their catalogue links. The identifier endpoint independently checks the administrator role.

The board checks the current requester's entries at most once per minute when that person opens or refreshes it. To check while everyone is offline, an administrator must connect a Jellyfin API key in Requests → Automatic library checks, or privately supply `JELLYFIN_LIBRARY_API_KEY`. This is server-wide API access: create a dedicated key and revoke it if this service is retired. Never use a browser session token. The key is validated, saved separately at `/data/library-credentials.json` with mode 0600, and never returned through the API or included in source/images. Preserve it in private backups.

Connected background checks run every five minutes, including after startup. They reload each requester's current Jellyfin policy and query with that requester's UserId. Disabled, deleted, or discovery-restricted accounts are skipped. Without a configured key, the UI explicitly describes the authenticated-on-open fallback.

Confirmed movies become Available. Shows become In progress when some requested episodes exist, and Available only when all requested seasons are complete. Unrequested missing seasons do not block completion. Declined requests remain untouched. Confirmed availability begins a persisted 72-hour countdown; removal is a soft deletion after a successful final library check. A successful check showing disappearance cancels the countdown, while errors defer changes and deletion. Manually marking Available does not start cleanup until library confirmation. No media or download-manager data is deleted.
