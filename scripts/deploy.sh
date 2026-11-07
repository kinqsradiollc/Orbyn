#!/usr/bin/env bash
# Deploy orbyn.dev on one Docker host, and remove what is left of the old Orbyn app.
#
#   ./scripts/deploy.sh              pull, build, back up and remove the old app, start the site
#   ./scripts/deploy.sh --check      list exactly what would be removed and started; change nothing
#   ./scripts/deploy.sh --no-pull    deploy what is checked out
#   ./scripts/deploy.sh --keep-old   deploy the site but leave the old app and its data alone
#
# On Windows, run it from Git Bash:
#   "C:\Program Files\Git\bin\bash.exe" ./scripts/deploy.sh
#
# What happens, in order:
#   1. Read .env: CLOUDFLARE_TUNNEL_TOKEN, APP_URL and optionally WEB_PORT.
#   2. Pull the latest code (git pull --ff-only) and build the site image.
#      A failed build stops here, with the old app untouched.
#   3. Only if something of the old Orbyn app is still here: stop it and save
#      one final backup to backups/orbyn-final-<time>/: the database dump, the
#      uploaded and page files, and the keys that decrypt them. Then remove its
#      containers, volumes and images. If any part of the backup fails, nothing
#      is removed. Only Docker objects labelled with this Compose project, and
#      named after the old app's services and volumes, are touched.
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
# One variable from a container's environment.
container_env() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | tr -d '\r' | sed -n "s/^$2=//p" | head -1; }

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

# ---------------------------------------------------------------------------
# What is left of the old app. The Compose project name comes from .env
# (COMPOSE_PROJECT_NAME) or the folder name, as it did for the old app.
project=$(docker compose config 2>/dev/null | sed -n 's/^name: //p' | head -1)
[ -n "$project" ] || die "docker compose could not read compose.yaml."
# Every service and volume the old compose.yaml defined. The site's own
# services (web, cloudflared) are not in these lists.
OLD_SERVICES="postgres postgres-test pgbouncer postgres-replica migrate api pdf latex ai assistant-background assistant-overnight realtime mcp notifier plugin files converter measure formula ocr status gateway desktop mail mailpit"
OLD_VOLUMES="postgres_data import_files page_files ocr_models postgres_replica_data mail_data"
# Volumes whose contents go into the final backup besides the database.
FILE_VOLUMES="page_files import_files"
# Keys the old app used to encrypt data in the database and in stored files.
OLD_KEYS="SECRETS_KEY FILES_MASTER_KEY FILES_SECRET DOC_PDF_KEY"
# Images the site itself uses; never removed even if the old app used them too.
KEEP_IMAGES="nginxinc/nginx-unprivileged cloudflare/cloudflared"

