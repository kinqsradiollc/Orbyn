#!/usr/bin/env bash
# Deploy or update Orbyn on one Docker host, without downtime.
#
#   ./scripts/deploy.sh              pull the latest code, back up, build, migrate, roll out
#   ./scripts/deploy.sh --no-pull    deploy what is checked out (and .env changes)
#   ./scripts/deploy.sh --no-backup  skip the database dump taken before migrations
#   ./scripts/deploy.sh --check      report what would happen and check .env; change nothing
#   ENV_FILE=.env.production ./scripts/deploy.sh --check
#                                    the same for a file you're about to copy to a server
#
# The same command does a first install: whatever isn't running is started.
#
# In order: pull the code, build images stamped with the commit, make sure the
# database and pooler run, dump the database to backups/, start the mail
# server or catcher .env selects, apply migrations, then replace each service
# by starting new copies beside the old ones, waiting for their health checks,
# and retiring the old ones. Then replace the gateway only if it changed, start
# or update the Cloudflare tunnel (when CLOUDFLARE_TUNNEL_TOKEN is set), remove
# leftover image layers, and confirm the version that is serving.
#
# Don't update with `docker compose up -d --build`: every backend service
# shares one image, so compose replaces all copies of all of them at once and
# the site is down until they start.
#
# Copies per service come from .env: API_REPLICAS (default 2), AI_REPLICAS (2),
# REALTIME_REPLICAS (2), WEB_REPLICAS (2), STATUS_REPLICAS (1),
# NOTIFIER_REPLICAS (1), FILES_REPLICAS (1), CONVERTER_REPLICAS (1). Settings
# that live in the app (Admin -> System) need no deploy at all.
set -euo pipefail
cd "$(dirname "$0")/.."

# Git Bash on Windows rewrites Unix-looking arguments into Windows paths, which
# would turn a container path like /data/... into C:/Program Files/Git/data/...
# Harmless everywhere else.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

PULL=1 BACKUP=1 CHECK=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-backup) BACKUP=0 ;;
    --check) CHECK=1 ;;
    -h | --help) awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/,""); print}' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# Compose and the containers read .env; another file may only be checked.
ENV_FILE=${ENV_FILE:-.env}
if [ "$ENV_FILE" != .env ] && [ "$CHECK" != 1 ]; then
  echo "ENV_FILE only works with --check: a deploy uses .env, which compose reads itself." >&2
  exit 2
fi

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
compose() { docker compose "$@"; }
# A value from .env without sourcing it (passwords may contain $ or quotes).
setting() { local v; v=$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true); echo "${v:-${2:-}}"; }

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE next to compose.yaml; copy .env.example (or .env.production) first." >&2; exit 1; }

# ---------------------------------------------------------------------------
# What .env asks for, and whether it hangs together.
tunnel_token=$(setting CLOUDFLARE_TUNNEL_TOKEN)
smtp_host=$(setting DOCKER_SMTP_HOST mailpit)
mail_config=$(setting MAIL_CONFIG maddy.conf)
mail_domain=$(setting MAIL_DOMAIN)
app_url=$(setting APP_URL)
cors=$(setting CORS_ORIGINS)
profiles=$(setting COMPOSE_PROFILES)
ocr_on=0
case ",$profiles," in *,ocr,*) ocr_on=1 ;; esac
formula_on=0
case ",$profiles," in *,formula,*) formula_on=1 ;; esac
problems=0

