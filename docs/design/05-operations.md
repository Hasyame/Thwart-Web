# 05 — Operations

What you will actually have to run. Written for someone who administers Debian
and nginx for a living, so it skips the basics and concentrates on the decisions
specific to this service.

---

## 1. Container layout

Two images, one compose file, one `.env`.

```
thwart-api    Go binary, FROM scratch + ca-certificates. ~15 MB.
              Volume: /data  (SQLite file + WAL)
              Listens: 127.0.0.1:8080

thwart-web    Static build output on nginx:alpine, or served by the API.
              No state.
              Listens: 127.0.0.1:8081
```

Nothing else. No database container, no Redis, no queue — that is the
consequence of ADR-202 and it is most of the value of it.

```yaml
# docker-compose.yml
services:
  api:
    image: ghcr.io/hasyame/thwart-api:${THWART_VERSION:-latest}
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/data
    ports:
      - "127.0.0.1:8080:8080"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    healthcheck:
      test: ["CMD", "/thwart-api", "-healthcheck"]
      interval: 30s
      timeout: 3s
      retries: 3

  web:
    image: ghcr.io/hasyame/thwart-web:${THWART_VERSION:-latest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:8081:8081"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
```

Both bind to loopback only. TLS and the public interface are nginx's problem, on
the host, where you already have certbot and a renewal cron that works.

`read_only: true` with an explicit `/data` volume means the only writable path
in the API container is the one holding the database. The healthcheck is the
binary invoking itself rather than a shell, because `FROM scratch` has no shell —
which is a feature, not an obstacle.

### `.env`

```dotenv
# The only genuinely secret value. 32 random bytes, base64.
# Generate: openssl rand -base64 32
THWART_SESSION_KEY=

# Public origin, used for CORS and for links in responses.
THWART_PUBLIC_URL=https://sync.example.org

# Where the database lives inside the container.
THWART_DB_PATH=/data/thwart.db

# Set false to close an instance to new accounts once yours exist.
THWART_REGISTRATION_OPEN=true

# Tombstone retention, days. Doc 02 §5. Clients offline longer full-resync.
THWART_TOMBSTONE_DAYS=180

# text | json. json for a log aggregator, text for reading by eye.
THWART_LOG_FORMAT=text
```

Seven variables, one of which is a secret. That is the whole configuration
surface, and keeping it that small is a deliberate goal — every option is a
thing a self-hoster can get wrong and then ask you about.

`THWART_REGISTRATION_OPEN=false` matters more than it looks: a personal instance
with open registration is an invitation to have your disk filled by a stranger.
Document turning it off after creating your own accounts.

---

## 2. nginx

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name sync.example.org;

    ssl_certificate     /etc/letsencrypt/live/sync.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sync.example.org/privkey.pem;

    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    # Doc 02 caps a push at 2 MB; leave a little headroom and reject the rest
    # here rather than in the application.
    client_max_body_size 4m;

    # Sync is not interactive. A long timeout costs nothing and avoids
    # truncating a large first upload on a slow mobile connection.
    proxy_read_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }

    # No access log for the sync endpoints. See §5.
    location /v1/sync/ {
        access_log off;
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}
```

The web app is a second `server` block on its own name, serving static files,
with a long `Cache-Control` on hashed assets and none on `index.html` and the
service worker. Nothing surprising.

**No `X-Forwarded-For` trust without care.** The API uses the client address for
rate limiting only. It must take it from `X-Forwarded-For` *only* when the
connection comes from the proxy's own address, or a stranger sets the header and
rate limiting evaporates. This is worth a config flag naming the trusted proxy
rather than a blanket "trust the last hop".

TLS: certbot with the nginx plugin, renewal via the packaged systemd timer.
Nothing about this service is unusual, and HSTS is safe because there is no
plaintext use case — the Android client should refuse `http://` origins outright.

---

### The live sync stream

`GET /api/v1/sync/stream` is a Server-Sent Events response that never ends. It
needs its own location because its timeouts differ from every other endpoint's,
and it must come **before** `location /api/` — nginx takes the longest matching
prefix.

Four directives, and what happens if each is missed:

