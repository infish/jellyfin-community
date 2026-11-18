# Shared homepage order and Continue Watching removal

Implemented locally for review on 18 November 2026. No commit, push or deployment has been authorized for this update.

## Agreed scope

Reuse the existing Recently Added in Movies/Shows rows rather than building a new release-date category. Order the existing sections as Requests, Continue Watching, Next Up, Movies/Shows (recent additions), Community and My Media. Existing optional rows retain their relative order. My Media goes last, with Collections moved to the end of its existing library tiles.

This is the shared Community-viewer ordering, not an administrator-only display preference. Library visibility and content still follow each user's existing permissions and selected sections. No server display preferences are rewritten. Both viewer skins reuse the modified home controller. The existing older-webOS exclusion keeps its native homepage behavior.

Add a distinct Remove from Continue Watching movie-menu command for resumable movies, available to regular signed-in users without media-delete permission. Delete media remains a separate action with its existing authorization.

## Resume behavior

The installed SDK has a user-data update endpoint but no separate hide-from-resume flag. Removal therefore clears the selected movie's saved playback position. It does not preserve that resume point. It reads fresh user data first, preserves watched status, play count, favourites, last-played date and other supported metadata, and sets PlaybackPositionTicks to zero. It does not submit a stale PlayedPercentage or mark the movie played/unplayed.

The action uses the signed-in API client's current user ID and the selected server. It never calls a media-delete API. On success, invalidate only that user's ResumeItems cache and let the existing menu refresh machinery update the row. Failures propagate without a success toast or cache clearing. English and Czech labels were added.

## Changed source

- `src/scripts/community/homeOrder.js`: move existing rows and stably move Collections last without mutating the cached library list.
- `src/apps/legacy/controllers/hometab.js`: mount custom rows inside the home sections after loading, including re-renders.
- `src/components/homesections/homesections.js`: identify row types and order library tiles for supported Community clients.
- `src/components/itemContextMenu.js` and `src/components/removeFromContinueWatching.ts`: separate user-scoped resume action using the existing authenticated SDK.
- `src/strings/en-us.json`, `src/strings/cs.json`: menu/toast labels.
- Two new regression test files; aggregate distribution patch regenerated and checked using git am in a disposable checkout.

## Verification

- New homepage/menu tests failed against the previous behavior, then passed after implementation.
- All 206 web tests in 27 files pass, including existing LG webOS and volume-wheel tests. TypeScript check passes.
- Production build passes with the two existing bundle-size warnings.
- Aggregate mailbox patch applies and reproduces every changed source/test file.
- Local preview at http://127.0.0.1:8081/web/ shows Requests, Continue Watching, Next Up, Movies/Shows, Community, then My Media. My Media is last and its Collections tile is last.
- The movie's More menu visibly shows Remove from Continue Watching separately from Delete media. No real saved playback position was cleared during visual testing.
- The current isolated preview backend is healthy, Requests shows its normal empty state, and the browser error log is empty.

The SDK/action tests intercept real SDK HTTP requests against an in-memory two-user fixture. They verify Alice's resume point is cleared while her watched state/count/favourites and Bob's resume point remain unchanged, and verify the user's resume cache refresh and failure handling. This is not a live NAS user-data-write test. Desktop and a real removal can be accepted after review; do not alter someone's saved progress merely to claim a live test passed.

## Deployment state

The NAS/public Community release remains unchanged. Root backlog documents retain their pre-existing uncommitted saved ideas. No reporting data, reporting retention, media files or download-manager settings were changed.
