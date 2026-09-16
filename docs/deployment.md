# Deployment

The Compose file in the repository is tuned for local development. This checklist covers what to
change for a real deployment.

## Images

Two images are built from the repository root:

| Dockerfile             | Image role                                       | Commands                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/Dockerfile`   | Every backend service and migrations (one image) | `node backend/dist/services/api.js`, `.../services/ai.js`, `.../services/status.js`, `.../services/notifier.js`, `node backend/dist/migrate.js`; `server.js` runs all in one |
| `desktop/Dockerfile`   | Static web app behind unprivileged nginx         | nginx                                                                                                                                                                        |
| `pgbouncer/Dockerfile` | Connection pooler (Alpine's PgBouncer)           | Configured from environment at start                                                                                                                                         |

The gateway uses the stock `nginxinc/nginx-unprivileged` image with `gateway/` mounted.

Both are multi-stage, run as non-root, and use `node:22-bookworm-slim` / `nginx-unprivileged`.

```bash
docker build -f backend/Dockerfile -t orbyn-backend .
docker build -f desktop/Dockerfile -t orbyn-web .
docker build -t orbyn-pgbouncer pgbouncer
```

For Kubernetes manifests (deployments, autoscaling, ingress, network policies), see
[deploy/k8s](../deploy/k8s/README.md). For multi-host topology, replicas and capacity, see
[scalability.md](scalability.md).

## Checklist

1. **Secrets.** Set a strong `POSTGRES_PASSWORD`, SMTP credentials, and `SECRETS_KEY`. AI providers are added
   by admins in the app, not in `.env`. Use
   your platform's secret store rather than a committed `.env`.
2. **Database.** Prefer a managed PostgreSQL 15+ with automated backups, failover and read
   replicas. Point `DATABASE_URL` at its pooler (or PgBouncer) and `DATABASE_READ_URL` at a replica
   endpoint. Run the `migrate` command once per deploy, directly against the primary, before
   starting new service containers.
3. **TLS and load balancing.** Put a load balancer (a cloud load balancer, Caddy, Traefik) in front
   of two or more gateways and the web container. Or serve the stack through
   [a Cloudflare tunnel](#public-access-through-a-cloudflare-tunnel), where Cloudflare handles TLS
   and the machine needs no open port. The mobile app and browsers must reach the API
   over HTTPS. Set `GATEWAY_TRUSTED_PROXIES` to the load balancer's ranges so rate limits see real
   client addresses, and leave `GATEWAY_RATE_LIMIT_EXEMPT` empty.
4. **CORS.** Set `CORS_ORIGINS` to your web origin(s), for example `https://app.example.com`.
5. **Email.** Set `DOCKER_SMTP_HOST` (or `SMTP_HOST` outside Compose) to your relay along with
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, and a `SMTP_FROM` on a domain you
   control with SPF/DKIM configured. Remove the `mailpit` service.
6. **Push.** Set `EXPO_PUBLIC_EAS_PROJECT_ID` in the mobile build and, if enabled on your Expo
   account, `EXPO_ACCESS_TOKEN` on the worker.
7. **Ports.** Keep the API bound to the internal network and expose only the proxy. The default
   Compose binds the API and Postgres to loopback.
8. **Scaling.** Run several `api` and `ai` instances, two `status` instances and one or more
   `notifier` instances, on one host or many. List them in `GATEWAY_API_SERVERS` and friends when
   they run on other machines. See [scalability.md](scalability.md).
9. **Health.** Every HTTP service serves `GET /live` (liveness, no database) and `GET /health`
   (readiness, includes the database). The gateway answers `GET /health` itself.
10. **Logs.** The API logs JSON to stdout with the authorization header and passwords redacted; the
    worker logs retry events as JSON. Ship stdout to your log system.
11. **Desktop installers.** `npm run package -w desktop` builds dmg/nsis/AppImage. Set
    `VITE_API_URL=https://api.example.com` before `npm run build -w desktop` so the Electron app
    talks to production instead of localhost.

## Public access through a Cloudflare tunnel

Cloudflare reaches a `cloudflared` container inside the stack, so the machine needs no open port
and no certificate of its own. The tunnel only runs when you ask for it.

1. In Cloudflare (Zero Trust → Networks → Tunnels), create a tunnel and copy its token.
2. Put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN=…`. Treat it as a secret: anyone holding it can
   run your tunnel. `.env` is not in git.
3. Give the tunnel a public hostname and point it at `http://gateway:8081` — the web app, with
   the API under `/api`. One hostname serves both.
4. Set `APP_URL` and `CORS_ORIGINS` to that address (`https://your-domain`), so booking and
   invitation links, and the browser's own requests, use it.
5. Set `GATEWAY_TRUSTED_PROXIES` to the Docker network range (for example `172.16.0.0/12`), so
   rate limits and logs see the real client address instead of the tunnel container's, and clear
   `GATEWAY_RATE_LIMIT_EXEMPT`.
6. Start it:

```bash
docker compose --profile tunnel up -d
```

`docker compose logs -f cloudflared` shows it registering, and Cloudflare's dashboard shows the
tunnel healthy. The API's host port stays on `127.0.0.1` (`API_BIND`); the web port listens on
every interface unless you set `WEB_PORT=127.0.0.1:8080`, which leaves the tunnel as the only way
in.

