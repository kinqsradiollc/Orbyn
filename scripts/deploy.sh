#!/usr/bin/env bash
# Deploy orbyn.dev on one Docker host, and remove what is left of the old Orbyn app.
#
#   ./scripts/deploy.sh              pull, remove the old app (after a final dump), build, start
#   ./scripts/deploy.sh --check      list exactly what would be removed and started; change nothing
#   ./scripts/deploy.sh --no-pull    deploy what is checked out
#   ./scripts/deploy.sh --keep-old   deploy the site but leave the old app's data alone
#
# On Windows, run it from Git Bash:
#   "C:\Program Files\Git\bin\bash.exe" ./scripts/deploy.sh
#
# What happens, in order:
#   1. Read .env: CLOUDFLARE_TUNNEL_TOKEN, APP_URL and optionally WEB_PORT.
#   2. Pull the latest code (git pull --ff-only).
#   3. Build the site image. Then, for the old Orbyn, only if any of it is
#      still here: dump its database once to
#      backups/, then remove its containers, volumes (database, uploads, page
#      files, OCR model, mail queue) and images. Nothing is removed if the dump
#      fails. Only Docker objects labelled with this Compose project are touched.
#   4. Start the site, then the Cloudflare tunnel.
#   5. Check that the site answers locally and print what is running.
set -euo pipefail
cd "$(dirname "$0")/.."

# Git Bash on Windows rewrites Unix-looking arguments into Windows paths
# (/var/lib/... becomes C:/Program Files/Git/var/lib/...). Harmless elsewhere.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

PULL=1 CHECK=0 REMOVE_OLD=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --check) CHECK=1 ;;
    --keep-old) REMOVE_OLD=0 ;;
    -h | --help) awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/,""); print}' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
# A value from .env without sourcing it (values may contain $ or quotes).
setting() { local v; v=$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true); echo "${v:-${2:-}}"; }

command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker info >/dev/null 2>&1 || die "Docker is not running."
[ -f .env ] || die "No .env next to compose.yaml. Copy .env.example to .env and fill it in."

# ---------------------------------------------------------------------------
# 1. Settings
tunnel_token=$(setting CLOUDFLARE_TUNNEL_TOKEN)
app_url=$(setting APP_URL https://orbyn.dev)
web_port=$(setting WEB_PORT 8080)
case "$web_port" in '' | *[!0-9]*) die "WEB_PORT must be a port number." ;; esac
[ -n "$tunnel_token" ] || warn "CLOUDFLARE_TUNNEL_TOKEN is empty: the site will only be reachable on 127.0.0.1:$web_port."

# Settings the old app needed. They do nothing now and some are secrets.
old_keys=$(grep -oE '^#?[[:space:]]*[A-Z][A-Z0-9_]*=' .env | tr -d '#= \t' | grep -vxE 'CLOUDFLARE_TUNNEL_TOKEN|APP_URL|WEB_PORT|CLOUDFLARED_IMAGE|COMPOSE_PROJECT_NAME' || true)
if [ -n "$old_keys" ]; then
  warn ".env still has settings from the old app (remove them; .env.example lists what is used):"
  printf '%s\n' "$old_keys" | sed 's/^/  /' >&2
fi

# ---------------------------------------------------------------------------
# What is left of the old app. The Compose project name comes from compose.yaml
# and .env (COMPOSE_PROJECT_NAME) or the folder name, as for the old app.
project=$(docker compose config 2>/dev/null | sed -n 's/^name: //p' | head -1)
[ -n "$project" ] || die "docker compose could not read compose.yaml."
# Every service the old compose.yaml defined. The site's own services (web,
# cloudflared) are never in this list.
OLD_SERVICES="postgres postgres-test pgbouncer postgres-replica migrate api pdf latex ai assistant-background assistant-overnight realtime mcp notifier plugin files converter measure formula ocr status gateway desktop mail mailpit"
OLD_VOLUMES="postgres_data import_files page_files ocr_models postgres_replica_data mail_data"

old_containers=() old_images=() old_volumes=()
for svc in $OLD_SERVICES; do
  while IFS= read -r line; do
    [ -n "$line" ] && old_containers+=("$line")
  done < <(docker ps -a --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$svc" --format '{{.ID}} {{.Names}} {{.Image}} ({{.State}})')
done
for c in "${old_containers[@]+"${old_containers[@]}"}"; do
  img=$(printf '%s' "$c" | awk '{print $3}')
  case " ${old_images[*]+"${old_images[*]}"} " in *" $img "*) ;; *) old_images+=("$img") ;; esac
done
# Images the old compose built: <project>-<service>.
while IFS= read -r img; do
  case "$img" in "$project-web:"* | "") continue ;; esac
  name=${img%%:*}; svc=${name#"$project"-}
  case " $OLD_SERVICES " in *" $svc "*)
    case " ${old_images[*]+"${old_images[*]}"} " in *" $img "*) ;; *) old_images+=("$img") ;; esac ;;
  esac
done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^$project-" || true)
for v in $OLD_VOLUMES; do
  if docker volume inspect "${project}_$v" >/dev/null 2>&1; then old_volumes+=("${project}_$v"); fi
