#!/bin/sh
# Renders nginx.conf.template from the environment and starts nginx.
#
#   API_SERVERS / AI_SERVERS / REALTIME_SERVERS / STATUS_SERVERS / WEB_SERVERS
#   FILES_SERVERS
#                      "host:port ..."
#       Instances of each service; hostnames are re-resolved (DNS load
#       balancing), IP addresses are used as-is. Defaults: Docker service names.
#   RESOLVER           DNS server for re-resolution (default Docker's 127.0.0.11)
#   TRUSTED_PROXIES    CIDRs of load balancers in front, for real client IPs
#   RATE_LIMIT_EXEMPT  CIDRs never rate limited (local load tests only)
#   RENDER_ONLY=1      write /tmp/nginx.conf and exit (used to validate)
set -eu
API_SERVERS="${API_SERVERS:-api:8000}"
AI_SERVERS="${AI_SERVERS:-ai:8000}"
REALTIME_SERVERS="${REALTIME_SERVERS:-realtime:8000}"
STATUS_SERVERS="${STATUS_SERVERS:-status:8000}"
WEB_SERVERS="${WEB_SERVERS:-desktop:8080}"
FILES_SERVERS="${FILES_SERVERS:-files:8000}"
RESOLVER="${RESOLVER:-127.0.0.11}"
TRUSTED_PROXIES="${TRUSTED_PROXIES:-}"
RATE_LIMIT_EXEMPT="${RATE_LIMIT_EXEMPT:-}"

servers() {
  for server in $1; do
    host="${server%:*}"
    case "$host" in
      *[!0-9.]*) printf '    server %s resolve max_fails=3 fail_timeout=10s;\n' "$server" ;;
      *) printf '    server %s max_fails=3 fail_timeout=10s;\n' "$server" ;;
    esac
  done
}

real_ip() {
  # The web entry point forwards /api to the API entry point over loopback,
  # so the gateway always trusts itself to pass the visitor's address on.
  printf '  set_real_ip_from 127.0.0.1;\n'
  for cidr in $TRUSTED_PROXIES; do printf '  set_real_ip_from %s;\n' "$cidr"; done
  printf '  real_ip_header X-Forwarded-For;\n  real_ip_recursive on;\n'
}

exempt() {
  for cidr in $RATE_LIMIT_EXEMPT; do printf '    %s "";\n' "$cidr"; done
}

export UPSTREAM_API="$(servers "$API_SERVERS")"
export UPSTREAM_AI="$(servers "$AI_SERVERS")"
export UPSTREAM_REALTIME="$(servers "$REALTIME_SERVERS")"
export UPSTREAM_STATUS="$(servers "$STATUS_SERVERS")"
export UPSTREAM_WEB="$(servers "$WEB_SERVERS")"
export UPSTREAM_FILES="$(servers "$FILES_SERVERS")"
export RESOLVER REAL_IP="$(real_ip)" LIMIT_EXEMPT="$(exempt)"

# tr drops Windows line endings a checkout may have added to the template.
tr -d '\r' < /etc/orbyn-gateway/nginx.conf.template |
  envsubst '${UPSTREAM_API} ${UPSTREAM_AI} ${UPSTREAM_REALTIME} ${UPSTREAM_STATUS} ${UPSTREAM_WEB} ${UPSTREAM_FILES} ${RESOLVER} ${REAL_IP} ${LIMIT_EXEMPT}' \
  > /tmp/nginx.conf

[ "${RENDER_ONLY:-}" = "1" ] && exit 0
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
