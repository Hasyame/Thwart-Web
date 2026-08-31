#!/bin/sh
#
# Builds the site on the server and swaps it into place.
#
# Run by hand, and by the systemd timer overnight. Both do the same thing,
# because a deploy path that differs from the automated one is a deploy path
# that breaks the first time you need it at two in the morning.
#
#   sudo -u thwart /srv/thwart/repo/deploy/update.sh
#
# It builds into a fresh directory and moves a symlink, so nginx is never
# reading a directory that is half-written. If any step fails the live site is
# untouched, which matters because the card fetch talks to somebody else's
# server and that server is sometimes unwell.

set -eu

REPO="${REPO:-/srv/thwart/repo}"
RELEASES="${RELEASES:-/srv/thwart/releases}"
CURRENT="${CURRENT:-/srv/thwart/current}"
KEEP="${KEEP:-3}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cd "$REPO"

log "fetching"
git fetch --quiet origin main
git reset --quiet --hard origin/main

cd "$REPO/web"

# --include=dev explicitly: the build generates the theme and rasterises the
# icons, and both of those tools are devDependencies. A server with
# NODE_ENV=production set would otherwise install without them and fail.
log "installing"
npm ci --include=dev --no-audit --no-fund --silent

# Fetches both languages from MarvelCDB and refuses to write an implausibly
# small dataset, so a bad day there cannot replace the card database with forty
# cards. Failing here leaves the previous release serving.
log "fetching card data"
npm run --silent data

log "building"
npm run --silent build

STAMP="$(date -u +%Y%m%d%H%M%S)"
TARGET="$RELEASES/$STAMP"

log "publishing $STAMP"
mkdir -p "$TARGET"
cp -a dist/. "$TARGET/"

# Symlink swap: ln -sfn onto a temporary name then mv is atomic on the same
# filesystem, so no request ever sees a missing root.
ln -sfn "$TARGET" "$CURRENT.new"
mv -Tf "$CURRENT.new" "$CURRENT"

log "pruning old releases"
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -rf

log "done"