The token is passed in the environment, not on the command line, so it stays out of `docker ps`
and `docker inspect`. To pin a cloudflared release instead of following `latest`, set
`CLOUDFLARED_IMAGE`.

## Deploying without downtime

Use `scripts/deploy.sh` for every update, including `.env` changes:

```bash
./scripts/deploy.sh            # git pull, build, migrate, roll out
./scripts/deploy.sh --no-pull  # deploy what is checked out
```

Plain `docker compose up -d` replaces every changed container at once, so a service is down
while its replacement starts. The script instead:

1. builds images stamped with the commit (shown in Admin → System and at `GET /version`);
2. applies database migrations before any new code serves traffic;
3. for each backend service, starts new copies beside the old ones, waits until they pass their
   health checks and the gateway has picked them up (it re-resolves every 10 seconds), then stops
   the old copies gracefully so in-flight requests finish;
4. replaces the gateway only when its configuration or image changed (nginx starts in about a
   second), and says why.

The gateway is the only container with host ports: it serves the API port (`API_PORT`) and the web
port (`WEB_PORT`). The web app runs behind it like every other service, so it rolls over without
downtime too.

If a new copy fails its health check, the old copies keep serving and the script stops with the
new copies' logs. The API, assistant and web app run two copies by default (`API_REPLICAS`,
`AI_REPLICAS`, `WEB_REPLICAS`;
`STATUS_REPLICAS` and `NOTIFIER_REPLICAS` default to one), so a crash or restart of one copy is
also absorbed.

### Deploying from GitHub

`.github/workflows/deploy.yml` runs the script on the server over SSH. Run it from the Actions tab
("Deploy" → "Run workflow"), or set the repository variable `AUTO_DEPLOY` to `true` to deploy
automatically after CI passes on `main`. It needs these repository secrets:

| Secret               | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`        | Server address                                                                          |
| `DEPLOY_USER`        | SSH user that can run `docker`                                                          |
| `DEPLOY_SSH_KEY`     | Private key for that user; its public key goes in the server's `~/.ssh/authorized_keys` |
| `DEPLOY_PATH`        | The Orbyn checkout on the server, for example `/opt/orbyn`                              |
| `DEPLOY_PORT`        | Optional, defaults to 22                                                                |
| `DEPLOY_KNOWN_HOSTS` | Optional output of `ssh-keyscan <host>`, to pin the server key                          |

## Settings in the app

Admins change these in **Admin → System**; every instance picks them up within about 10 seconds,
with no restart or deploy. Anything not set there falls back to `.env`, and each setting can be
reset to its `.env` value:

- allowed web origins (`CORS_ORIGINS`);
- the per-client rate limit (`RATE_LIMIT_PER_MINUTE`);
- reminder delivery lanes (`NOTIFIER_CONCURRENCY`) and the status check interval
  (`STATUS_INTERVAL_MS`);
- email: SMTP host, port, user, password (stored encrypted) and sender, with a test email button.

Secrets and infrastructure stay in `.env`: the database password, `SECRETS_KEY`, ports, and where
services run.

## Maintenance mode

Switch it on in **Admin → System** with an optional message and end time. Members can still sign
in and read everything, but changes are refused with a clear message (HTTP 503); admins keep full
access. The web and mobile apps show a banner and the public status page shows the notice.

## Updates

Admin → System shows the running version. With `UPDATE_REPO=owner/repo` (and `GITHUB_TOKEN`, a
read-only token, for a private repository) it also shows the newest commit on `UPDATE_BRANCH`
(default `main`), whether an update is available, and a link to the deploy workflow. After a
deploy, the web app notices the new version and offers a reload; its page is served with
`Cache-Control: no-cache`, so browsers never keep running old code.

## Backups

Everything lives in PostgreSQL. A nightly `pg_dump` of the `orbyn` database is a complete backup.

## Scaling services

On one host, scale a service with `docker compose up -d --scale api=3 --scale ai=2`. The gateway
re-resolves service names, so new instances receive traffic without a restart. To spread services
across machines, run the backend image on each host and point the gateway at them:

```bash
GATEWAY_API_SERVERS="10.0.1.10:8000 10.0.1.11:8000" \
GATEWAY_AI_SERVERS="10.0.2.10:8000" \
GATEWAY_STATUS_SERVERS="10.0.3.10:8000" \
docker compose up -d gateway
```

Running more than one `notifier` or `status` instance is safe: reminder delivery and status
recording coordinate through PostgreSQL locks. Keep instances x `DB_POOL_MAX` within PgBouncer's
`max_client_conn`. The full guide, with measured numbers and a capacity plan, is
[scalability.md](scalability.md).

## Secrets key

`SECRETS_KEY` is optional. Without it, Orbyn generates a key on first use and keeps it in the
database, so AI provider keys saved from the admin console work with no setup. In production, set
`SECRETS_KEY` so the key lives outside the database: a leaked database dump then cannot reveal
saved keys. Keys saved before you set it keep working. Back `SECRETS_KEY` up with the database;
without it, keys saved while it was set cannot be decrypted and admins must re-enter them.
