# Plugin navigation and Playback Reporting gateway fix

Local verification: 14 November 2026. Owner approved publication and TrueNAS deployment as v0.1.0-alpha.10 on 14 November 2026.

## Proven cause

The household gateway sent all `/web/*` traffic to its static file server. Jellyfin's plugin API also uses that prefix:

- `GET /web/ConfigurationPages?enableInMainMenu=true`: discover plugin menu entries.
- `GET /web/ConfigurationPage?name=user_report`: embedded report page.
- `GET /web/ConfigurationPage?name=user_report.js`: its JavaScript resource.

The pinned SDK's `plugin-api.js` uses these endpoints; the viewer's `getConfigurationResourceUrl()` does too. The signed-in public dashboard reproduced the missing menu and "An error occurred while loading plugins", with the reported PluginDrawerSection 404 console error. Credential-free HTTP comparisons independently located the routing boundary: discovery returned 401 directly from Jellyfin but 404 publicly; the embedded Users page returned 200 directly but 404 publicly.

This is a gateway collision. The server/web version difference does not require an upgrade to resolve this failure. The exact browser request object was not extracted; endpoint identification comes from the SDK/client source and explicit HTTP probes, not an invented captured network trace.

## Change

`deploy/Caddyfile` now routes only the two exact plugin endpoint paths (case-insensitive) to the configured Jellyfin upstream, preserving the full path, query and existing authorization headers. The explicit `route` block prevents Caddy's directive sorting from placing the static `/web/*` handler first. All other handling remains in the same order: Community API, custom static web files, then normal Jellyfin traffic.

No hardcoded report menu link, plugin installation changes, retention changes, database edits, public access grants, web-client upgrade or client binary changes were made. The LG webOS gate and household code are unchanged.

`scripts/test-gateway-routing.py` runs the production Caddy configuration against an isolated fake Jellyfin. It covers discovery, embedded HTML/JS, case variants, query preservation, authorization forwarding/denial, static-file behavior and cache headers, non-endpoint lookalikes, and ordinary upstream routes. The new cases failed against the original gateway (404 instead of upstream responses), then passed after the fix. `.github/workflows/release.yml` runs this test during verification.

## Live local preview evidence

The loopback-only preview is `http://127.0.0.1:8081/web/`, proxying the existing server. This was the pre-deployment review environment; live Desktop acceptance is performed after the approved release is deployed.

Using the existing signed-in administrator session in the in-app browser:

- Plugin catalog renders installed plugins and the Available catalog.
- Dashboard shows both Playback Reporting and Reports plugin menu entries.
- Playback Reporting Users report renders Total Plays and Total Time with existing NAS activity (one Doom Patrol episode, several recorded minutes).
- Weeks: All works; a four-week range ending 2000-01-01 yields an empty table without a load error. The original current date and All selection were restored. The native plugin shows table headers with no rows for an empty range; no custom empty-state message was added.
- Usage report draws its charts. Report HTML and JavaScript resources return 200 through the corrected gateway.
- Browser error log was empty during report/chart checks.
- Real report-data requests without authentication return 401 through both the local gateway and direct server.

No controlled playback was initiated. Existing recorded activity demonstrates that the plugin is receiving data, but is not a calibrated duration-accuracy test.

## Automated verification

- Gateway regression suite: 3 test groups pass using the pinned production Caddy image.
- Existing web suite: 25 files, 201 tests pass, including the LG webOS and volume-wheel regressions.
- Docker Compose configuration and whitespace checks pass.
- No frontend source/build changes were required; the preview uses the existing custom web build.

## Acceptance still required

After separately authorized publication/deployment, verify the owner's actual Jellyfin Desktop with its normal public server address. Native app control is unavailable in this session; the completed UI checks are browser checks through the corrected local gateway, not Desktop checks. Also verify a real signed-in regular account is denied administrator reports. Automated fixture-user denial and unauthenticated live denial do not replace that account-level check.

An agreed controlled playback session is still needed to assess the correct user's measured duration. Do not fabricate playback activity or change watch history to pass that check. Retention and the reporting database remain untouched.

Rollback is the previous gateway image/configuration. No data migration is involved.
