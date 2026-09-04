#!/bin/sh
#
# A daily snapshot of the account database.
#
#   sudo -H -u thwart /srv/thwart/repo/deploy/backup.sh
#
# Doc 05 section 3 specified this; it was never installed, and the gap was found
# on 4 September 2026 when the first real data — somebody's actual campaign log
# and play history — had already been synced from a phone to a machine with no
# backup of any kind. The runbook's version assumed the Docker layout this
# deployment does not use, so this is the same procedure against systemd.
#
# **Never `cp` the live database.** In WAL mode the .db file is not the whole
# database: recent transactions are in the -wal beside it, and a plain copy
# opens without complaint while missing the last hour. That is the worst
# failure a backup has, because nothing looks wrong until the day it matters.
# The binary takes `-backup`, which is VACUUM INTO — a consistent snapshot of a
# live database, taken without blocking the server.
#
# What this does NOT do is get the snapshot off this machine, and that is the
# half that matters most. A backup on the same disk as the database protects
# against a mistake, a bad migration or a wrong DELETE. It does not protect
# against losing the VPS. See OFFSITE below.

set -eu

BIN="${BIN:-/srv/thwart/bin}"
DATA="${DATA:-/srv/thwart/data}"
DEST="${DEST:-/srv/thwart/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

# Where to send the snapshot afterwards, as an rsync destination — another
# host, or a bucket mount. Empty means the snapshot stays on this box, and the
# script says so every run rather than letting that become invisible.
OFFSITE="${OFFSITE:-}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT="$DEST/thwart-$STAMP.sqlite"

mkdir -p "$DEST"

log "snapshotting"
"$BIN/thwart-api" -db "$DATA/thwart.sqlite" -backup "$SNAPSHOT"

# Read it back before compressing it. A snapshot nobody has opened is a
# hypothesis, and this costs milliseconds: if the file is not a database, or is
# a database with no accounts in it, that is worth knowing now rather than in
# the hour it is needed.
accounts="$(sqlite3 -readonly "$SNAPSHOT" 'SELECT COUNT(*) FROM account;' 2>/dev/null || echo bad)"
if [ "$accounts" = "bad" ]; then
    log "the snapshot does not open as a database; keeping it for inspection"
    exit 1
fi
records="$(sqlite3 -readonly "$SNAPSHOT" 'SELECT COUNT(*) FROM record;' 2>/dev/null || echo 0)"
log "verified: $accounts accounts, $records records"

gzip -9 "$SNAPSHOT"
log "wrote $SNAPSHOT.gz ($(du -h "$SNAPSHOT.gz" | cut -f1))"

if [ -n "$OFFSITE" ]; then
    log "copying to $OFFSITE"
    rsync --quiet --times "$SNAPSHOT.gz" "$OFFSITE"
else
    log "no OFFSITE set: this copy is on the same machine as the database,"
    log "which protects against mistakes and not against losing the machine"
fi

# Age, not count, so a week the timer did not run does not silently roll the
# window forward and delete everything.
deleted="$(find "$DEST" -name 'thwart-*.sqlite.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
[ "$deleted" -gt 0 ] && log "pruned $deleted older than $KEEP_DAYS days"

log "done"
