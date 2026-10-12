# Required live compatibility gate

Keep real requests disabled until these checks pass with isolated accounts and authorized test media. Never capture tokens, keys, emails, paths, or full upstream objects.

- Confirm authentication succeeds with Jellyfin v12.0 `/Users/Me`; invalid, expired, revoked, disabled-user, and token-without-user cases must fail.
- Confirm two Jellyfin UUIDs map to intended imported Seerr accounts. Remove one mapping and verify failure. Inspect outbound calls to prove every user-context call has trusted `X-Api-Key` and `X-API-User`; API-key-only use must be absent.
- Verify a requester stays pending and a trusted requester auto-approves. Downgrade permissions during the session and verify the next operation fails.
- Verify folder, tag, rating, unrated-content, access-schedule, unknown/custom restrictions and guessed title/request/artwork IDs reveal no catalog or status data.
- Race repeated clicks and two users on one movie and overlapping TV seasons. Interrupt Seerr after transmission, restart the gateway, and prove it blocks uncertainty for administrator reconciliation.
- Add and verify the user-scoped Jellyfin provider-ID availability check before showing an “Available in your library” link. This slice intentionally shows no availability links.
- Test stable Firefox, Chrome/Chromium, Safari/WebKit where available, and Chrome Android at narrow width. Check keyboard focus, accessible names, both themes, and touch targets.
- Stop community and Seerr independently. Confirm login, browsing, direct play, seeking, subtitles, WebSockets, byte ranges, and an available transcoding path still work.
- Exercise all backups and restores in isolation, plus web rollback and cache invalidation.

After recording passing evidence for this exact compatibility manifest, set `REQUESTS_ENABLED=true` and `LIVE_COMPAT_VERIFIED=true`. Any version change invalidates the gate.
