#!/bin/sh
set -eu

# Sending mail from the Thwart server, and only sending.
#
# Postfix listens on the loopback and nowhere else, so nothing on the internet
# can hand it a message: the only things that can post mail are processes on
# this machine. That is the whole security posture, and it is why there is no
# spam filtering here to get wrong. Nothing on this box receives mail.
#
# Delivery is direct rather than through a relay, because OVH leaves port 25
# open outbound on this VPS (checked, not assumed). Direct delivery is only
# accepted by the big mailbox providers if all four of these agree, so all four
# are set up here or named in the DNS notes at the end:
#
#   SPF    one record, naming this IP
#   DKIM   this script generates the key; the public half goes in DNS
#   DMARC  at _dmarc.thwart.app, which is the only place it is read
#   PTR    reverse DNS for the IP, set in the OVH panel, matching the HELO name
#
# IPv4 only, deliberately. The VPS has a routed IPv6 address, and Gmail rejects
# IPv6 mail outright unless the sending address has its own AAAA and matching
# reverse DNS. Sending over v4 sidesteps a whole class of silent rejection.
#
# Idempotent: safe to run again. The DKIM key is generated once and kept.

DOMAIN=thwart.app
HOST=mail.$DOMAIN
SELECTOR=mail
KEYDIR=/etc/dkimkeys

echo "==> installing"
export DEBIAN_FRONTEND=noninteractive
echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
echo "postfix postfix/mailname string $HOST" | debconf-set-selections
apt-get update -qq
apt-get install -y -qq postfix opendkim opendkim-tools >/dev/null

echo "$HOST" > /etc/mailname

echo "==> postfix"
postconf -e "myhostname = $HOST"
postconf -e "mydomain = $DOMAIN"
postconf -e "myorigin = \$mydomain"
postconf -e "smtp_helo_name = $HOST"

# The line that makes this a send-only machine: no listener on the public
# interface at all. It is the whole of the protection, which is worth being
# clear about, because the next line reads like it weakens it and does not.
postconf -e "inet_interfaces = loopback-only"

# The domain is in mydestination so that mail to a bare local name stays local.
#
# Postfix appends $myorigin -- $mydomain -- to any address without one, so a
# bounce or a cron report addressed to `root` becomes root@thwart.app. Leave the
# domain out of mydestination and Postfix concludes it is not the final
# destination, looks the domain up, finds the MX pointing back at this host, and
# tries to connect to a port it is deliberately not listening on. The mail is
# not lost; it queues, and retries for five days, and the queue grows for as
# long as the machine runs.
#
# This costs nothing in exposure. mydestination decides what *locally submitted*
# mail counts as local; nothing outside can reach the SMTP port to take
# advantage of it.
postconf -e "mydestination = \$myhostname, localhost, localhost.localdomain, \$mydomain"
postconf -e "mynetworks = 127.0.0.0/8 [::1]/128"
postconf -e "smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination"

postconf -e "inet_protocols = ipv4"
postconf -e "relayhost ="
postconf -e "smtp_tls_security_level = may"
postconf -e "smtp_tls_loglevel = 1"
postconf -e "append_dot_mydomain = no"
postconf -e "biff = no"
postconf -e "disable_vrfy_command = yes"

# Signing, through OpenDKIM.
#
# Over TCP on the loopback rather than a unix socket: Postfix runs chrooted in
# /var/spool/postfix on Debian, and a socket inside that chroot is a permissions
# problem waiting to happen on every upgrade.
#
# `milter_default_action = accept` is deliberate. If OpenDKIM is down, mail goes
# out unsigned rather than not at all: an unsigned password reset is a nuisance,
# a queue nobody notices is a support ticket a week later.
postconf -e "milter_default_action = accept"
postconf -e "milter_protocol = 6"
postconf -e "smtpd_milters = inet:localhost:8891"
postconf -e "non_smtpd_milters = inet:localhost:8891"