| Directive | If you leave it out |
|---|---|
| `proxy_buffering off` | nginx holds events until its buffer fills. The feature looks broken rather than slow — the commonest way to get this wrong. The handler also sends `X-Accel-Buffering: no`, so this is true twice. |
| `proxy_read_timeout 1h` | The default 60s closes an idle stream every minute. Not fatal: the client reconnects and catches up, so it degrades to polling. |
| `proxy_http_version 1.1` | HTTP/1.0 upstream has no chunked transfer, so the response cannot stream at all. |
| `access_log off` | **A live credential is written to a plaintext file on every connect.** `EventSource` cannot send an `Authorization` header, so this is the one route whose token travels in the query string, and the access log records the full request line. This one is not optional. |

Also raise the descriptor limit. Each connected browser holds one socket in
nginx and one upstream, and the default `ulimit -n` of 1024 starts to matter at
a few hundred users — with a failure mode (`accept: too many open files`) that
refuses ordinary requests, not just streams. `LimitNOFILE=8192` is set on the
unit; raise `worker_connections` in nginx to match if you expect that many.

**Behind Cloudflare or another CDN**: buffering has to be off there too.
Cloudflare does not buffer `text/event-stream`, but its 100-second idle timeout
applies — harmless here, because the server sends a comment every 20 seconds.

**What it costs.** Per connection: about 20 KB in the Go process and 16 KB in
nginx. Two hundred concurrent users is roughly 6.5 MB and 3 MB — noise against
the 384 MB soft cap in the unit file. The idle CPU is one heartbeat per
connection every 20 seconds. See doc 07 §6.

## 3. Backup and restore

The whole procedure, because with SQLite it fits here.

### Backup

```bash
#!/bin/sh
# /usr/local/bin/thwart-backup — daily via systemd timer
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=/var/backups/thwart

mkdir -p "$DEST"
# VACUUM INTO takes a consistent snapshot of a live database without
# blocking writers and without copying the WAL separately.
docker compose -f /srv/thwart/docker-compose.yml exec -T api \
    /thwart-api -backup "/tmp/thwart-$STAMP.db"
docker compose -f /srv/thwart/docker-compose.yml cp \
    "api:/tmp/thwart-$STAMP.db" "$DEST/thwart-$STAMP.db"
docker compose -f /srv/thwart/docker-compose.yml exec -T api \
    rm -f "/tmp/thwart-$STAMP.db"

gzip -9 "$DEST/thwart-$STAMP.db"
find "$DEST" -name 'thwart-*.db.gz' -mtime +30 -delete
```

**Never `cp` the live `.db` file.** In WAL mode the file on disk is not a
complete database — recent transactions are in `-wal`, and a naive copy gives
you a file that opens fine and is missing the last hour. `VACUUM INTO` is the
supported way to snapshot a live database, and the binary should expose it as a
`-backup` flag so the script does not need a `sqlite3` binary inside a
`FROM scratch` image.

Ship the snapshot off the box — rsync to another host, or to a bucket. A backup
on the same VPS protects against your mistakes and nothing else.

Size: a heavy user is a couple of megabytes, so a hundred users compress to well
under 100 MB. Thirty daily snapshots is a rounding error on any disk.

### Restore

```bash
docker compose stop api
gunzip -c /var/backups/thwart/thwart-20260914T030000Z.db.gz > /srv/thwart/db/thwart.db
rm -f /srv/thwart/db/thwart.db-wal /srv/thwart/db/thwart.db-shm
docker compose start api
```

Four commands. Deleting the stale `-wal` and `-shm` matters: leaving them beside
a restored database is the one way to corrupt this.

**Perform a restore once, on purpose, before Phase 0b is declared done.**
Restore into a throwaway container, register nothing, sign in with a client and
confirm the data is there. A backup nobody has restored is a hypothesis.

Clients also make this less frightening than it sounds. Every device holds a
full copy, so a catastrophic server loss with no backup at all means telling
users to sign in again and re-push — degraded, not fatal. That is a property
worth preserving and worth stating in the self-hosting documentation.

---

## 4. Schema migrations

The server's own schema — three tables — not the app's.

Embedded, numbered, forward-only SQL files run at startup inside a transaction,
with the applied version in a `schema_version` table. `embed.FS` puts them in
the binary, so there is no migration tool to install, no separate command to
forget, and no way to run a binary against a database it does not understand.

Rules:

- **Forward only.** No down migrations. Rolling back means restoring the backup
  taken immediately before, which is a procedure that actually works, unlike a
  down migration nobody has ever run.
- **The binary refuses to start against a newer schema than it knows.** Prevents
  an accidental downgrade quietly writing rows the newer version will misread.
- **Take a snapshot before migrating.** The startup path should call the same
  `VACUUM INTO` as the backup script when it is about to apply a migration, and
  refuse to proceed if it cannot.