preflight() {
  if grep -qE 'TODO|change-me' "$ENV_FILE"; then
    warn "$ENV_FILE still has TODO or change-me values."
  fi
  if [ -n "$tunnel_token" ]; then
    case "$app_url" in
      ""|*localhost*) warn "The tunnel is on but APP_URL is '${app_url:-unset}': emailed links will point at localhost." ;;
    esac
    case "$cors" in
      ""|*localhost*) warn "The tunnel is on but CORS_ORIGINS is '${cors:-unset}': set the public address too." ;;
    esac
  fi
  if [ -z "$(setting FILES_SECRET)" ]; then
    warn "FILES_SECRET is unset: importing PDFs and Word files into Docs stays off."
  elif [ -z "$(setting FILES_MASTER_KEY)" ]; then
    warn "FILES_MASTER_KEY is unset: set one (openssl rand -base64 32) so stored uploads use their own key."
  fi
  if [ "$ocr_on" = 1 ] && [ -z "$(setting OCR_URL)" ]; then
    warn "The ocr profile is on but OCR_URL is unset: set OCR_URL=http://ocr:8000 or scanned pages are refused."
  fi
  if [ "$formula_on" = 1 ] && [ -z "$(setting FORMULA_URL)" ]; then
    warn "The formula profile is on but FORMULA_URL is unset: set FORMULA_URL=http://formula:8000 or scanned equations keep a placeholder."
  fi
  if [ "$formula_on" = 0 ] && [ -n "$(setting FORMULA_URL)" ]; then
    echo "FORMULA_URL is set but the formula profile is off: add formula to COMPOSE_PROFILES, or clear FORMULA_URL." >&2
    problems=1
  fi
  if [ "$ocr_on" = 0 ] && [ -n "$(setting OCR_URL)" ]; then
    echo "OCR_URL is set but the ocr profile is off: add ocr to COMPOSE_PROFILES, or clear OCR_URL." >&2
    problems=1
  fi
  if [ "$smtp_host" = mail ]; then
    for v in MAIL_HOSTNAME MAIL_DOMAIN; do
      [ -n "$(setting "$v")" ] || { echo "DOCKER_SMTP_HOST=mail needs $v in .env." >&2; problems=1; }
    done
    if [ "$mail_config" = maddy-relay.conf ]; then
      for v in MAIL_RELAY MAIL_RELAY_USER MAIL_RELAY_PASSWORD; do
        [ -n "$(setting "$v")" ] || { echo "maddy-relay.conf needs $v in .env." >&2; problems=1; }
      done
    fi
  fi
}
preflight

if [ "$CHECK" = 1 ]; then
  log "Plan for $(git rev-parse --short HEAD 2>/dev/null || echo '(no git)') (nothing changes in --check)"
  [ "$PULL" = 1 ] && echo "- pull the latest code (git pull --ff-only)" || echo "- deploy what is checked out"
  echo "- build images"
  echo "- make sure postgres and pgbouncer run (never recreated here)"
  [ "$BACKUP" = 1 ] && echo "- dump the database to backups/ (keep $(setting BACKUP_KEEP 7))" || echo "- no database dump"
  case "$smtp_host" in
    mail) echo "- start the outbound mail server ($mail_config for $mail_domain)" ;;
    mailpit) echo "- start the development mail catcher (mailpit)" ;;
    *) echo "- mail goes to $smtp_host (nothing to start)" ;;
  esac
  echo "- apply migrations, then roll out api, ai, realtime, status, notifier, files, converter and the web app"
  echo "- scanned pages and photos: read with the built-in Tesseract"
  [ "$formula_on" = 1 ] && echo "- start or replace the formula model (equations on scans)" || echo "- no formula model (the formula profile is off; scanned equations keep a placeholder)"
  [ "$ocr_on" = 1 ] && echo "- start or replace the heavy OCR model ($(setting OCR_WORKERS 1) worker(s); the first start downloads the model)" || echo "- no heavy OCR model (the ocr profile is off; this is the default)"
  echo "- replace the gateway only if it changed"
  [ -n "$tunnel_token" ] && echo "- start or update the Cloudflare tunnel" || echo "- no tunnel (CLOUDFLARE_TUNNEL_TOKEN unset)"
  echo "- prune leftover images; check /version"
  echo
  echo "APP_URL=${app_url:-unset}  CORS_ORIGINS=${cors:-unset}"
  compose --env-file "$ENV_FILE" config --quiet && echo "compose.yaml + $ENV_FILE: valid"
  [ "$problems" = 0 ] && echo "Preflight: OK" || { echo "Preflight: fix the problems above."; exit 1; }
  exit 0
fi
[ "$problems" = 0 ] || exit 1

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