echo "==> opendkim"
mkdir -p "$KEYDIR"
if [ ! -f "$KEYDIR/$SELECTOR.private" ]; then
  opendkim-genkey -b 2048 -d "$DOMAIN" -s "$SELECTOR" -D "$KEYDIR"
  echo "    generated a new $SELECTOR key"
else
  echo "    keeping the existing $SELECTOR key"
fi
chown -R opendkim:opendkim "$KEYDIR"
chmod 700 "$KEYDIR"
chmod 600 "$KEYDIR/$SELECTOR.private"

printf '%s\n' \
  "$SELECTOR._domainkey.$DOMAIN $DOMAIN:$SELECTOR:$KEYDIR/$SELECTOR.private" \
  > "$KEYDIR/keytable"
printf '%s\n' "*@$DOMAIN $SELECTOR._domainkey.$DOMAIN" > "$KEYDIR/signingtable"
printf '%s\n' 127.0.0.1 ::1 localhost "$DOMAIN" "$HOST" > "$KEYDIR/trustedhosts"
chown opendkim:opendkim "$KEYDIR/keytable" "$KEYDIR/signingtable" "$KEYDIR/trustedhosts"

cat > /etc/opendkim.conf <<CONF
# Written by deploy/mail.sh. Edit there, not here.
Syslog                  yes
SyslogSuccess           yes
UMask                   007
UserID                  opendkim
PidFile                 /run/opendkim/opendkim.pid

Socket                  inet:8891@localhost

Canonicalization        relaxed/simple
Mode                    sv
SubDomains              no

# From is signed twice, so a message cannot have a second From bolted on after
# signing without the signature breaking. This is the header-injection defence.
OversignHeaders         From

# What the signature covers.
#
# The built-in default signed only From, To, Subject and Date, which leaves the
# content type and the message id outside the signature: a relay could change
# either and the signature would still verify. Naming them here closes that.
# Read off a real delivered message rather than assumed, because the h= list in
# the header is the only place the answer actually shows up.
SignHeaders             From,Reply-To,Subject,Date,To,Cc,Message-ID,MIME-Version,Content-Type,Content-Transfer-Encoding,Auto-Submitted

KeyTable                file:$KEYDIR/keytable
SigningTable            refile:$KEYDIR/signingtable
InternalHosts           file:$KEYDIR/trustedhosts
CONF

systemctl enable --now opendkim >/dev/null 2>&1 || true
systemctl restart opendkim
systemctl restart postfix

echo
echo "==> state"
systemctl is-active opendkim postfix
ss -lntp | grep -E ':25 |:8891 ' || true

echo
echo "==> what has to be true in DNS"
cat <<NOTES
  ADD     mail            A     92.222.65.177
          The MX already points at mail.$DOMAIN and it does not resolve, so
          nothing addressed to the domain can be delivered anywhere.

  ADD     _dmarc          TXT   v=DMARC1; p=none; rua=mailto:dmarc@$DOMAIN
          DMARC is only ever read at _dmarc.<domain>. A copy at the apex is
          read by nothing.

  ADD     $SELECTOR._domainkey  TXT   (the value printed below)

  DELETE  @               TXT   "$SELECTOR._domainkey"
          A placeholder someone typed into the value box. It does nothing.

  DELETE  @               SPF   v=spf1 include:mx.ovh.com ...
          There are two SPF records on the apex, and RFC 7208 makes that a
          permanent error: SPF fails for every message rather than passing.
          Keep the plain TXT one naming this IP; delete OVH's SPF-type record.

  REVERSE DNS, in the OVH VPS panel, not in the zone:
          92.222.65.177 -> $HOST
          It is still the default vps-*.ovh.net. Gmail and Outlook both weigh
          this. Set it after the mail A record exists, so the name resolves
          back to the address.
NOTES

echo
echo "==> the DKIM record value"
echo "    subdomain: $SELECTOR._domainkey"
echo "    type:      TXT"
tr -d '\n' < "$KEYDIR/$SELECTOR.txt" \
  | sed -e 's/^[^(]*(//' -e 's/).*$//' -e 's/"//g' -e 's/[[:space:]]//g'
echo
