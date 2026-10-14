# Touchpad scrolling and playback volume

Approved for release v0.1.0-alpha.6 on 2026-10-14.

The customized Jellyfin Web video controller registered a wheel listener on `document` while the player was visible. Every positive/negative vertical delta changed playback volume unless a modal dialog was open. It did not restrict the event to volume controls, so scrolling Community chat could also change volume. This code handles both touchpads and mouse wheels; the reported hardware-specific difference has not been independently reproduced.

The listener now belongs to `.volumeButtons` only, with lifecycle cleanup on leaving the player and before rebinding. Intentional vertical wheel input there keeps the existing volume-up/down actions and prevents simultaneous page scrolling. Events elsewhere remain untouched. Horizontal gestures, Ctrl/Meta zoom gestures, previously canceled events, and open dialogs do not change volume. Slider dragging, clicking, keyboard controls, and mute behavior remain unchanged.

Three event regression tests pass, covering pixel/line deltas over the page and chat, explicit volume adjustments, horizontal/zoom gestures, dialogs, and teardown. Typecheck and production build pass. Actual physical touchpad and mouse testing remains an owner acceptance check; no native Jellyfin Desktop wheel handling was modified.
