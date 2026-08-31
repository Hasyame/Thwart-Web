# Deploying thwart.app

The site is static files. There is no application server, no database and no
container: nginx serves a directory, and a timer rebuilds that directory
overnight. Doc 05's container layout describes the **sync server**, which does
not exist yet and is not what this deploys.

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

```bash
cp /srv/thwart/repo/deploy/nginx-thwart.app.conf /etc/nginx/sites-available/thwart.app
ln -s /etc/nginx/sites-available/thwart.app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
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

## 8. The account API

Optional. The site works without it: everything is local to the browser until
somebody chooses to make an account. Skip this section entirely if you are not
running accounts yet.

Go is needed on the server, and only for building.

```bash
curl -fsSL https://go.dev/dl/go1.27.0.linux-amd64.tar.gz -o /tmp/go.tgz
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

The service listens on `127.0.0.1:8787` and nothing outside the box can reach
it. nginx is the only way in, through the `location /api/` block already in
`deploy/nginx-thwart.app.conf`, so re-copy that file and reload if you set the
site up before this section existed.

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
sudo -u thwart sqlite3 /srv/thwart/data/thwart.sqlite     ".backup '/srv/thwart/data/backup-$(date -u +%Y%m%d).sqlite'"
```

`.backup` rather than `cp`, because the database runs in WAL mode and copying
the file while a write is in flight gives you a database that is missing the
end of it. Doc 05 has the retention argument; the short version is that a
nightly copy kept for a fortnight is enough for a service where the client
holds a full replica anyway.

### Raising the Argon2 cost

`auth.go` hashes at 64 MiB per attempt, and `thwart-api.service` caps the
service at 512 MB with a soft limit at 384 MB. If logins start being refused
under load, the memory cap is the first number to look at, not the Argon2
parameters. Every hash records the parameters it was made with, so raising them
later does not invalidate a single existing account.

## Deploying a change

Push to `main`, then either wait for the timer or run it now:

```bash
systemctl start thwart-update.service
```

The service pulls, builds and swaps the symlink. nginx needs no reload: it
resolves the symlink per request.

That covers the site only. A change to the account API is a separate step,
because it restarts a process holding a database rather than swapping a
directory of files:

```bash
sudo -H -u thwart /srv/thwart/repo/deploy/update-api.sh
sudo systemctl restart thwart-api
curl -s https://thwart.app/api/v1/version
```

The script runs the tests before it builds, and builds to a temporary name, so
a failure leaves the running binary alone.

## Rolling back

Releases are kept, three deep:

```bash
ls -1dt /srv/thwart/releases/*/
ln -sfn /srv/thwart/releases/<stamp> /srv/thwart/current.new
mv -Tf /srv/thwart/current.new /srv/thwart/current
```

No reload, no downtime. The swap is a rename on the same filesystem.

The API rolls back through git rather than through kept releases: check out the
revision `/api/v1/version` reported before the bad deploy, rebuild, restart. A
schema migration does not roll back, by design (doc 02); restore the SQLite
backup taken beforehand instead.

## Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

## What this costs

The built site is about 18 MB, nearly all of it card data, times three kept
releases. nginx idles at a few tens of megabytes. The nightly build is the only
real work the machine does, and it is a few minutes of Node once a day. The
smallest VPS either provider sells is more than enough, and will stay so when
the sync server arrives beside it.

## What is not here yet

- **No service worker verification.** The worker is served and its routing is
  tested in Node, but it has never been registered in a real browser: the
  automated one used during development refuses to. Load the site on a phone,
  add it to the home screen, then turn off the network and check it still
  opens.
- **No monitoring.** `journalctl -u thwart-update.service` after a failed
  overnight run is the whole of it. A failed build is silent, and the site
  keeps serving the previous release, which is the safe failure but not an
  obvious one.
- **No automatic backups.** Without the account API there is nothing to back
  up: every byte on the server is rebuildable from the repository and
  MarvelCDB. With it there is exactly one file that is not, and taking a copy
  of it is still a command somebody has to remember to run. Section 8 has the
  command; putting it on a timer is not done.
- **The account API has never run under load.** It is tested, and it has been
  exercised end to end on a laptop, but nothing has yet measured what a small
  VPS does when several people log in at once and each login wants 64 MiB.
