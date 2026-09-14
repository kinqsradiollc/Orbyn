# Deployment

The Compose file in the repository is tuned for local development. This checklist covers what to
change for a real deployment.

## Images

Two images are built from the repository root:

| Dockerfile           | Image role                               | Commands                                                                                               |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `backend/Dockerfile` | API, worker, and migrations (same image) | `node backend/dist/server.js` (default), `node backend/dist/worker.js`, `node backend/dist/migrate.js` |
| `desktop/Dockerfile` | Static web app behind unprivileged nginx | nginx                                                                                                  |

Both are multi-stage, run as non-root, and use `node:22-bookworm-slim` / `nginx-unprivileged`.

```bash
docker build -f backend/Dockerfile -t orbyn-backend .
docker build -f desktop/Dockerfile -t orbyn-web .
```

## Checklist

1. **Secrets.** Set a strong `POSTGRES_PASSWORD`, a real `AI_API_KEY`, and SMTP credentials. Use
   your platform's secret store rather than a committed `.env`.
2. **Database.** Either keep the `postgres` service with a backed-up volume or point
   `DATABASE_URL` at a managed PostgreSQL 15+ instance and drop the service. Run the `migrate`
   command once per deploy before starting new API/worker containers.
3. **TLS.** Put a reverse proxy (Caddy, Traefik, nginx, a cloud load balancer) in front of the web
   container and the API. The mobile app and browsers must reach the API over HTTPS in production.
4. **CORS.** Set `CORS_ORIGINS` to your web origin(s), for example `https://app.example.com`.
5. **Email.** Set `DOCKER_SMTP_HOST` (or `SMTP_HOST` outside Compose) to your relay along with
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, and a `SMTP_FROM` on a domain you
   control with SPF/DKIM configured. Remove the `mailpit` service.
6. **Push.** Set `EXPO_PUBLIC_EAS_PROJECT_ID` in the mobile build and, if enabled on your Expo
   account, `EXPO_ACCESS_TOKEN` on the worker.
7. **Ports.** Keep the API bound to the internal network and expose only the proxy. The default
   Compose binds the API and Postgres to loopback.
8. **Scaling.** Run one or more `api` replicas behind the proxy and one or more `worker` replicas.
   Workers coordinate through Postgres locks and are safe to scale horizontally.
9. **Health.** `GET /health` on the API is suitable for load balancer and orchestrator probes.
10. **Logs.** The API logs JSON to stdout with the authorization header and passwords redacted; the
    worker logs retry events as JSON. Ship stdout to your log system.
11. **Desktop installers.** `npm run package -w desktop` builds dmg/nsis/AppImage. Set
    `VITE_API_URL=https://api.example.com` before `npm run build -w desktop` so the Electron app
    talks to production instead of localhost.

## Backups

Everything lives in PostgreSQL. A nightly `pg_dump` of the `orbyn` database is a complete backup.

## Scaling services

Each backend service can be scaled on its own, for example
`docker compose up -d --scale api=3 --scale ai=2`. The gateway resolves service names per request,
so new replicas receive traffic without a restart. Running more than one `notifier` or `status`
replica is safe: reminder scheduling and status recording coordinate through PostgreSQL locks.

## Secrets key

`SECRETS_KEY` encrypts AI provider keys saved from the admin console. Back it up with the database:
without it, saved keys cannot be decrypted and admins must re-enter them.
