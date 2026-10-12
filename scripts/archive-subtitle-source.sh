#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
commit=2d4ec9b16a639f23733cd32982e09e0eb757f092
target="$root/upstream/subtitle-source"
test ! -e "$target" || { echo 'Refusing to overwrite subtitle source.' >&2; exit 1; }
git init "$target"
git -C "$target" remote add origin https://github.com/jellyfin/JavascriptSubtitlesOctopus.git
git -C "$target" fetch --depth=1 origin "$commit"
git -C "$target" checkout --detach FETCH_HEAD
test "$(git -C "$target" rev-parse HEAD)" = "$commit"
git -C "$target" submodule update --init --recursive --depth 1
# Includes the pinned C/C++ libraries, licences and compilation scripts, not
# merely the precompiled WASM files shipped by the npm package.
mkdir -p "$root/release"
git -C "$target" submodule status --recursive > "$root/release/SUBTITLE-SOURCE-REVISIONS.txt"
tar --exclude='.git' -czf "$root/release/subtitle-renderer-corresponding-source.tar.gz" -C "$target" .
