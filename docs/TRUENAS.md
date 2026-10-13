# TrueNAS 25.10.4 deployment

This template runs the customized web gateway and community backend beside an
existing Jellyfin Server. Only browsers using this gateway gain Community.
Native clients or clients with their own web bundle retain their existing UI.

## Before installation

Use an explicitly tested release with published images and matching source
archives. This repository's preparation does not establish NAS playback or
Seerr compatibility. Seerr automation remains disabled. The manual request board
is enabled; configure its TMDB token through the administrator form and preserve
`/data/catalog-credentials.json` with the database backups.

Create a dedicated dataset, for example `/mnt/POOL/apps/jellyfin-community`.
Grant container UID/GID 1000 write access to this dataset only; do not recursively
change permissions on existing Jellyfin or media datasets. The backend runs as
the non-root Node user (1000). Do not enable privileged mode or mount media.

For migration, stop the laptop community service briefly and copy a consistent
database backup, or use SQLite's backup API. A raw copy of the main file while
WAL writers run is insufficient. Preserve messages and privacy preferences;
do not publish that database or personal configuration. Restore the backup into
the dataset as `community.sqlite`, with appropriate ownership.

Verify a standalone backup copy with SQLite's `mode=ro&immutable=1` URI before
deployment so the verification account does not create WAL/SHM files. Do not
use immutable mode against a live database whose uncheckpointed WAL is needed.
If verification created `community.sqlite-wal` or `community.sqlite-shm`, ensure
those files also belong to UID/GID 1000 with mode 0600 before starting the
backend. Do not delete a live WAL to repair ownership.

## Installation and validation

In Apps > Discover Apps > Install via YAML, paste `deploy/truenas.compose.yml`.
Replace the dataset path, Jellyfin host and both image digests from the release.
Choose a free host port (the template uses 8080). Use a fixed internal Jellyfin
address reachable from the containers. Do not use the public custom gateway as
the upstream: that would create a proxy loop. The backend port is not published.

Test the NAS address first, without changing the normal domain:

- Login as an administrator and ordinary user; confirm role and message access.
- Check presence, immediate invisibility, avatars, emoji messages and reloads.
- Test playback, seeking, subtitles, direct play and transcoding on real media.
- Stop/restart the community service and confirm the gateway still starts and
  Jellyfin playback works. Restore the service afterward.
- Verify a consistent backup and restore on a separate test dataset.

Once those checks pass, change the Jellyfin Proxy Host in Nginx Proxy Manager
to the NAS gateway's address and port. Keep its existing HTTPS certificate,
domain and WebSocket support. Validate externally, including login and playback.
Retain the previous destination so routing can be restored immediately.

## Upgrades and rollback

Never use floating `latest` tags or automatic container updates. Record exact
image digests, the matching Jellyfin Server version, and dataset backup for each
release. Take a consistent database backup before a backend/schema change.

For a future Jellyfin upgrade, prepare a separate candidate with the matching
Web source version, reapply the patch, resolve conflicts, build/test and repeat
the browser/playback checks before changing the production server or gateway.
Pinned versions still need reviewed security updates; pinning does not make
them permanently safe or compatible.

UI rollback: select the previous gateway digest. Backend rollback: restore its
matching database backup and image. Server rollback: use Jellyfin's supported
full data restore, not merely an older image. Keep a copy of the former Nginx
Proxy Manager destination throughout the cutover.

Community data persists independently of container replacement. Back up Seerr
separately if it is later enabled. Never put API keys in a public YAML file.
