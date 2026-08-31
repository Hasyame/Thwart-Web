#!/bin/sh
#
# The firewall, as one idempotent script.
#
# Written as a script rather than typed rule by rule because the order is the
# whole safety of it: every ACCEPT is in place before the policy becomes DROP,
# so the connection running this survives its own execution.
set -e

SSH_PORT="${SSH_PORT:-57022}"
LEGACY_SSH="${LEGACY_SSH:-}"

for ipt in iptables ip6tables; do
    $ipt -F
    $ipt -X 2>/dev/null || true

    # Anything this machine started, and its replies.
    $ipt -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    $ipt -A INPUT -i lo -j ACCEPT
    $ipt -A INPUT -m conntrack --ctstate INVALID -j DROP

    $ipt -A INPUT -p tcp --dport "$SSH_PORT" -j ACCEPT
    [ -n "$LEGACY_SSH" ] && $ipt -A INPUT -p tcp --dport "$LEGACY_SSH" -j ACCEPT
    $ipt -A INPUT -p tcp --dport 80 -j ACCEPT
    $ipt -A INPUT -p tcp --dport 443 -j ACCEPT
done

# Ping, at a sane rate. Dropping it entirely breaks path MTU discovery and
# makes the machine harder to diagnose for no security gain.
iptables -A INPUT -p icmp --icmp-type echo-request -m limit --limit 5/second -j ACCEPT
iptables -A INPUT -p icmp -j DROP

# ICMPv6 is not optional: neighbour discovery is how IPv6 works at all, and
# dropping it breaks the link rather than protecting it.
ip6tables -A INPUT -p ipv6-icmp -j ACCEPT

# DHCP replies, in case the provider hands the address out that way.
iptables -A INPUT -p udp --sport 67 --dport 68 -j ACCEPT
ip6tables -A INPUT -p udp --dport 546 -j ACCEPT

for ipt in iptables ip6tables; do
    $ipt -P INPUT DROP
    $ipt -P FORWARD DROP
    $ipt -P OUTPUT ACCEPT
done

# Flushing above wiped fail2ban chains along with everything else. Without
# this, re-running the script silently unbans everybody and fail2ban carries on
# believing its rules are in place.
if systemctl is-active --quiet fail2ban; then
    systemctl restart fail2ban
fi
