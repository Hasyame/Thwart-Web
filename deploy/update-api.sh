#!/bin/sh
#
# Builds the account server and restarts it.
#
#   sudo -H -u thwart /srv/thwart/repo/deploy/update-api.sh
#   sudo systemctl restart thwart-api
#
# Deliberately separate from update.sh, and deliberately not on the nightly
# timer. update.sh refreshes card data every night and swaps a directory of
# static files, which nobody notices. This restarts a process holding a
# database, so it runs when a release is actually being made.
#
# The binary is built to a temporary name and moved into place, so a failed
# build leaves the running one alone. The move is atomic on the same
# filesystem, and systemd re-execs the new file on the next restart.

set -eu

REPO="${REPO:-/srv/thwart/repo}"
BIN="${BIN:-/srv/thwart/bin}"
DATA="${DATA:-/srv/thwart/data}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cd "$REPO"

log "fetching"
git fetch --quiet origin main
git reset --quiet --hard origin/main

mkdir -p "$BIN" "$DATA"

cd "$REPO/server"

# Tests before build, always. They cover the parts that are hard to notice
# going wrong: that a password change signs the other devices out, that a spent
# recovery code cannot be replayed, that one account cannot revoke another's
# device.
log "testing"
go test ./...

log "building"
# CGO off: modernc.org/sqlite is pure Go, so the result has no shared library
# to go missing and can be copied to a box with nothing installed on it.
CGO_ENABLED=0 go build -trimpath -o "$BIN/thwart-api.new" .

mv -f "$BIN/thwart-api.new" "$BIN/thwart-api"

log "built $(git rev-parse --short HEAD)"
log "now run: sudo systemctl restart thwart-api"
# The running build is reported by GET /api/v1/version, so the restart can be
# confirmed from outside rather than taken on trust.
