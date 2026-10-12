#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
base=0e83c6a724b31f3e9b5a499244331a288c060a4a
target="$root/upstream/jellyfin-web"
if [ -e "$target" ]; then
    echo "Refusing to overwrite existing upstream checkout: $target" >&2
    echo "Use a fresh clone of this deployment repository to prepare release source." >&2
    exit 1
fi
mkdir -p "$root/upstream"
git init "$target"
git -C "$target" remote add origin https://github.com/jellyfin/jellyfin-web.git
git -C "$target" fetch --depth=1 origin "$base"
git -C "$target" checkout --detach FETCH_HEAD
test "$(git -C "$target" rev-parse HEAD)" = "$base"
git -C "$target" -c user.name='Jellyfin Community Build' -c user.email='build@localhost' \
    am "$root/patches/0001-Add-household-community-interface.patch"