# A restorable copy of the database from just before this deploy's migrations.
if [ "$BACKUP" = 1 ]; then
  log "Backing up the database"
  mkdir -p backups
  db=$(setting POSTGRES_DB orbyn)
  file="backups/$db-$(date -u +%Y%m%d-%H%M%S)-$GIT_SHA.dump"
  compose exec -T postgres pg_dump -U "$(setting POSTGRES_USER orbyn)" -Fc "$db" > "$file"
  echo "Saved $file ($(du -h "$file" | cut -f1))"
  keep=$(setting BACKUP_KEEP 7)
  ls -1t backups/*.dump 2>/dev/null | tail -n +"$((keep + 1))" | while read -r old; do rm -f "$old"; done
fi

# Bring up the selected mail backend before restarting its clients.
# Naming a service on the command line activates its optional profile.
case "$smtp_host" in
  mail)
    log "Starting the outbound mail server"
    compose up -d --wait --wait-timeout 90 mail
    dns=$(compose exec -T mail sh -c "cat /data/dkim_keys/${mail_domain}_default.dns 2>/dev/null" || true)
    if [ -n "$dns" ]; then
      echo "DKIM record, TXT at default._domainkey.$mail_domain:"
      echo "  $dns"
      if command -v dig >/dev/null 2>&1; then
        if dig +short TXT "default._domainkey.$mail_domain" 2>/dev/null | grep -q 'v=DKIM1'; then
          echo "  Published: yes"
        else
          echo "  Published: not yet. Add it, or receivers can't verify this server's signature."
        fi
      fi
    fi
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
# Open streams on the old copies close as they stop; clients reconnect to the
# new ones on their own (EventSource retries), so a rollout loses no updates.
rollout realtime "$(setting REALTIME_REPLICAS 2)"
rollout status "$(setting STATUS_REPLICAS 1)"
rollout notifier "$(setting NOTIFIER_REPLICAS 1)"
# Importing into Docs: the file store (uploads in flight get 30 s to finish
# as an old copy stops) and the converter, which picks up where it left off.
rollout files "$(setting FILES_REPLICAS 1)"
rollout converter "$(setting CONVERTER_REPLICAS 1)"
# The OCR service loads a large model, so it's replaced in place rather than
# rolled: scanned pages wait in the queue while it starts, and nothing is lost.
if [ "$formula_on" = 1 ]; then
  log "Starting the formula model"
  compose up -d --no-deps formula
fi
if [ "$ocr_on" = 1 ]; then
  log "Starting the OCR service"
  compose up -d --no-deps --scale "ocr=$(setting OCR_WORKERS 1)" ocr
  echo "The model loads in the background; 'docker compose logs -f ocr' shows 'model loaded'."
fi
rollout desktop "$(setting WEB_REPLICAS 2)"

# Why the gateway's running container differs from compose.yaml, or nothing
# when it matches. Its image tag is pinned in compose.yaml, so the
# configuration fingerprint covers image changes too.
gateway_change() {
  local id want_hash have_hash
  id=$(compose ps -q gateway | head -1)
  [ -z "$id" ] && { echo "not running"; return; }
  want_hash=$(compose config --hash gateway | awk '{print $2}')
  have_hash=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$id")
  if [ "$want_hash" != "$have_hash" ]; then echo "configuration changed"; fi
  return 0
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

# Public access: Cloudflare connects to this container, so no port is opened.
# Its image follows a tag (latest by default), so pull picks up new releases.
# Started last and with --no-deps: it depends on the gateway, and a plain
# `up cloudflared` would replace everything behind the gateway (api, ai,
# realtime, status, files) at once with the new images, a full outage.
if [ -n "$tunnel_token" ]; then
  log "Starting the Cloudflare tunnel"
  compose pull -q cloudflared || warn "couldn't pull the cloudflared image; using the one already here"
  compose up -d --wait --no-deps cloudflared
fi

# Each build leaves the previous images' layers behind; only unreferenced
# layers go, so a rollback to a running image is never affected.
log "Removing leftover image layers"
docker image prune -f | tail -1

log "Checking what is serving"
api_port=$(setting API_PORT 8008)
if health=$(curl -fsS --max-time 10 "http://127.0.0.1:$api_port/health" 2>/dev/null); then
  echo "Health: $health"
  version=$(curl -fsS --max-time 10 "http://127.0.0.1:$api_port/version" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  if [ "$version" = "$GIT_SHA" ]; then
    echo "Version: $version (this deploy)"
  else
    warn "the API reports version '${version:-unknown}', not $GIT_SHA; the old copies may still be draining."
  fi
else
  warn "couldn't reach http://127.0.0.1:$api_port/health from here (API_BIND may not be loopback)."
fi

log "Deployed $GIT_SHA"
compose ps
if [ -n "$app_url" ]; then echo "Open it at $app_url"; fi