done
db_container=$(docker ps -a --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=postgres" --format '{{.ID}}' | head -1)
old_left=$(( ${#old_containers[@]} + ${#old_images[@]} + ${#old_volumes[@]} ))

print_old() {
  if [ "$old_left" -eq 0 ]; then echo "- nothing is left of the old Orbyn app (project '$project')"; return; fi
  if [ "$REMOVE_OLD" = 0 ]; then echo "- leave the old Orbyn app alone (--keep-old); $old_left object(s) remain"; return; fi
  if [ -n "$db_container" ]; then
    echo "- dump the old database once to backups/orbyn-final-<time>.dump (pg_dump -Fc, from container $db_container)"
  elif [ ${#old_volumes[@]} -gt 0 ]; then
    echo "- the old database container is gone, so no final dump can be taken; the volumes below will NOT be removed"
  fi
  echo "- remove these old containers:"
  for c in "${old_containers[@]+"${old_containers[@]}"}"; do echo "    $c"; done
  [ ${#old_containers[@]} -gt 0 ] || echo "    (none)"
  echo "- remove these old volumes, with all their data:"
  for v in "${old_volumes[@]+"${old_volumes[@]}"}"; do echo "    $v"; done
  [ ${#old_volumes[@]} -gt 0 ] || echo "    (none)"
  echo "- remove these old images (skipped if another project still uses one):"
  for i in "${old_images[@]+"${old_images[@]}"}"; do echo "    $i"; done
  [ ${#old_images[@]} -gt 0 ] || echo "    (none)"
}

if [ "$CHECK" = 1 ]; then
  log "Plan for $(git rev-parse --short HEAD 2>/dev/null || echo '(no git)') in Compose project '$project' (--check changes nothing)"
  [ "$PULL" = 1 ] && echo "- pull the latest code (git pull --ff-only)" || echo "- deploy what is checked out"
  print_old
  echo "- build the site image and start 'web' on 127.0.0.1:$web_port"
  [ -n "$tunnel_token" ] && echo "- start or update the Cloudflare tunnel (it reaches the site at http://web:8080, also named gateway:8080)" || echo "- no tunnel (CLOUDFLARE_TUNNEL_TOKEN is empty)"
  echo "- remove dangling image layers; check http://127.0.0.1:$web_port/healthz"
  echo
  echo "APP_URL=$app_url"
  docker compose config --quiet && echo "compose.yaml + .env: valid"
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Code
if [ "$PULL" = 1 ]; then
  log "Pulling the latest code"
  git pull --ff-only
fi
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
export GIT_SHA

# ---------------------------------------------------------------------------
# Build first: if the build fails, nothing has been removed yet.
log "Building the site for $GIT_SHA"
docker compose build web

# ---------------------------------------------------------------------------
# 3. The old app
if [ "$REMOVE_OLD" = 1 ] && [ "$old_left" -gt 0 ]; then
  log "Removing the old Orbyn app"
  print_old
  keep_volumes=0
  if [ -n "$db_container" ]; then
    log "Taking the final dump of the old database"
    if [ "$(docker inspect -f '{{.State.Running}}' "$db_container")" != true ]; then
      docker start "$db_container" >/dev/null
    fi
    for _ in $(seq 1 60); do
      docker exec "$db_container" sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break
      sleep 2
    done
    umask 077
    mkdir -p backups
    chmod 700 backups 2>/dev/null || true
    dump="backups/orbyn-final-$(date -u +%Y%m%d-%H%M%S).dump"
    # Credentials come from the container's own environment, not from .env.
    if docker exec "$db_container" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$dump" && [ -s "$dump" ]; then
      echo "Saved $dump ($(du -h "$dump" | cut -f1)). Keep it somewhere safe; delete it when you no longer need the old data."
    else
      rm -f "$dump"
      die "The final dump failed, so nothing was removed. Fix the database container and run this again."
    fi
  elif [ ${#old_volumes[@]} -gt 0 ]; then
    warn "No old database container to dump from: keeping the old volumes. Remove them by hand once you have a copy."
    keep_volumes=1
  fi

  for c in "${old_containers[@]+"${old_containers[@]}"}"; do
    id=${c%% *}
    docker rm -f "$id" >/dev/null && echo "Removed container ${c#* }"
  done
  if [ "$keep_volumes" = 0 ]; then
    for v in "${old_volumes[@]+"${old_volumes[@]}"}"; do
      docker volume rm "$v" >/dev/null && echo "Removed volume $v"
    done
  fi
  for i in "${old_images[@]+"${old_images[@]}"}"; do
    if docker image rm "$i" >/dev/null 2>&1; then echo "Removed image $i"; else echo "Kept image $i (still in use elsewhere)"; fi
  done
fi

# ---------------------------------------------------------------------------
# 4. The site (built before step 3, so a failed build leaves the old app running)
log "Starting the site"
docker compose up -d --wait --remove-orphans web
if [ -n "$tunnel_token" ]; then
  log "Starting the Cloudflare tunnel"
  docker compose pull -q cloudflared || warn "couldn't pull the cloudflared image; using the one already here"
  docker compose --profile tunnel up -d --wait --no-deps cloudflared
fi

log "Removing dangling image layers"
docker image prune -f | tail -1

# ---------------------------------------------------------------------------
# 5. Check
log "Checking the site"
if curl -fsS --max-time 10 "http://127.0.0.1:$web_port/healthz" >/dev/null 2>&1; then
  echo "Serving on 127.0.0.1:$web_port"
else
  warn "http://127.0.0.1:$web_port/healthz did not answer."
fi
docker compose --profile tunnel ps
log "Deployed $GIT_SHA. Open $app_url"
