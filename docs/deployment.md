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

## Deploying a change

Push to `main`, then either wait for the timer or run it now:

```bash
systemctl start thwart-update.service
```

The service pulls, builds and swaps the symlink. nginx needs no reload: it
resolves the symlink per request.

## Rolling back

Releases are kept, three deep:

```bash
ls -1dt /srv/thwart/releases/*/
ln -sfn /srv/thwart/releases/<stamp> /srv/thwart/current.new
mv -Tf /srv/thwart/current.new /srv/thwart/current
```

No reload, no downtime. The swap is a rename on the same filesystem.

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
- **No backups.** There is nothing to back up: every byte on the server is
  rebuildable from the repository and MarvelCDB. That changes the day the sync
  server lands, and doc 05 covers it.
