# Jellyfin Community

A Jellyfin Web customization for a private household, with support for the classic and modern browser layouts. It adds foreground web presence and a persistent plain-text community board while leaving Jellyfin Server unmodified. A guarded Seerr request adapter is included but remains disabled pending its live compatibility checks.

Source and releases: https://github.com/infish/jellyfin-community

The first [preview release](https://github.com/infish/jellyfin-community/releases/tag/v0.1.0-alpha.1) is published with public container images and matching source archives. A TrueNAS preview has been deployed and its restored board, avatars, privacy controls and Quick Connect login verified. Real playback and public-domain cutover remain pending; see [verification](docs/VERIFICATION.md) and [security review](docs/SECURITY-REVIEW.md). Published releases include the source assets described in [licensing notices](THIRD_PARTY_NOTICES.md).

The browser still talks directly to Jellyfin for login, libraries, playback, byte ranges, and WebSockets. Caddy serves the custom `/web/` assets, sends only `/api/community/*` to the community service, and proxies all other traffic to Jellyfin. Native clients and clients with bundled web assets do not gain these features.

## Implemented behavior

The unpushed chat expansion is available for local review; see [chat preview notes](docs/CHAT-PREVIEW.md). It is not installed on the NAS yet.

- An Online now panel on Home and Community, with names, fitted avatars and green status markers. Lists refresh every five seconds; foreground heartbeats occur every 30 seconds and expire after 90 seconds.
- A prominent account-wide “Remain invisible” switch that immediately removes active presence and persists across reloads.
- A SQLite board with 500-code-point messages, five posts per minute, stable cursor pagination, author deletion, and current Jellyfin-administrator moderation. Content is rendered with `textContent`.
- Community and Request media routes and navigation items, plus a three-message Community preview above My Media. Opposing arrows advance through up to five additional messages per hold.
- Authenticated profile pictures beside authors, with initials fallback, and a composer emoji picker containing basic faces, the Israel flag and a juice box.
- Private conversations with desktop and mobile chat panels, unread counts, history, quoted replies, emoji reactions, mute and block controls. No read receipts, typing indicators, or sender-visible unread markers.
- Reactions and quoted replies on community posts, including replies themselves. Online dots beside authors respect the existing invisible preference and five-second updates.
- Each person can have one reaction per message; picking a different emoji replaces the previous one. Existing stacked reactions migrate to the most recently added reaction.
- A manual movie/show request board appears below Community on Home. TMDB title search, a user-scoped Jellyfin library check before submission, season selection, grouped requests, status filters, and owner/admin removal work independently of Seerr. Administrators connect TMDB through the Requests page; credentials are stored privately in the data volume.
- A narrow Seerr adapter. It validates every operation through Jellyfin `/Users/Me`, strips browser impersonation headers, maps by verified Jellyfin UUID, always supplies both `X-Api-Key` and `X-API-User`, and exposes sanitized DTOs.
- Conservative discovery eligibility, exact TV season selection, standard/non-4K requests, server-side permission checks, an idempotency ledger, one active title guard, and explicit uncertain outcomes after timeouts.
- Independent presence, board, and request switches. Requests default off and cannot run against real services until `LIVE_COMPAT_VERIFIED=true` is deliberately set after the live gate.

## Commands

For a fresh clone, fetch the pinned upstream source and apply our patch first:

```bash
sh scripts/prepare-web.sh
```

The script refuses to overwrite an existing checkout. Source is pinned to the
exact commit in `docs/COMPATIBILITY.md`, rather than a moving branch.

Backend verification:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/backend:/app" -w /app node:24.11.0-bookworm-slim npm ci
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/backend:/app" -w /app node:24.11.0-bookworm-slim npm test
```

Customized web build:

```bash
docker run --rm -v "$PWD/upstream/jellyfin-web:/app" -w /app node:24.11.0-bookworm sh -c \
  'git config --global --add safe.directory /app && npm ci && npm run build:check && npm run build:production'
```

## Connect to existing services

For TrueNAS 25.10.4 and Nginx Proxy Manager, use the separate
[deployment and rollback guide](docs/TRUENAS.md) and
[NAS template](deploy/truenas.compose.yml). That template pulls prebuilt releases
rather than compiling on the NAS. Its placeholders must be replaced before use.

1. Copy `.env.example` to `.env`. Set fixed internal `JELLYFIN_URL` and `SEERR_URL`, browser-facing `PUBLIC_SEERR_URL`, and `SEERR_API_KEY`. Keep `.env` mode `0600`; never commit it.
2. Import Jellyfin users in Seerr and assign exact Seerr permissions. Requesters get movie/TV request rights; trusted requesters additionally get corresponding auto-approve rights. Jellyfin administration only grants board moderation.
3. Start with requests disabled: `docker compose up -d --build gateway community`.
4. Visit `http://host:8080/web/` and complete [the live gate](docs/LIVE-GATE.md). Only afterward set `REQUESTS_ENABLED=true` and `LIVE_COMPAT_VERIFIED=true`.
5. To install the bundled Seerr, run `docker compose --profile bundled-seerr up -d seerr`, open `http://127.0.0.1:5055`, and complete its setup wizard. The default bind is local-only. Sonarr and Radarr stay under Seerr's control.

TLS should terminate at this gateway or a trusted proxy immediately in front. Preserve `Host`, WebSocket upgrades, range requests, and `/web/` as the public base. Do not expose the community container or Seerr API to browsers.

## Operations

Health: `curl http://127.0.0.1:8080/api/community/health`. Disabled feature endpoints return 503 and the UI reports them unavailable. Community and Seerr never enter the playback path.

For a consistent community backup, stop its writer before archiving the volume or use SQLite's backup API. Copying only the database file while WAL is active is unsafe. Back up Seerr separately as sensitive data and use Jellyfin's full data-directory backup before server upgrades.

Web rollback means switching to the previous pinned web image and clearing stale browser/service-worker caches. Backend rollback requires the matching database backup and old image. Jellyfin 12 database rollback requires a full restore; changing an image tag is insufficient.

To refresh upstream, check out an explicit tag, verify its commit, apply `patches/0001-Add-household-community-interface.patch`, inspect conflicts in home/header/menu/routes, and rerun typecheck, build, identity/request/browser, and playback tests. Never update automatically.

## Scope and licensing

The supported UI includes the classic and modern browser routes in this build. Private chat, replies, reactions, and the manual request board are included. Native client UI changes, detailed automation telemetry, 4K controls, push notifications, and restricted-account external discovery remain outside this release.

The modified Jellyfin Web tree retains GPL-2.0-or-later and its upstream notices. This repository's original code is also GPL-2.0-or-later; see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Version-tagged release builds publish matching complete source archives before publishing images. Seerr is pulled from its official registry and remains unmodified. This project is unofficial and does not imply Jellyfin endorsement.

Version v0.1.0-alpha.5 adds homepage reactions, playback Messages placement, admin catalogue IDs, and automatic availability/cleanup. See [local upgrade verification](docs/NEXT-VERSION-VERIFICATION.md) and [background library setup](docs/REQUEST-BOARD.md). The owner approved publication and deployment on 2026-10-13.
