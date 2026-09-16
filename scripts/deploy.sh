#!/usr/bin/env bash
# Zero-downtime deploy for Orbyn on one Docker host.
#
#   ./scripts/deploy.sh             pull the latest code, build, migrate, roll out
#   ./scripts/deploy.sh --no-pull   deploy what is checked out (and .env changes)
#
# Plain `docker compose up -d` replaces every changed container at once, so a
# service is down while its replacement starts. This script instead starts new
# copies of each service beside the old ones, waits until they pass their
# health checks and the gateway has picked them up, then retires the old
# copies. If a new copy fails, the old ones keep serving and the deploy stops.
#
# Copies per service come from .env: API_REPLICAS (default 2), AI_REPLICAS (2),
# WEB_REPLICAS (2), STATUS_REPLICAS (1), NOTIFIER_REPLICAS (1). Settings that live in the app
# (Admin -> System) need no deploy at all.
set -euo pipefail
cd "$(dirname "$0")/.."

PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
compose() { docker compose "$@"; }
# A value from .env without sourcing it (passwords may contain $ or quotes).
setting() { local v; v=$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true); echo "${v:-$2}"; }

[ -f .env ] || { echo "No .env next to compose.yaml; copy .env.example first." >&2; exit 1; }

if [ "$PULL" = 1 ]; then
  log "Pulling the latest code"
  git pull --ff-only
fi

GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export GIT_SHA BUILD_TIME

log "Building images for $GIT_SHA"
compose build

# Only started if missing: recreating them would drop every connection the
# running services hold. Apply database or pooler changes deliberately with
# `docker compose up -d postgres pgbouncer` in a quiet moment.
log "Making sure the database and connection pooler are running"
compose up -d --wait --no-recreate postgres pgbouncer

# Bring up the selected mail backend before restarting its clients.
# Explicitly selecting mail activates its optional profile.
smtp_host=${DOCKER_SMTP_HOST:-$(setting DOCKER_SMTP_HOST mailpit)}
case "$smtp_host" in
  mail)
    log "Starting the outbound mail server"
    compose up -d --wait --wait-timeout 90 mail
    ;;
  mailpit)
    log "Starting the development mail catcher"
    compose up -d --wait mailpit
    ;;
esac

log "Applying database migrations"
compose run --rm migrate

# Ready = healthy, or running for 5 s when the service has no health check.
wait_ready() {
  local deadline=$((SECONDS + ${READY_TIMEOUT:-180})) id state
  for id in "$@"; do
    while :; do
      state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo gone)
      case "$state" in
        healthy) break ;;
        running)
          if ! docker inspect -f '{{json .State.Health}}' "$id" | grep -q Status; then
            sleep 5
            [ "$(docker inspect -f '{{.State.Status}}' "$id")" = running ] && break
          fi ;;
        exited | dead | gone | unhealthy) return 1 ;;
      esac
      [ "$SECONDS" -ge "$deadline" ] && return 1
      sleep 2
    done
  done
}

# Start `want` new copies of a service beside the old ones, then retire the old.
rollout() {
  local svc=$1 want=$2 old have new id
  old=$(compose ps -q "$svc" | sort)
  have=$(printf '%s\n' "$old" | grep -c . || true)
  if [ "$have" -eq 0 ]; then
    log "Starting $svc ($want)"
    compose up -d --no-deps --scale "$svc=$want" "$svc"
    # shellcheck disable=SC2046
    wait_ready $(compose ps -q "$svc") || { echo "$svc did not become healthy" >&2; exit 1; }
    return
  fi
  log "Rolling out $svc: $want new beside $have running"
  compose up -d --no-deps --no-recreate --scale "$svc=$((have + want))" "$svc"
  new=$(comm -13 <(printf '%s\n' "$old") <(compose ps -q "$svc" | sort))
  # shellcheck disable=SC2086
  if ! wait_ready $new; then
    echo "New $svc copies failed their health check; the old ones keep serving." >&2
    compose logs --tail 40 "$svc" >&2 || true
    # shellcheck disable=SC2086
    docker rm -f $new >/dev/null
    exit 1
  fi
  # The gateway re-resolves service names every 10 s; let it see the new copies
  # before the old ones go, then stop them gracefully (in-flight requests finish).
  sleep "${DRAIN_SECONDS:-12}"
  for id in $old; do
    docker stop -t 30 "$id" >/dev/null
    docker rm "$id" >/dev/null
  done
  compose up -d --no-deps --no-recreate --scale "$svc=$want" "$svc" >/dev/null
  # Wait out the gateway's DNS cache before the next service starts, so a
  # new container can't reuse a just-freed address that the gateway still
  # maps to this service.
  sleep "${DRAIN_SECONDS:-12}"
}

rollout api "$(setting API_REPLICAS 2)"
rollout ai "$(setting AI_REPLICAS 2)"
rollout status "$(setting STATUS_REPLICAS 1)"
rollout notifier "$(setting NOTIFIER_REPLICAS 1)"
rollout desktop "$(setting WEB_REPLICAS 2)"

# The gateway and web app publish fixed ports, so they are replaced in place,
# and only when they changed (nginx starts in about a second).
# Why the gateway's running container differs from compose.yaml, or nothing
# when it matches. Its image tag is pinned in compose.yaml, so the
# configuration fingerprint covers image changes too.
gateway_change() {
  local id want_hash have_hash
  id=$(compose ps -q gateway | head -1)
  [ -z "$id" ] && { echo "not running"; return; }
  want_hash=$(compose config --hash gateway | awk '{print $2}')
  have_hash=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$id")
  [ "$want_hash" != "$have_hash" ] && echo "configuration changed"
}

# The gateway holds the host ports, so it is replaced in place, and only when
# its configuration changed (nginx starts in about a second).
log "Checking the gateway"
reason=$(gateway_change)
if [ -n "$reason" ]; then
  compose up -d --no-deps gateway
  echo "Gateway replaced: $reason (about a second of reconnects)."
else
  echo "Gateway unchanged."
fi

log "Deployed $GIT_SHA"
compose ps
