#!/bin/sh
#
# Builds the site on the server and swaps it into place.
#
# Run by hand, and by the systemd timer overnight. Both do the same thing,
# because a deploy path that differs from the automated one is a deploy path
# that breaks the first time you need it at two in the morning.
#
#   sudo -H -u thwart /srv/thwart/repo/deploy/update.sh
#
# It builds into a fresh directory and moves a symlink, so nginx is never
# reading a directory that is half-written. If any step fails the live site is
# untouched, which matters because the card fetch talks to somebody else's
# server and that server is sometimes unwell.
#
# It publishes only when something actually changed. That is not about saving
# the thirteen seconds a rebuild costs; it is about the three kept releases
# being three different things. Publishing nightly regardless fills all three
# slots with identical copies within three quiet nights, and the release you
# would want to roll back to is the one that has just been deleted.
#
#   --force   publish even if nothing changed

set -eu

REPO="${REPO:-/srv/thwart/repo}"
RELEASES="${RELEASES:-/srv/thwart/releases}"
CURRENT="${CURRENT:-/srv/thwart/current}"
KEEP="${KEEP:-3}"
# Which branch to build. `main` by default, so running this by hand does what
# it always did; release.sh passes `release`, which only moves when CI is green.
REF="${REF:-main}"
# Skip the card fetch if the data on disk is younger than this. The nightly run
# is 24 hours apart and always fetches; this only bites when several releases
# land in one afternoon, and MarvelCDB is run by volunteers.
MAX_DATA_AGE_HOURS="${MAX_DATA_AGE_HOURS:-20}"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Digest of the card data as it stands, or nothing if it has never been
# fetched. meta.json is written by scripts/fetch-cards.mjs.
data_digest() {
    sed -n 's/.*"digest": "\([0-9a-f]*\)".*/\1/p' "$REPO/web/public/data/meta.json" 2>/dev/null | tail -1
}

cd "$REPO"

WAS_HEAD="$(git rev-parse HEAD 2>/dev/null || echo none)"
WAS_DIGEST="$(data_digest)"

log "fetching $REF"
git fetch --quiet origin "$REF"
# Detached, not `reset --hard` on a branch: this clone is checked out on
# main, and resetting would drag the local main pointer to whichever ref
# was deployed last. Untracked files are left alone deliberately, because
# node_modules and the card data live there and both are expensive.
git checkout --quiet --force --detach "origin/$REF"

NOW_HEAD="$(git rev-parse HEAD)"

cd "$REPO/web"

# --include=dev explicitly: the build rasterises the PWA icons, and that tool
# is a devDependency. A server with NODE_ENV=production set would otherwise
# install without it and fail. The theme used to be generated here too; it is
# a source file now.
log "installing"
npm ci --include=dev --no-audit --no-fund --silent

# Fetches both languages from MarvelCDB and refuses to write an implausibly
# small dataset, so a bad day there cannot replace the card database with forty
# cards. Failing here leaves the previous release serving.
#
# Skipped when what is already on disk is recent. The card database moves in
# weeks and this is somebody else's volunteer-run server; three deploys in an
# afternoon should not mean three full downloads of it.
if [ -n "$(find "$REPO/web/public/data/meta.json" -mmin "-$((MAX_DATA_AGE_HOURS * 60))" 2>/dev/null)" ]; then
    log "card data is under ${MAX_DATA_AGE_HOURS}h old; keeping it"
else
    log "fetching card data"
    npm run --silent data
fi

NOW_DIGEST="$(data_digest)"

if [ "$FORCE" -eq 0 ] &&
   [ "$WAS_HEAD" = "$NOW_HEAD" ] &&
   [ "$WAS_DIGEST" = "$NOW_DIGEST" ] &&
   [ -e "$CURRENT" ]; then
    log "nothing changed; keeping $(basename "$(readlink -f "$CURRENT")")"
    exit 0
fi

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
