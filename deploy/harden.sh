#!/bin/sh
set -eu

# Hardening the machine, as one idempotent script.
#
# Everything here was found by auditing the running server rather than by
# working down a checklist, and each block says what was actually wrong.
#
#   sudo sh /srv/thwart/repo/deploy/harden.sh
#
# Safe to run again. It refuses to lock the door before checking it can still
# get in: the SSH block verifies a key is present before it turns password
# authentication off, and the firewall opens the SSH port before the policy
# becomes DROP.

SSH_PORT="${SSH_PORT:-57022}"

say() { printf '\n==> %s\n' "$*"; }

# ---------------------------------------------------------------------------
say "SSH"
#
# What the audit found, and why it was the most serious thing on the box:
#
#   root    L   password locked, 1 key
#   debian  P   password SET, 0 keys, sudo NOPASSWD:ALL
#   sshd    PasswordAuthentication yes
#   firewall none
#
# That is a remote root path gated by one guessable password, with fail2ban the
# only thing in the way. Turning password authentication off closes it outright:
# `debian` has no key, so it can no longer log in at all, and root already could
# not use a password.

keys=$(wc -l < /root/.ssh/authorized_keys 2>/dev/null || echo 0)
if [ "$keys" -lt 1 ]; then
    echo "    REFUSING: /root/.ssh/authorized_keys is empty."
    echo "    Turning off password authentication now would lock everybody out."
    exit 1
fi
echo "    root has $keys authorised key(s), so key login survives this"

# A drop-in rather than an edit of sshd_config, because `Include
# /etc/ssh/sshd_config.d/*.conf` sits at the top of that file and, in sshd
# config, the first occurrence of a keyword wins. So this overrides whatever is
# below it and survives a package upgrade rewriting the main file. Checked on
# this machine before relying on it.
cat > /etc/ssh/sshd_config.d/10-thwart.conf <<CONF
# Written by deploy/harden.sh. Edit there, not here.

# The account API is reachable from the internet; this port should be reachable
# only by somebody holding a key. A password is a thing that can be guessed at
# leisure, and the guessing costs the attacker nothing.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no

# Key-only for root. Already the default here, said out loud so a package
# upgrade that rewrites the main file cannot quietly change it.
PermitRootLogin prohibit-password

# There is no display on this machine and no agent worth forwarding to it.
X11Forwarding no
AllowAgentForwarding no

# Fewer tries per connection, so each attempt costs an attacker a full handshake.
MaxAuthTries 3
MaxSessions 4

# A connection that has not authenticated is a connection holding a slot.
LoginGraceTime 20
CONF

sshd -t
systemctl reload ssh
echo "    password authentication off, config valid, ssh reloaded"

# ---------------------------------------------------------------------------
say "the debian account"
#
# Left in place rather than deleted: it is cloud-init's, and removing it is the
# kind of tidying that breaks a rebuild months later. Its password is locked
# instead, so that even a future change to sshd cannot turn it back into a way
# in. It has no key, so it was never a way in for its owner either.
if id debian >/dev/null 2>&1; then
    passwd -l debian >/dev/null 2>&1 || true
    echo "    password locked; the account and its sudo rule are untouched"
fi

# ---------------------------------------------------------------------------
say "LLMNR"
#
# systemd-resolved was listening on 0.0.0.0:5355 and [::]:5355. Nothing on this
# machine resolves names by multicast, and an open LLMNR responder is a
# spoofing and amplification surface for no benefit at all.
mkdir -p /etc/systemd/resolved.conf.d
cat > /etc/systemd/resolved.conf.d/10-thwart.conf <<'CONF'
# Written by deploy/harden.sh.
[Resolve]
LLMNR=no
MulticastDNS=no
CONF
systemctl restart systemd-resolved
echo "    LLMNR and mDNS off"

# ---------------------------------------------------------------------------
say "firewall"
#
# There was none. `nft list ruleset` was empty and deploy/firewall.sh wrote
# iptables rules that nothing persisted, so whatever it once did was gone by the
# next reboot. This writes an nftables ruleset to /etc/nftables.conf and enables
# the service that loads it at boot, which is the part that was missing.
#
# The order inside the table is the safety of it: every accept is in place
# before the policy drops, and the ruleset is loaded atomically, so the
# connection running this script survives its own execution.
if ! command -v nft >/dev/null 2>&1; then
    echo "    nftables is not installed; installing"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nftables >/dev/null
fi

cat > /etc/nftables.conf <<CONF
#!/usr/sbin/nft -f
# Written by deploy/harden.sh. Edit there, not here.

flush ruleset

