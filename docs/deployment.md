# Deploying thwart.app

The site is static files served by nginx, alongside one Go account/sync API
and a SQLite database. There are no containers. The release timer pulls tested
branch pointers every five minutes; the nightly timer refreshes card data.
See [AGENTS.md](../AGENTS.md) for the verified host layout and agent permissions.
Commands below are Linux host commands, not local PowerShell commands.

Target: `thwart.app` on `92.222.65.177`. DNS already resolves.

## The one thing that will catch you out

**`.app` is in the HSTS preload list as an entire top-level domain.** Every
mainstream browser refuses plain HTTP to any `.app` name before it makes a
request, whatever the server says. So there is no "get it running on port 80
and add TLS later" stage here; until the certificate is installed the site does
not load at all, and the failure looks like a browser error rather than
anything you can see in a log.

Certbot's `http-01` challenge still works on port 80, because Let's Encrypt
validates it itself and does not consult the preload list. So the ordering
below is fine, it is only your own browser that will not talk to it yet.

## 1. A user, and somewhere to put it

```bash
adduser --system --group --home /srv/thwart --shell /usr/sbin/nologin thwart
mkdir -p /srv/thwart/releases
chown -R thwart:thwart /srv/thwart
```

Nothing here runs as root. The site is built and swapped by `thwart`, and nginx
only reads.

## 2. Node

The build needs Node 20 or later. Debian's own package is usually older, so
take it from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git nginx
```

## 3. The repository

The repository is private, so the server needs its own read-only key rather
than yours.

**Use `sudo -H -u thwart`, not `sudo -u thwart`.** Without `-H`, sudo leaves
`$HOME` pointing at root's home, so ssh looks for the key in `/root/.ssh`,
finds nothing, and the clone fails with `Permission denied (publickey)` even
though the key exists and is registered. The systemd unit is unaffected: it
sets `HOME` from the account itself.

```bash
install -d -m 700 -o thwart -g thwart /srv/thwart/.ssh
sudo -H -u thwart ssh-keygen -t ed25519 -f /srv/thwart/.ssh/id_ed25519 -N '' -C 'thwart.app deploy'
cat /srv/thwart/.ssh/id_ed25519.pub
```

Add that public key to the repository on GitHub as a **deploy key**, read-only:
Settings, Deploy keys, Add deploy key. A deploy key is scoped to one
repository, which a personal access token is not.

Check it before cloning, because this reports the two failures differently:

```bash
sudo -H -u thwart ssh -o StrictHostKeyChecking=accept-new -T git@github.com
```

- `Hi Hasyame/Thwart-Web! You've successfully authenticated...` means it works.
- `Permission denied (publickey)` **with no key offered** in `-v` output means
  ssh did not find the key: the `$HOME` problem above.
- A key offered and still denied means the key is not on GitHub yet, or was
  added to the wrong repository.

```bash
sudo -H -u thwart git clone git@github.com:Hasyame/Thwart-Web.git /srv/thwart/repo
```

The exec bit on `deploy/update.sh` is committed, so no `chmod` is needed.

## 4. First build

```bash
sudo -H -u thwart /srv/thwart/repo/deploy/update.sh
```

It fetches both card databases from MarvelCDB, builds, writes a timestamped
release and points `/srv/thwart/current` at it. Expect a few minutes, mostly
the card fetch. If it fails, nothing is published and the previous release
keeps serving; on the very first run there is simply no site yet.

## 5. nginx

