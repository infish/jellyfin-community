# Licensing and attribution

This is an unofficial Jellyfin Web customization, not a Jellyfin-endorsed product.

Jellyfin Web is copyright its original contributors and licensed under
GPL-2.0-or-later. Its copyright notices and licence are retained in the fetched
source. Our modifications are recorded in `patches/`, and are distributed under
GPL-2.0-or-later. The original backend, deployment files and documentation in this
repository are also licensed under GPL-2.0-or-later. See `LICENSE`.

Jellyfin Web: https://github.com/jellyfin/jellyfin-web

Each published container release must have matching, downloadable source assets
at https://github.com/infish/jellyfin-community/releases. These include the
modified web tree, installed web dependency sources, lockfiles, and an archive
of this repository containing the patch, backend and build/deployment scripts.
A patch by itself is not the complete corresponding source. Backend dependency
sources are included in a separate archive. Preserve these assets while the
associated images are distributed.

The bundled `@jellyfin/libass-wasm` 4.2.4 includes LGPL native subtitle libraries.
Its npm gitHead matches JavascriptSubtitlesOctopus commit
`2d4ec9b16a639f23733cd32982e09e0eb757f092`. Release assets additionally include
that exact source, its recursively pinned native libraries and their build
scripts/licences. `scripts/archive-subtitle-source.sh` records their revisions.
An npm package containing precompiled WASM alone does not supply those sources.

Web dependencies retain their own licence files and generated bundle notices.
Backend dependencies retain their licence files in the image's `node_modules`.
Do not remove upstream or dependency notices when changing the build.

Node.js and Caddy are third-party base images. Keep their original image contents
and notices; this project's licence does not relicense those components.

Seerr is optional, unmodified, and pulled from its official registry. It is not
bundled into our images. Its MIT licence and copyright remain with its upstream
authors: https://github.com/seerr-team/seerr

Jellyfin Server, Sonarr and Radarr are externally managed services and are not
redistributed as part of our images.