table inet filter {
    chain input {
        type filter hook input priority filter; policy drop;

        # Anything this machine started, and its replies.
        ct state established,related accept
        ct state invalid drop
        iif lo accept

        # Enough ICMP to stay a good citizen: path MTU discovery breaks without
        # it, and IPv6 stops working entirely without neighbour discovery.
        ip protocol icmp icmp type { echo-request, echo-reply, destination-unreachable, time-exceeded, parameter-problem } accept
        ip6 nexthdr icmpv6 accept

        tcp dport $SSH_PORT accept
        tcp dport { 80, 443 } accept
    }

    chain forward {
        type filter hook forward priority filter; policy drop;
    }

    chain output {
        # Left open. This machine has to reach Let's Encrypt, MarvelCDB, the
        # Go module proxy and every mail server on the internet, and an egress
        # policy that has to be revised for each of those is one that gets
        # switched off the first time it is inconvenient.
        type filter hook output priority filter; policy accept;
    }
}
CONF

nft -c -f /etc/nftables.conf
nft -f /etc/nftables.conf
systemctl enable nftables >/dev/null 2>&1 || true
echo "    ruleset loaded and enabled at boot"
nft list chain inet filter input | grep -E "dport|policy" | sed 's/^/    /'

# ---------------------------------------------------------------------------
say "fail2ban"
#
# Only the sshd jail existed. With password authentication now off, sshd matters
# less; what is exposed instead is the account API, and nginx is the only thing
# that sees the addresses hitting it.
cat > /etc/fail2ban/filter.d/thwart-auth.conf <<'CONF'
# Written by deploy/harden.sh.
#
# Matches nginx refusing an authentication request: 429 from the rate limiter,
# 401 and 403 from the API itself. One of these is somebody mistyping a
# password. Twenty in ten minutes is not.
[Definition]
failregex = ^<HOST> .* "(GET|POST|DELETE) /api/v1/auth/[^"]*" (401|403|429)
ignoreregex =
CONF

cat > /etc/fail2ban/jail.d/thwart.local <<'CONF'
# Written by deploy/harden.sh.
[thwart-auth]
enabled  = true
port     = http,https
filter   = thwart-auth
logpath  = /var/log/nginx/access.log
findtime = 600
maxretry = 20
bantime  = 3600
CONF

fail2ban-client reload >/dev/null 2>&1 || systemctl restart fail2ban
sleep 2
fail2ban-client status 2>/dev/null | sed 's/^/    /'

# ---------------------------------------------------------------------------
say "nginx"
#
# Two files, and the second one fixes a hole this audit found rather than made.
#
# The security headers were declared at server level and reached nothing. nginx
# *replaces* the inherited set the moment a location declares an add_header of
# its own, and every static location here sets a Cache-Control — so /assets/,
# /data/, /sw.js, /index.html and the manifest were all served with no HSTS, no
# nosniff and no referrer policy. `/` was among them, because `try_files` sends
# it to `location = /index.html`. Measured with curl, not guessed.
#
# The site config itself is left alone: certbot has written the listen 443
# lines, the certificate paths and the redirect into it, and copying the repo
# version over that would take TLS off the site. What this installs is the two
# files it includes.
REPO="${REPO:-/srv/thwart/repo}"
if [ -d /etc/nginx ]; then
    mkdir -p /etc/nginx/snippets /etc/nginx/conf.d
    cp "$REPO/deploy/nginx-thwart-security.conf" /etc/nginx/snippets/thwart-security.conf
    cp "$REPO/deploy/nginx-thwart-limits.conf" /etc/nginx/conf.d/thwart-limits.conf
    nginx -t
    systemctl reload nginx
    echo "    snippet and rate-limit zones installed, nginx reloaded"
    echo "    NOTE: the site config must include snippets/thwart-security.conf in"
    echo "          every location that sets an add_header. See the repo copy."
fi

# ---------------------------------------------------------------------------
say "log rotation"
#
# The image ships without logrotate and without cron, so every config in
# /etc/logrotate.d — nginx's, fail2ban's, apt's — sat there doing nothing and
# no log on the machine had ever been rotated. nginx's access log had reached
# 12MB of one unbroken file.
#
# That is a privacy problem before it is a disk problem. The access log records
# a full IP address for every request, and an IP is personal data: keeping ten
# days of them because nothing was deleting them is not a decision anybody made.
# The package's own nginx config is already `daily` with `rotate 14`, which is
# the retention we want, so installing logrotate is the whole fix.
#
# The timer rather than cron.daily, because cron is not running here either.
if ! command -v logrotate >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends logrotate >/dev/null
    echo "    installed"
else
    echo "    already installed"
fi
systemctl enable --now logrotate.timer >/dev/null 2>&1 || true
if systemctl is-active logrotate.timer >/dev/null 2>&1; then
    echo "    logrotate.timer active, nginx logs kept 14 days"
else
    echo "    WARNING: logrotate.timer is not active; logs will not rotate"
fi

say "done"
echo "Check before you close this session:"
echo "  ssh -p $SSH_PORT root@<host> true"
echo "If that fails, you still have this session open. To undo the SSH change:"
echo "  rm /etc/ssh/sshd_config.d/10-thwart.conf && systemctl reload ssh"