- **Additive by default.** With `body` opaque, most protocol evolution needs no
  server migration at all — which was the point of ADR-101.

---

## 5. Log hygiene

You are in France and this is GDPR-relevant, so it is worth being specific about
what is deliberately *not* recorded.

**Never logged, at any level:**

- Record bodies. They contain the user's plays, decks and campaigns. A log line
  quoting one is an unencrypted second copy with a different retention policy.
- Passwords, recovery codes, session tokens — including prefixes. A token prefix
  is enough to correlate sessions across log lines.
- Handles. The account UUID is enough for every operational question; the handle
  is a name a person chose.
- Full request bodies on error. Log the error code and the record id.

**Logged:**

```
level=info msg="sync.push" account=018f2c3d records=12 revision=1851 dur=8ms
level=warn msg="sync.cursor_too_old" account=018f2c3d cursor=402 min=1204
level=info msg="auth.login" account=018f2c3d device=018f2c40 outcome=ok
```

Account and device identifiers are opaque UUIDs, which is what makes this
workable: you can follow one account's whole sync history through the logs
without the logs telling you who that is.

**IP addresses.** Needed for rate limiting, not for logging. Keep them in the
in-memory rate limiter and out of the log entirely — nginx's access log records
them anyway, which is where a sysadmin expects to find them and where your
existing rotation policy already applies. Set `access_log off` on `/v1/sync/`
(as in §2): those requests happen every few minutes per device, they tell you
nothing an application log line does not, and they otherwise build a precise
record of when each user's phone was awake. Keep the access log on the auth
endpoints, where it is genuinely useful for spotting an attack.

Rotation: nginx via the packaged logrotate; container logs via Docker's
`json-file` driver with `max-size` and `max-file` set, or `journald`. Either
way, cap them — an uncapped container log is the most common way a small VPS
fills its disk.

**Log retention: 14 days.** Long enough to investigate a bug reported at the
weekend, short enough that the logs are not a dataset.

---

## 6. Rate limiting

Three layers, cheapest first.

**nginx**, blunt and free, on the endpoints that matter:

```nginx
limit_req_zone $binary_remote_addr zone=thwart_auth:10m rate=10r/m;

location /v1/auth/ {
    limit_req zone=thwart_auth burst=5 nodelay;
    proxy_pass http://127.0.0.1:8080;
}
```

**In the API**, per account rather than per address, because a household behind
one IPv4 address is normal and a phone that changes networks is normal:

| Endpoint | Limit |
|---|---|
| `POST /v1/auth/login` | 5 per minute per handle, 20 per hour per address |
| `POST /v1/auth/register` | 3 per hour per address |
| `POST /v1/auth/recover` | 5 per hour per handle, and always constant-time |
| `POST /v1/sync/changes` | 60 per minute per account |
| `GET /v1/sync/changes` | 120 per minute per account |
| `GET /v1/account/export` | 5 per hour per account |
| `POST /v1/bgg/verify` | 10 per hour per account |
| `POST /v1/bgg/plays` | 60 per day per account |

A token-bucket map in memory. No Redis: a restart resetting the buckets is not
a security event at this scale.

**Argon2id itself** is the third layer. Tuned to roughly 100 ms it makes
credential stuffing expensive without the user noticing. Tune the parameters on
the actual VPS, not on your desktop — the memory cost is the parameter that will
surprise you on a 1 GB box, and `THWART_REGISTRATION_OPEN=false` is the real
defence for a personal instance anyway.

Rate-limit responses use `429` with `Retry-After`, and the client must honour it
with backoff rather than retrying in a tight loop — worth stating in the client
contract, since a badly behaved sync client is indistinguishable from an attack.

---

## 7. Sizing

Measured expectations rather than guesses about pricing, which changes.

**Per user, at rest:** a heavy user with 500 plays, 100 decks, 10 campaigns and
a full collection is roughly 2–5 MB of JSON, mostly `saved_decks.rawJson` and
`campaign_runs.templateJson`.

**Per sync:** a few kilobytes. A typical pull returns nothing at all.

**Process:** the Go binary idles around 20–30 MB RSS. Peak is dominated by
Argon2id, which is deliberately memory-hungry — with 64 MB per hash and a small
concurrency cap, budget 200–300 MB of headroom for the login path and nothing
for sync.

So:

