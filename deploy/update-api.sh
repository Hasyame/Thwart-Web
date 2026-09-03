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

# Resolve with libc rather than Go's own resolver.
#
# Go's resolver does not read /etc/gai.conf, so on a host whose IPv6 is
# half-working it will open an IPv6 connection that succeeds at the TCP level
# and then returns 403 from the other end. Happy eyeballs does not save you
# there: the connection worked, only the answer was wrong.
#
# The deployment host is exactly such a machine (docs/deployment.md section 8),
# and the symptom is "reading https://proxy.golang.org/...zip: 403 Forbidden"
# on a module that downloads fine over IPv4. Using libc makes the gai.conf
# preference apply. Harmless on a healthy host.
export GODEBUG=netdns=cgo

# Go's own directory, added rather than assumed.
#
# `sudo -H -u thwart update-api.sh` runs the script directly, not through a
# login shell, so nothing sources /etc/profile.d and PATH is sudo's secure_path
# — which does not include /usr/local/go/bin. The symptom is a deploy that
# fetches, then fails on `go: not found` while `go` works perfectly well when
# you ssh in and type it, which is a confusing ten minutes at the wrong moment.
PATH="/usr/local/go/bin:$PATH"
export PATH

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
