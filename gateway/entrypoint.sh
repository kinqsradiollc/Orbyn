#!/bin/sh
# Renders nginx.conf.template from the environment and starts nginx.
#
#   API_SERVERS / AI_SERVERS / STATUS_SERVERS  "host:port host:port ..."
#       Instances of each service; hostnames are re-resolved (DNS load
#       balancing), IP addresses are used as-is. Defaults: Docker service names.
#   RESOLVER           DNS server for re-resolution (default Docker's 127.0.0.11)
#   TRUSTED_PROXIES    CIDRs of load balancers in front, for real client IPs
#   RATE_LIMIT_EXEMPT  CIDRs never rate limited (local load tests only)
#   RENDER_ONLY=1      write /tmp/nginx.conf and exit (used to validate)
set -eu
API_SERVERS="${API_SERVERS:-api:8000}"
AI_SERVERS="${AI_SERVERS:-ai:8000}"
STATUS_SERVERS="${STATUS_SERVERS:-status:8000}"
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
  if [ -n "$TRUSTED_PROXIES" ]; then
    for cidr in $TRUSTED_PROXIES; do printf '  set_real_ip_from %s;\n' "$cidr"; done
    printf '  real_ip_header X-Forwarded-For;\n  real_ip_recursive on;\n'
  fi
}

exempt() {
  for cidr in $RATE_LIMIT_EXEMPT; do printf '    %s "";\n' "$cidr"; done
}

export UPSTREAM_API="$(servers "$API_SERVERS")"
export UPSTREAM_AI="$(servers "$AI_SERVERS")"
export UPSTREAM_STATUS="$(servers "$STATUS_SERVERS")"
export RESOLVER REAL_IP="$(real_ip)" LIMIT_EXEMPT="$(exempt)"

envsubst '${UPSTREAM_API} ${UPSTREAM_AI} ${UPSTREAM_STATUS} ${RESOLVER} ${REAL_IP} ${LIMIT_EXEMPT}' \
  < /etc/orbyn-gateway/nginx.conf.template > /tmp/nginx.conf

[ "${RENDER_ONLY:-}" = "1" ] && exit 0
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
