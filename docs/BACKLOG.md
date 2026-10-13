# Next version

## Community reactions on the homepage

Requested on 2026-10-13. Local implementation authorized on 2026-10-13; publication and TrueNAS deployment authorized on 2026-10-13.

Show reactions on Community post cards directly on the homepage, so users can see them without opening the Community page. Keep the existing one-reaction-per-person behavior.

## Messages placement during playback

Requested on 2026-10-13. Local implementation authorized on 2026-10-13; publication and TrueNAS deployment authorized on 2026-10-13.

Improve the position of the Messages launcher and chat panel while media is playing. Choose the final placement during playback review, keeping the picture, subtitles, and playback controls clear. Include Jellyfin Desktop in that review.

## Admin access to catalogue identifiers

Requested on 2026-10-13. Local implementation authorized on 2026-10-13; publication and TrueNAS deployment authorized on 2026-10-13.

Let administrators view the IMDb ID of a requested movie or show when available, so they can search for the exact title if its identity is unclear. User example: Trainspotting, `tt0117951`. Make the ID easy to copy and provide a direct IMDb link. If no IMDb ID is available, show the catalogue's TMDB ID with a clear label rather than inventing an IMDb ID.

## Automatic availability and completed-request cleanup

Requested on 2026-10-13. Local implementation authorized on 2026-10-13; publication and TrueNAS deployment authorized on 2026-10-13.

When requested media becomes available in the Jellyfin library, automatically change its request status to Available. Remove that request from the active board three days after confirmed availability, and only if it is still available. Never age out Requested, In progress, or Declined requests. Preserve the existing soft-deletion approach; never delete media files.

For show requests, if some requested content exists but requested seasons remain missing or incomplete, automatically show In progress. Only complete availability of the requested content qualifies for Available and the three-day removal countdown.

See [NEXT-VERSION-PLAN.md](NEXT-VERSION-PLAN.md) for the combined upgrade plan.

