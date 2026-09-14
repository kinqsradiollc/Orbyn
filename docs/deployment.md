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

1. **Secrets.** Set a strong `POSTGRES_PASSWORD`, a real `AI_API_KEY`, and SMTP credentials. Use
   your platform's secret store rather than a committed `.env`.
2. **Database.** Prefer a managed PostgreSQL 15+ with automated backups, failover and read
   replicas. Point `DATABASE_URL` at its pooler (or PgBouncer) and `DATABASE_READ_URL` at a replica
   endpoint. Run the `migrate` command once per deploy, directly against the primary, before
   starting new service containers.
3. **TLS and load balancing.** Put a load balancer (a cloud load balancer, Caddy, Traefik) in front
   of two or more gateways and the web container. The mobile app and browsers must reach the API
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

`SECRETS_KEY` encrypts AI provider keys saved from the admin console. Back it up with the database:
without it, saved keys cannot be decrypted and admins must re-enter them.
