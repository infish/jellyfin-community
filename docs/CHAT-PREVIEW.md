# Chat expansion: verification and deployment

The owner approved publication and deployment on 2026-10-13 after reviewing the finished preview.

Review URL: http://127.0.0.1:8081/web/#/community

The `jellyfin-community-preview` app binds only to the laptop loopback address and uses its own `preview-data` volume. Login and profile pictures use the existing Jellyfin server. Community posts, private conversations, reactions, and visibility preferences in this preview are stored separately from both the NAS and the original laptop app.

## Behavior

- Message a person from Online now. Use the persistent Messages button to reopen conversations even when the person is offline.
- Desktop conversations open in a panel at the bottom right; the mobile layout fills the screen.
- Messages show fitted avatars, author names, timestamps, day separators, and online dots. Presence refreshes every five seconds and expires after 90 seconds without a heartbeat. Invisible users have no green dots.
- Reply quotes the selected original message. Selecting the quote loads/jumps to that message. Deleted board originals show a placeholder instead of their former text.
- React to board posts, private messages, and replies using the face picker, Israel flag, or juice box. Select your reaction again to remove it. Hover a reaction or select its count to inspect who reacted.
- Conversation drafts survive closing or switching chats within this page session. They are cleared on sign-out or account changes and are not persisted to browser storage.
- Enter sends; Shift+Enter adds a line in private chat. The 500-code-point message limit also applies to private messages.
- Unread counts are private to the recipient. Muted/blocked chats do not contribute to the launcher badge. There are no read receipts or typing indicators. Muting does not stop delivery; blocking prevents both participants from sending or reacting while preserving existing history.
- Closed chat panels stop loading message contents. Open conversations and visible older message reactions refresh every five seconds. Retried sends reuse a message identifier to prevent duplicates.

## Access and storage

Every API request authenticates its Jellyfin session. Every private message read, avatar, reply, reaction, snapshot, settings change, and unread update checks conversation membership. Jellyfin administrators do not have a private-chat API override. As with other server-stored data, the NAS/database administrator can access the underlying SQLite file; these conversations are not end-to-end encrypted.

The additive SQLite migration preserves existing board messages and visibility preferences. It adds nullable board reply references and separate tables for contacts, private conversations/messages, reactions, conversation settings, and private unread markers. No private message bodies are added to public board responses or logs. Board posting remains limited to five messages per minute; direct messages allow 30 per minute per sender. The authenticated API budget is 300 requests per minute to accommodate five-second polling and profile pictures across the expanded interface.

## Verification

Automated: 180 interface tests and 18 backend tests pass after the final audit. Coverage includes unrelated-user and administrator access rejection, foreign-conversation replies, avatars and snapshots, bilateral blocks, idempotent retries, private unread markers, migration preservation, pagination, literal text, deleted reply originals, Unicode limits, invisible presence, draft retention, account changes, one reaction per person, request ownership/library checks, and clearing request data and unsaved catalogue tokens when session access changes. A delayed header presence response cannot relight author dots after an invisible preference change.

The production web build passes with the existing bundle-size warnings. Live browser checks use the real Jellyfin login and isolated preview database. The labelled `Preview Friend` contact and its incoming messages are local fixtures, not a real Jellyfin user or evidence of a live second-user browser session. Backend access tests use separate mock-authenticated accounts.

Local visual checks cover community replies/reactions, private replies/reactions, online expiry, and desktop/mobile layouts. A live second-person browser acceptance check remains untested; separate-account backend tests cover permissions.

## Reproduce

With the customized source prepared, run:

```sh
docker compose -f compose.preview.yml up -d --build
```

Optional fixtures, after signing into the preview:

```sh
docker exec -i jellyfin-community-preview-community-1 node --input-type=module < scripts/seed-chat-preview.mjs
```

The fixture script refuses to run without the preview-only environment guard. It does not create Jellyfin accounts or transmit messages to another user.

## Release procedure

Regenerate/check the pinned upstream patch, run CI, publish matching licensed source archives and immutable images, take a consistent NAS database backup, then replace the web/backend image references together in the existing app. Keep the previous image digests and the pre-migration backup for rollback. No Nginx Proxy Manager routing change is needed for this expansion. Do not overwrite the live NAS database with preview data.
