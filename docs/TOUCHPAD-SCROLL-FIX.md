# Touchpad scrolling and playback volume

Approved for release v0.1.0-alpha.6 on 2026-10-14.

The customized Jellyfin Web video controller registered a wheel listener on `document` while the player was visible. Every positive/negative vertical delta changed playback volume unless a modal dialog was open. It did not restrict the event to volume controls, so scrolling Community chat could also change volume. This code handles both touchpads and mouse wheels; the reported hardware-specific difference has not been independently reproduced.

The listener now belongs to `.volumeButtons` only, with lifecycle cleanup on leaving the player and before rebinding. Intentional vertical wheel input there keeps the existing volume-up/down actions and prevents simultaneous page scrolling. Events elsewhere remain untouched. Horizontal gestures, Ctrl/Meta zoom gestures, previously canceled events, and open dialogs do not change volume. Slider dragging, clicking, keyboard controls, and mute behavior remain unchanged.

Three event regression tests pass, covering pixel/line deltas over the page and chat, explicit volume adjustments, horizontal/zoom gestures, dialogs, and teardown. Typecheck and production build pass. Actual physical touchpad and mouse testing remains an owner acceptance check; no native Jellyfin Desktop wheel handling was modified.

## Alpha.7 follow-up: wheel over video

After alpha.6 deployment the owner clarified that the physical mouse-wheel shortcut over the video should remain. The local follow-up allows vertical wheel input on the bare playback page, native video container, HTML video element, and volume controls. Chat, text inputs, other controls, and page scrolling stay excluded. Horizontal and zoom gestures, dialogs, and lifecycle cleanup are preserved. Both mouse and touchpad wheel events over the bare video can adjust volume; no device-identification heuristic is used.

Four regression tests and typecheck pass. Native Desktop source confirms its video container uses the same class. The owner approved release v0.1.0-alpha.7 and TrueNAS deployment on 2026-10-14. Production build and release patch preparation checks pass; actual hardware verification remains pending.
