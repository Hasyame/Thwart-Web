#!/bin/sh
#
# Takes whatever GitHub has marked as ready, and nothing else.
#
#   sudo -H -u thwart /srv/thwart/repo/deploy/release.sh
#
# Run by a timer every few minutes. It is the pull half of the deployment: CI
# moves two branch pointers and this decides what to do about them, so nothing
# in GitHub holds a credential for this machine. A branch cannot open a shell.
#
#   release      every commit that passed CI on main. Moved automatically.
#   api-release  the commit a person pressed the button for. Moved by hand.
#
# The API is built and restarted from `api-release`. The site is published from
# `release` — but only when the server directory at `release` is identical to
# the one already running, which is the rule that matters:
#
#   A site newer than its API is how registration broke on 4 September 2026.
#   The front end had learned to send an email address and the server had not,
#   and every account endpoint decodes with DisallowUnknownFields, so the field
#   the new form always sent was refused as malformed. Nobody could sign in or
#   create an account until the API caught up. The ordering is not a
#   convention to remember any more; it is enforced here, and a site that would
#   run ahead of its server waits and says so.
#
# Nothing here is destructive on failure. Each half builds into a temporary
# name and moves it into place, so a build that breaks leaves the running one
# serving.
#
#   --force   publish the site even if nothing changed

set -eu

REPO="${REPO:-/srv/thwart/repo}"
BIN="${BIN:-/srv/thwart/bin}"
# Written only after the running API passes health and version checks.
STAMP="$BIN/thwart-api.commit"
BUILT="$BIN/thwart-api.built"
API_URL="${API_URL:-http://127.0.0.1:8787/v1}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

. "$REPO/deploy/api-ready.sh"

# Re-exec from a copy of this file.
#
# Both update scripts `git reset --hard` the repository this script lives in,
# which rewrites this file while the shell is still reading it. A shell reads a
# script incrementally, so the second half of a deploy would come from the new
# file at whatever byte offset the old one had reached — which is a bug that
# only appears when this script itself changes, i.e. exactly when it is being
# updated and least likely to be watched.
if [ "${THWART_RELEASE_SNAPSHOT:-}" != "1" ]; then
    snapshot="$(mktemp)"
    cat "$0" > "$snapshot"
    chmod +x "$snapshot"
    THWART_RELEASE_SNAPSHOT=1
    export THWART_RELEASE_SNAPSHOT
    exec "$snapshot" "$@"
fi
# Reached only in the snapshot, where $0 is the copy.
trap 'rm -f "$0"' EXIT

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

cd "$REPO"

# Fetch only. Resetting here would rewrite the working tree before the two
# halves have been given their own refs to reset to.
git fetch --quiet --prune origin

resolve() { git rev-parse --verify --quiet "refs/remotes/origin/$1" || true; }

RELEASE="$(resolve release)"
API_TARGET="$(resolve api-release)"

if [ -z "$RELEASE" ]; then
    log "no release branch yet; nothing has passed CI on main"
    exit 0
fi

API_CURRENT=""
[ -f "$STAMP" ] && API_CURRENT="$(cat "$STAMP")"

# --- the API, first ----------------------------------------------------------

if [ -z "$API_TARGET" ]; then
    log "no api-release branch yet; the API has never been released from here"
elif [ "$API_TARGET" = "$API_CURRENT" ] && healthy_at "$API_TARGET"; then
    log "api up to date at $(git rev-parse --short "$API_CURRENT")"
else
    # A failed restart must be retried, even if the correct binary is on disk.
    if [ ! -f "$BUILT" ] || [ "$(cat "$BUILT")" != "$API_TARGET" ]; then
        log "api $(git rev-parse --short "$API_TARGET"): building"
        REF=api-release COMMIT="$API_TARGET" "$REPO/deploy/update-api.sh"
    fi
    log "api: restarting"
    # The unit file allows exactly this one command to this one user, so the
    # deploy needs no general sudo. See deploy/thwart-release.sudoers.
    sudo -n /usr/bin/systemctl restart thwart-api
    attempt=0
    until healthy_at "$API_TARGET"; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 15 ]; then
            log "site held: API health/version did not confirm the new build"
            exit 1
        fi
        sleep 1
    done
    printf '%s' "$API_TARGET" > "$STAMP.new"
    mv -f "$STAMP.new" "$STAMP"
    API_CURRENT="$API_TARGET"
    log "api now $(git rev-parse --short "$API_CURRENT")"
fi

# --- then the site, if its server half is already running --------------------

if [ -z "$API_CURRENT" ]; then
    log "site held: the API has never been deployed, so there is nothing to match"
    exit 0
fi

if ! healthy_at "$API_CURRENT"; then
    log "site held: the running API does not match its confirmed build"
    exit 1
fi

if ! git diff --quiet "$API_CURRENT" "$RELEASE" -- server; then
    log "site held at $(git rev-parse --short "$RELEASE"): it expects a newer API"
    log "press Release the API in the Actions tab, and this will follow on its own"
    exit 0
fi

SITE_CURRENT=""
[ -f "$BIN/thwart-site.commit" ] && SITE_CURRENT="$(cat "$BIN/thwart-site.commit")"

if [ "$FORCE" -eq 0 ] && [ "$RELEASE" = "$SITE_CURRENT" ]; then
    log "site up to date at $(git rev-parse --short "$RELEASE")"
    exit 0
fi

log "site $(git rev-parse --short "$RELEASE"): publishing"
if [ "$FORCE" -eq 1 ]; then
    REF=release COMMIT="$RELEASE" "$REPO/deploy/update.sh" --force
else
    REF=release COMMIT="$RELEASE" "$REPO/deploy/update.sh"
fi
printf '%s' "$RELEASE" > "$BIN/thwart-site.commit"
log "site now $(git rev-parse --short "$RELEASE")"