old_containers=() old_images=() old_volumes=()
add_image() {
  local img=$1 keep
  for keep in $KEEP_IMAGES; do case "$img" in "$keep" | "$keep:"*) return ;; esac; done
  case " ${old_images[*]+"${old_images[*]}"} " in *" $img "*) ;; *) old_images+=("$img") ;; esac
}
for svc in $OLD_SERVICES; do
  while IFS= read -r line; do
    [ -n "$line" ] && old_containers+=("$line")
  done < <(docker ps -a --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$svc" --format '{{.ID}} {{.Names}} {{.Image}} ({{.State}})')
done
for c in "${old_containers[@]+"${old_containers[@]}"}"; do add_image "$(printf '%s' "$c" | awk '{print $3}')"; done
# Images the old compose built: <project>-<service>.
while IFS= read -r img; do
  [ -n "$img" ] || continue
  name=${img%%:*}; svc=${name#"$project"-}
  case " $OLD_SERVICES " in *" $svc "*) add_image "$img" ;; esac
done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^$project-" || true)
for v in $OLD_VOLUMES; do
  if docker volume inspect "${project}_$v" >/dev/null 2>&1; then old_volumes+=("${project}_$v"); fi
done
db_container=$(docker ps -a --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=postgres" --format '{{.ID}}' | head -1)
has_volume() { case " ${old_volumes[*]+"${old_volumes[*]}"} " in *" ${project}_$1 "*) return 0 ;; esac; return 1; }
old_left=$(( ${#old_containers[@]} + ${#old_images[@]} + ${#old_volumes[@]} ))

# The old .env settings are no longer used, but some are the keys to the
# backup. The final backup copies them out of the old containers first.
stale=$(grep -oE '^#?[[:space:]]*[A-Z][A-Z0-9_]*=' .env | tr -d '#= \t' | grep -vxE 'CLOUDFLARE_TUNNEL_TOKEN|APP_URL|WEB_PORT|CLOUDFLARED_IMAGE|COMPOSE_PROJECT_NAME' || true)
if [ -n "$stale" ]; then
  warn ".env has settings the site doesn't use. Remove them once the final backup holds the keys it needs:"
  printf '%s\n' "$stale" | sed 's/^/  /' >&2
fi

print_old() {
  if [ "$old_left" -eq 0 ]; then echo "- nothing is left of the old Orbyn app (project '$project')"; return; fi
  if [ "$REMOVE_OLD" = 0 ]; then echo "- leave the old Orbyn app alone (--keep-old); $old_left object(s) remain"; return; fi
  echo "- stop the old app's containers"
  if [ -n "$db_container" ] && has_volume postgres_data; then
    echo "- save the final backup to backups/orbyn-final-<time>/:"
    echo "    database.dump    pg_dump -Fc of the old database"
    for v in $FILE_VOLUMES; do if has_volume "$v"; then echo "    $v.tar.gz    everything in the ${project}_$v volume"; fi; done
    echo "    keys.env         $OLD_KEYS, if the old containers had them"
  elif [ ${#old_volumes[@]} -gt 0 ]; then
    echo "- no old database container or volume to dump, so the volumes below are KEPT, not removed"
  fi
  echo "- remove these old containers:"
  for c in "${old_containers[@]+"${old_containers[@]}"}"; do echo "    $c"; done
  [ ${#old_containers[@]} -gt 0 ] || echo "    (none)"
  echo "- remove these old volumes, with all their data:"
  for v in "${old_volumes[@]+"${old_volumes[@]}"}"; do echo "    $v"; done
  [ ${#old_volumes[@]} -gt 0 ] || echo "    (none)"
  echo "- remove these old images (kept if anything else still uses one):"
  for i in "${old_images[@]+"${old_images[@]}"}"; do echo "    $i"; done
  [ ${#old_images[@]} -gt 0 ] || echo "    (none)"
}

if [ "$CHECK" = 1 ]; then
  log "Plan for $(git rev-parse --short HEAD 2>/dev/null || echo '(no git)') in Compose project '$project' (--check changes nothing)"
  if [ "$PULL" = 1 ]; then echo "- pull the latest code (git pull --ff-only)"; else echo "- deploy what is checked out"; fi
  echo "- build the site image"
  print_old
  echo "- start 'web' on 127.0.0.1:$web_port"
  if [ -n "$tunnel_token" ]; then echo "- start or update the Cloudflare tunnel (it reaches the site at http://web:8080, also named gateway:8080)"; else echo "- no tunnel (CLOUDFLARE_TUNNEL_TOKEN is empty)"; fi
  echo "- remove dangling image layers; check http://127.0.0.1:$web_port/healthz"
  echo
  echo "APP_URL=$app_url"
  docker compose config --quiet && echo "compose.yaml + .env: valid"
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Code and image. Built first, so a failed build leaves everything as it was.
if [ "$PULL" = 1 ]; then
  log "Pulling the latest code"
  git pull --ff-only
fi
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
export GIT_SHA
log "Building the site for $GIT_SHA"
docker compose build web

# ---------------------------------------------------------------------------
# 3. The old app
final_backup() {
  # $1: the backup folder. Returns non-zero if any part fails.
  local dir=$1 image user db pgdata mount helper key val ready=0
  image=$(docker inspect -f '{{.Config.Image}}' "$db_container")
  user=$(container_env "$db_container" POSTGRES_USER); user=${user:-postgres}
  db=$(container_env "$db_container" POSTGRES_DB); db=${db:-$user}
  pgdata=$(container_env "$db_container" PGDATA)
  mount=$(docker inspect -f "{{range .Mounts}}{{if eq .Name \"${project}_postgres_data\"}}{{.Destination}}{{end}}{{end}}" "$db_container")
  mount=${mount:-/var/lib/postgresql/data}

  # The database, from a throwaway container on the stopped database's volume.
  # The old container is not restarted: its start script lived in the checkout,
  # which the pull just removed. Socket connections inside need no password.
  helper="orbyn-final-backup-$$"
  docker run -d --name "$helper" -e POSTGRES_PASSWORD=unused ${pgdata:+-e "PGDATA=$pgdata"} \
    -v "${project}_postgres_data:$mount" "$image" >/dev/null || return 1
  for _ in $(seq 1 90); do
    if docker exec "$helper" pg_isready -U "$user" -d "$db" >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
  if [ "$ready" = 1 ] && docker exec "$helper" pg_dump -U "$user" -Fc "$db" > "$dir/database.dump" && [ -s "$dir/database.dump" ]; then
    echo "Saved $dir/database.dump ($(du -h "$dir/database.dump" | cut -f1))"
  else
    docker logs --tail 20 "$helper" >&2 || true
    docker rm -f "$helper" >/dev/null
    return 1
  fi
  docker stop -t 30 "$helper" >/dev/null && docker rm "$helper" >/dev/null

  # Uploaded and page files, as stored (encrypted).
  for v in $FILE_VOLUMES; do
    has_volume "$v" || continue
    docker run --rm -v "${project}_$v:/data:ro" "$image" tar -C /data -czf - . > "$dir/$v.tar.gz" || return 1
    tar -tzf "$dir/$v.tar.gz" >/dev/null || return 1
    echo "Saved $dir/$v.tar.gz ($(du -h "$dir/$v.tar.gz" | cut -f1))"
  done

  # The keys those need, from the old containers' environment, else from .env.
  : > "$dir/keys.env"
  for key in $OLD_KEYS; do
    val=""
    for c in "${old_containers[@]+"${old_containers[@]}"}"; do
      val=$(container_env "${c%% *}" "$key")
      [ -n "$val" ] && break
    done
    [ -n "$val" ] || val=$(setting "$key")
    if [ -n "$val" ]; then printf '%s=%s\n' "$key" "$val" >> "$dir/keys.env"; fi
  done
  echo "Saved $dir/keys.env ($(grep -c . "$dir/keys.env" || true) key(s); values not shown)"
}

if [ "$REMOVE_OLD" = 1 ] && [ "$old_left" -gt 0 ]; then
  log "Removing the old Orbyn app"
  print_old
  keep_volumes=0
  if [ ${#old_containers[@]} -gt 0 ]; then
    log "Stopping the old app"
    for c in "${old_containers[@]}"; do docker stop -t 30 "${c%% *}" >/dev/null; done
  fi
  if [ -n "$db_container" ] && has_volume postgres_data; then
    log "Saving the final backup"
    umask 077
    backup="backups/orbyn-final-$(date -u +%Y%m%d-%H%M%S)"
    mkdir -p "$backup"
    chmod 700 backups "$backup" 2>/dev/null || true
    final_backup "$backup" || die "The final backup failed, so nothing was removed. The old app is stopped; 'docker start' on its containers brings it back."
    echo "Keep $backup somewhere safe, keys.env included, and delete it when you no longer need the old data."
  elif [ ${#old_volumes[@]} -gt 0 ]; then
    warn "No old database container or volume to dump: keeping the old volumes. Remove them by hand once you have a copy."
    keep_volumes=1
  fi

  for c in "${old_containers[@]+"${old_containers[@]}"}"; do
    docker rm -f "${c%% *}" >/dev/null && echo "Removed container $(printf '%s' "$c" | awk '{print $2}')"
  done
  if [ "$keep_volumes" = 0 ]; then
    for v in "${old_volumes[@]+"${old_volumes[@]}"}"; do
      docker volume rm "$v" >/dev/null && echo "Removed volume $v"
    done
  fi
  for i in "${old_images[@]+"${old_images[@]}"}"; do
    if docker image rm "$i" >/dev/null 2>&1; then echo "Removed image $i"; else echo "Kept image $i (still in use)"; fi
  done
fi

# ---------------------------------------------------------------------------
# 4. The site. --remove-orphans would also delete the old app's containers,
# so it is used only when the old app is being removed anyway.
log "Starting the site"
if [ "$REMOVE_OLD" = 1 ]; then
  docker compose up -d --wait --remove-orphans web
else
  docker compose up -d --wait web
fi
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
