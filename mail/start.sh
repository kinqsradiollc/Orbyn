#!/bin/sh
# Fail before accepting mail if the production identity or relay is incomplete.
set -eu
fail() { echo "mail: $*" >&2; exit 1; }
case "${MAIL_HOSTNAME:-}" in
  ""|localhost|*.localhost) fail "Set MAIL_HOSTNAME to your public mail hostname" ;;
esac
case "${MAIL_DOMAIN:-}" in
  ""|localhost|*.localhost) fail "Set MAIL_DOMAIN to your sending domain" ;;
esac
case "${MAIL_CONFIG:-maddy.conf}" in
  maddy.conf) ;;
  maddy-relay.conf)
    case "${MAIL_RELAY:-}" in
      tcp://*:*|tls://*:*) ;;
      *) fail "Set MAIL_RELAY to tcp://host:587 or tls://host:465" ;;
    esac
    [ -n "${MAIL_RELAY_USER:-}" ] || fail "Set MAIL_RELAY_USER"
    [ -n "${MAIL_RELAY_PASSWORD:-}" ] || fail "Set MAIL_RELAY_PASSWORD"
    ;;
  *) fail "MAIL_CONFIG must be maddy.conf or maddy-relay.conf" ;;
esac
# Without Windows line endings, whatever the checkout did to them.
tr -d '\r' < "/data/conf/${MAIL_CONFIG:-maddy.conf}" > /tmp/maddy.conf
exec /bin/maddy --config /tmp/maddy.conf run