| Users | Requirement |
|---|---|
| Just you, 2–3 devices | 1 vCPU, 1 GB RAM, 10 GB disk |
| Up to a few hundred | The same box, unchanged |
| Low thousands | 2 vCPU, 2 GB, and by then you have real numbers |

**The smallest tier either provider sells is enough** — Scaleway's Stardust or
DEV1-S, OVH's entry VPS. If you already run a VPS with nginx on it, this service
fits alongside whatever is there without a second box: two containers, 50 MB of
RAM, and a database file smaller than a photograph.

The realistic constraint is not CPU, memory or disk. It is that you have
promised to keep a service running, and the bill for that is paid in attention.
Which is the strongest operational argument for every choice in doc 03: one
binary, one file, one `docker compose up`, seven environment variables, and a
restore procedure of four commands.

---

## 8. Deployment

Added 2026-09-04, replacing "somebody runs two scripts over SSH".

### It pulls; GitHub never pushes

The obvious shape is a GitHub Actions job that SSHes in and deploys. It is
rejected. That key would let anyone with write access to the repository — and
every third-party action that ever runs in it, at whatever version it resolves
to that morning — open a shell on the machine holding the account database. The
whole posture of this server is that it makes no outbound connections and
accepts nothing inbound but nginx; a deploy credential in a CI provider
undoes that for a convenience.

So CI does not deploy. It moves two branch pointers, and the server decides on
its own timer what to do about them. A branch cannot open a shell.

| branch | moved by | means |
|---|---|---|
| `main` | you | the latest work |
| `release` | CI, automatically | this commit passed both halves of the suite |
| `api-release` | a person, by pressing **Release the API** | ship this to the account server |

The server already had SSH read access to the private repository for the
nightly card refresh, so this needed no new credential anywhere.

### What runs where

- `deploy/release.sh`, on a five-minute timer, is the whole decision. It
  fetches, compares the two branches against what is deployed, and acts.
- `deploy/update-api.sh` builds and installs the binary from `api-release`,
  then `release.sh` restarts the service through a one-command sudo rule
  (`deploy/thwart-release.sudoers` — `systemctl restart thwart-api` and
  nothing else).
- `deploy/update.sh` publishes the site from `release`.
- The nightly `thwart-update.timer` is unchanged and still owns the card data.
  Code and data are on separate clocks because they change for different
  reasons.

Both scripts still default to `main`, so running either by hand does what it
always did.

### The rule that matters

**The site is never published ahead of its API.** `release.sh` refuses to
publish when the `server/` tree at `release` differs from the one the running
binary was built from, and says so in the log.

This is not tidiness. On 4 September 2026 the API was deployed and the site was
not, and then the site caught up first on a later change: the front end had
learned to send an email address and the server had not, and every account
endpoint decodes with `DisallowUnknownFields`, so the field the new form always
sent came back `malformed_record`. Nobody could sign in or create an account.
The ordering was obvious in hindsight and entirely dependent on somebody
remembering it at the time, which is the definition of a thing to move into
code.

`update-api.sh` writes the commit it built to `/srv/thwart/bin/thwart-api.commit`
so this can be decided without the service being up.

### Rolling back

The site keeps its last three releases as directories and `current` is a
symlink, so a rollback is one `ln -sfn` — unchanged, and the reason nothing
here needs a rollback feature.

The API is a single binary built to a temporary name and moved into place, so a
failed build never replaces a working one. To go back a version, point
`api-release` at the older commit and wait five minutes; the timer treats
backwards the same as forwards.

---

## 9. The self-hosting document

A `SELFHOSTING.md` at the repository root is a Phase 0b deliverable, not an
afterthought — "someone must be able to clone the repo and run the whole stack
with a single `docker compose up`" is one of your non-negotiable constraints,
and an undocumented constraint is not met.

It must cover, in this order: clone, copy `.env.example`, generate the session
key, `docker compose up -d`, the nginx block, certbot, register the first
account, **close registration**, install the backup timer, and — last, because
it is the step everyone skips — perform one restore into a throwaway directory
to prove the backups work.

It should also state plainly what the server does and does not hold: one email
address per account, used to sign in and for nothing else, on accounts that
exist only because somebody asked for synchronisation — and beyond that, no
card data, no contact with MarvelCDB, and one outbound connection: to
BoardGameGeek, when a signed-in account asks the relay to post a play, with a
password the server forwards and forgets (`server/bgg.go`; off with
`-bgg-relay=false`). For somebody deciding whether to run a stranger’s code on
their box, that paragraph is the most useful one in the file.