The `location ~ ^/(card|cards|...)` list names every page of the app. A
new page — `/achievements` was the last — has to be added to the **live**
file by hand (never `cp` the repo's over it once certbot has run), then
`nginx -t && systemctl reload nginx`; without it a direct hit on the new
address answers 404 while in-app navigation still works.

```bash
cp /srv/thwart/repo/deploy/nginx-thwart.app.conf /etc/nginx/sites-available/thwart.app
ln -s /etc/nginx/sites-available/thwart.app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

**Once certbot has run (section 6), never copy this file over the live one
again.** Certbot rewrites `/etc/nginx/sites-available/thwart.app` in place —
it adds the `listen 443 ssl` lines, the certificate paths and the port-80
redirect — and the repository's copy has none of them. Copying it back took
HTTPS down on 2026-09-13; the way back was `certbot --nginx -d thwart.app -d
www.thwart.app --reinstall --redirect`, which re-adds what it had added.

So when `deploy/nginx-thwart.app.conf` changes in the repository, carry the
change into the live file by hand:

```bash
diff /srv/thwart/repo/deploy/nginx-thwart.app.conf /etc/nginx/sites-available/thwart.app
# edit the live file, keeping every line certbot wrote
nginx -t && systemctl reload nginx
```

The routing block at the foot of the file lists the app's routes, so a route
added to the web app is added there too; a path outside the list is answered
404 with the document, which is what lets a search engine tell a missing page
from the home page. **A new route is a 404 in production until this list is
carried to the host** (the draft's `/draft` was, for an afternoon). Adding
one is a one-line edit of the live file:

```bash
sed -i 's#|history)(/|\$)#|history|NEWROUTE)(/|$)#' /etc/nginx/sites-available/thwart.app
nginx -t && systemctl reload nginx
```

## 6. TLS

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d thwart.app -d www.thwart.app
```

Certbot edits the server block in place, adding the 443 listeners, the
certificate paths and the redirect from 80. Renewal is the packaged systemd
timer; check it with `systemctl list-timers certbot.timer`.

**Now** the site should load in a browser.

## 7. The nightly rebuild

This is what keeps the card database current, and it is the reason the build
runs on the server rather than on your laptop: a laptop is asleep at 01:23.

```bash
cp /srv/thwart/repo/deploy/thwart-update.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now thwart-update.timer
systemctl list-timers thwart-update.timer
```

To watch a run:

```bash
systemctl start thwart-update.service
journalctl -u thwart-update.service -f
```

**A run usually publishes nothing, and that is the point.** The script compares
the git revision and the card-data digest against what it already had, and if
neither moved it keeps the release that is live. Publishing every night
regardless is not merely wasteful: three quiet nights fill all three kept
release slots with identical copies, and the release you would want to roll
back to is the one that has just been pruned.

The card database moves in weeks, not hours, so most nights the log reads:

```
nothing changed; keeping 20260831071115
```

Use `update.sh --force` to publish anyway, which is worth doing after changing
the build itself.

## 8. The account API

Optional. The site works without it: everything is local to the browser until
somebody chooses to make an account. Skip this section entirely if you are not
running accounts yet.

Go is needed on the server, and only for building.

```bash
# -4 deliberately, and the checksum is from https://go.dev/dl/?mode=json.
curl -4 -fsSL https://dl.google.com/go/go1.27.0.linux-amd64.tar.gz -o /tmp/go.tgz
echo "675c26c449cbb18fc24b74650de1eabbae6e16f64326fd85a283fb3b58280685  /tmp/go.tgz" | sha256sum -c
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz
echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee /etc/profile.d/go.sh
```

Build it and put the unit in place:

```bash
sudo -H -u thwart /srv/thwart/repo/deploy/update-api.sh
sudo cp /srv/thwart/repo/deploy/thwart-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now thwart-api
```

The database lives in `/srv/thwart/db`, not `/srv/thwart/data`. It was
`data` until 11 September 2026, and the rename is deliberate: the web app
serves its card index and campaign templates at `https://thwart.app/data/…`,
and two things called `data` -- one public by design, one the account
database -- invited exactly the scare it caused. Nothing under the web root
was ever the database (nginx's root is `/srv/thwart/current`, a sibling), but
a name that needs that explanation is the wrong name. A host installed before
the rename moves it once, with the service stopped, and takes the new unit:

```bash
sudo systemctl stop thwart-api
sudo mv /srv/thwart/data /srv/thwart/db
sudo cp /srv/thwart/repo/deploy/thwart-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start thwart-api
curl -s http://127.0.0.1:8787/v1/version
```

`mv` on the same filesystem is a rename of the directory entry, so the WAL and
shared-memory files beside the database move with it and nothing is copied.

The service listens on `127.0.0.1:8787` and nothing outside the box can reach
it. nginx is the only way in, through the `location /api/` block in
`deploy/nginx-thwart.app.conf`.

**Do not copy that file over the live one.** The repository holds the config as
it looks *before* certbot has touched it; the live file has certbot's additions
(the `listen 443` lines, the certificate paths and the whole port 80 redirect
block), and overwriting it takes TLS down. Insert the block instead:

```bash
cp /etc/nginx/sites-available/thwart.app{,.bak-$(date -u +%Y%m%d%H%M%S)}
# paste the "# ---- the API" block from the repository file in before
# "# ---- routing", then:
nginx -t && systemctl reload nginx
```

### This host and IPv6

Worth knowing before something else fails mysteriously. The machine has a
global IPv6 address whose routing works to some networks and not others:
github.com and marvelcdb.com both fail over IPv6 and succeed over IPv4, and
Google Cloud Storage answers 403 over IPv6 for a file it serves over IPv4.

Most things hide it. curl, git and Node go through glibc, so
`/etc/gai.conf` now carries `precedence ::ffff:0:0/96 100` and they prefer
IPv4. Go does not: its own resolver ignores gai.conf, and because the bad IPv6
connections *succeed* at the TCP level and only return the wrong answer, happy
eyeballs never falls back. That is why `update-api.sh` exports
`GODEBUG=netdns=cgo`.

The real fix is with the provider. Until then, anything new that fetches from
the internet on this box should be tested over both families before it is
trusted.

Check it from outside:

```bash
curl -s https://thwart.app/api/v1/health
curl -s https://thwart.app/api/v1/version
```

`version` reports the git revision it was built from, so a restart can be
confirmed rather than assumed.

**The X-Forwarded-For header is not optional.** Behind nginx every request
arrives from `127.0.0.1`. The server trusts the header only when the peer is
loopback or private, which is exactly this case; without `proxy_set_header
X-Forwarded-For` the rate limiter puts the entire internet in one bucket and
locks everybody out together.

### Backing it up

This is the first thing on the server that is not rebuildable. One SQLite file,
a few megabytes at most:

```bash
apt-get install -y sqlite3   # not installed by default
sudo -u thwart sqlite3 /srv/thwart/db/thwart.sqlite     ".backup '/srv/thwart/db/backup-$(date -u +%Y%m%d).sqlite'"
```

`.backup` rather than `cp`, because the database runs in WAL mode and copying
the file while a write is in flight gives you a database that is missing the
end of it. Doc 05 has the retention argument; the short version is that a
automatic timer uses the API snapshot command, verifies the copy, compresses it
and retains 30 days under `/srv/thwart/backups/`. Off-site storage is not confirmed.

### Raising the Argon2 cost

`auth.go` hashes at 64 MiB per attempt, and `thwart-api.service` caps the
service at 512 MB with a soft limit at 384 MB. If logins start being refused
under load, the memory cap is the first number to look at, not the Argon2
parameters. Every hash records the parameters it was made with, so raising them
later does not invalidate a single existing account.

## Deploying a change

Push to `main` only after the owner authorizes it. Green Web and Server CI jobs
advance `release`. The five-minute release timer then publishes compatible
site changes. To run that same release flow immediately on the host:

```bash
sudo -H -u thwart /srv/thwart/repo/deploy/release.sh
```

The service pulls, builds and swaps the symlink. nginx needs no reload: it
resolves the symlink per request.

Any `server/` difference holds the site until the owner runs **Release the API**
in GitHub Actions. That promotes tested `release` to `api-release`; the host
builds, restarts and verifies the API before publishing the site. Never push
either pointer by hand.

`update-api.sh` records the binary it built in `thwart-api.built`.
`release.sh` writes `thwart-api.commit` only after both health and version
match the approved commit. A failed restart is retried on the next run.
Both `release.sh` and `update.sh` check the running API. The nightly builder
defaults to `release`, and checks compatibility before building and publishing.
The release coordinator pins both builds to the commits it resolved.

These changes take effect when the host has this revision of the scripts.
They have been tested locally with fake tools; that is not a production rollout.

## Rolling back

Releases are kept, three deep:

```bash
ls -1dt /srv/thwart/releases/*/
ln -sfn /srv/thwart/releases/<stamp> /srv/thwart/current.new
mv -Tf /srv/thwart/current.new /srv/thwart/current
```

No nginx reload is needed. The swap is a rename on the same filesystem.
The release timer can republish its approved pointer within five minutes, so
coordinate a rollback with the owner and suspend the timer if required.
Never move `release` or `api-release` by hand.

The API rolls back through git rather than through kept releases: check out the
revision `/api/v1/version` reported before the bad deploy, rebuild, restart. A
schema migration does not roll back, by design (doc 02); restore the SQLite
backup taken beforehand instead.

## Firewall, SSH and fail2ban

**SSH is on port 57022, not 22.** Port 22 is closed at both sshd and the
firewall. That is not security by itself, but it takes the machine out of the
path of the untargeted scanning that produced 1333 failed logins in a day from
18 addresses.

The rules live in [`deploy/firewall.sh`](../deploy/firewall.sh), installed at
`/usr/local/sbin/thwart-firewall`. It is one script rather than a list of
commands to type because the order is the whole safety of it: every ACCEPT is
in place before the policy becomes DROP, so the SSH connection running it
survives its own execution.

```bash
cp deploy/firewall.sh /usr/local/sbin/thwart-firewall
chmod 700 /usr/local/sbin/thwart-firewall
/usr/local/sbin/thwart-firewall
```

Open inbound: 57022, 80, 443, ping at 5/second, and ICMPv6 in full because
neighbour discovery is how IPv6 works at all. Everything else is dropped, on
both families. Outbound is unrestricted.

Rules do not survive a reboot on their own, so `iptables-persistent` saves
them. Save the **base** set only, with fail2ban stopped, or the boot restores
stale bans that fail2ban does not know it owns:

```bash
systemctl stop fail2ban
/usr/local/sbin/thwart-firewall
iptables-save > /etc/iptables/rules.v4
ip6tables-save > /etc/iptables/rules.v6
systemctl start fail2ban
```

### fail2ban

Config in [`deploy/fail2ban-jail.local`](../deploy/fail2ban-jail.local), copied
to `/etc/fail2ban/jail.local`. Five failures in ten minutes earns an hour, and
repeat offenders earn longer, up to a week.

**Check that a ban actually happens, because it silently did not.** Debian
ships fail2ban 1.1 with `banaction = nftables` and does not ship the `nft`
command. Every ban failed with `nft: not found` and exit 127 while
`fail2ban-client status` reported the addresses as banned. The counter went up
and nothing was blocked. The jail therefore sets `banaction =
iptables-multiport`, matching the rest of the machine.

The test that would have caught it:

```bash
fail2ban-client set sshd banip 203.0.113.99
iptables -S | grep 203.0.113.99      # must print a REJECT rule
fail2ban-client set sshd unbanip 203.0.113.99
```

### Changing the SSH port again

Arm a rollback before touching sshd, and never remove the old port until the
new one is proven from a **fresh** connection; an existing session keeps
working through a configuration that would refuse to accept it.

```bash
systemd-run --unit=rescue --on-active=10min /usr/local/sbin/thwart-rescue
```

where `thwart-rescue` flushes the firewall to ACCEPT and restores the backed-up
`sshd_config`. Cancel it with `systemctl stop rescue.timer` once a new
connection has succeeded.

**Password authentication status is unknown and requires confirmation.**
Do not change SSH settings without the owner's explicit approval and a tested
recovery path.

## What this costs

The built site is about 18 MB, nearly all of it card data, times three kept
releases. nginx idles at a few tens of megabytes. The nightly build is the only
real work the machine does, and it is a few minutes of Node once a day. The
current host also runs the sync API. Its memory usage under concurrent logins
has not been load-tested.

## What is not here yet

- **Physical iOS verification remains.** Local browser offline navigation and
  the worker's routing are tested. Installation, keyboard handling and safe
  areas still need a real iPhone/iPad check.
- **No monitoring.** `journalctl -u thwart-update.service` after a failed
  overnight run is the whole of it. A failed build is silent, and the site
  keeps serving the previous release, which is the safe failure but not an
  obvious one.
- **Off-site backup configuration is unknown and requires confirmation.**
  Automatic local backups already run daily at 03:14 via `thwart-backup.timer`;
  `deploy/backup.sh` verifies snapshots, compresses them and keeps 30 days.
- **The account API has never run under load.** It is tested, and it has been
  exercised end to end on a laptop, but nothing has yet measured what a small
  VPS does when several people log in at once and each login wants 64 MiB.
