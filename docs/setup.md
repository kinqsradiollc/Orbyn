# Setup guide

This guide covers running Orbyn with Docker Compose, running each part locally for development,
and every environment variable the system reads.

## Prerequisites

- Docker Desktop (or Docker Engine 24+ with the Compose plugin)
- Node.js 22 and npm 10 for local development
- For mobile: Expo CLI via `npx expo`, plus Xcode (iOS) or Android Studio (Android)

## 1. Configure the environment

```bash
cp .env.example .env
```

The root `.env` is read by Docker Compose and by the backend when it runs locally. Never commit
`.env`; it is ignored by git. Only `.env.example` is tracked.

### Environment variables

| Variable                                                                                        | Default                                       | Used by        | Description                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`                                                                                 | `orbyn`                                       | compose        | Database role created in the Postgres container.                                                                                                                                                                                                            |
| `POSTGRES_PASSWORD`                                                                             | required                                      | compose        | Database password. Compose refuses to start without it.                                                                                                                                                                                                     |
| `POSTGRES_DB`                                                                                   | `orbyn`                                       | compose        | Database name.                                                                                                                                                                                                                                              |
| `POSTGRES_PORT`                                                                                 | `5433`                                        | compose        | Host port the Postgres container is published on (loopback only).                                                                                                                                                                                           |
| `DATABASE_URL`                                                                                  | `postgres://orbyn:orbyn@localhost:5432/orbyn` | backend        | Connection string for local runs. Inside Compose it is derived automatically.                                                                                                                                                                               |
| `PORT`                                                                                          | `8000`                                        | backend        | Port the API listens on inside its container or local process.                                                                                                                                                                                              |
| `API_PORT`                                                                                      | `8008`                                        | compose        | Host port the API is published on.                                                                                                                                                                                                                          |
| `API_BIND`                                                                                      | `127.0.0.1`                                   | compose        | Host interface for the API port. Set `0.0.0.0` to expose on the LAN (needed for a physical phone).                                                                                                                                                          |
| `WEB_PORT`                                                                                      | `8080`                                        | compose        | Host port for the web app.                                                                                                                                                                                                                                  |
| `CORS_ORIGINS`                                                                                  | `http://localhost:5173,http://localhost:8080` | backend        | Comma-separated allowed browser origins.                                                                                                                                                                                                                    |
| `SMTP_HOST`                                                                                     | `localhost`                                   | backend/worker | SMTP server. Empty disables email. Compose overrides it with `DOCKER_SMTP_HOST`.                                                                                                                                                                            |
| `SMTP_PORT`                                                                                     | `1025`                                        | worker         | SMTP port.                                                                                                                                                                                                                                                  |
| `SMTP_USER`                                                                                     | empty                                         | worker         | SMTP username. Empty means no authentication.                                                                                                                                                                                                               |
| `SMTP_PASSWORD`                                                                                 | empty                                         | worker         | SMTP password.                                                                                                                                                                                                                                              |
| `SMTP_SECURE`                                                                                   | `false`                                       | worker         | `true` for implicit TLS (port 465).                                                                                                                                                                                                                         |
| `SMTP_FROM`                                                                                     | `Orbyn <reminders@orbyn.local>`               | worker         | Sender shown on reminder emails.                                                                                                                                                                                                                            |
| `DOCKER_SMTP_HOST`                                                                              | `mailpit`                                     | compose        | SMTP host the containers use: `mailpit` (the test inbox), `mail` (your own mail server, see deployment), or a provider's host.                                                                                                                              |
| `EXPO_ACCESS_TOKEN`                                                                             | empty                                         | worker         | Optional Expo access token for push delivery with enhanced security enabled.                                                                                                                                                                                |
| `ADMIN_EMAILS`                                                                                  | empty                                         | backend        | Comma-separated emails that are always system admins. The first account to register is also an admin.                                                                                                                                                       |
| `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `NOTIFIER_CONCURRENCY`, `STATUS_INTERVAL_MS`, `SMTP_*` | see above                                     | backend        | Starting values: admins can change these live in Admin → System without a restart.                                                                                                                                                                          |
| `SECRETS_KEY`                                                                                   | empty                                         | backend        | Optional. Encrypts AI provider keys saved from the admin console. Without it, Orbyn generates a key and keeps it in the database. Set 32 random bytes, base64 (`openssl rand -base64 32`), in production so a database dump alone cannot reveal saved keys. |
| `DATABASE_READ_URL`                                                                             | empty                                         | backend        | Optional read replica for lag-tolerant reads (lists, admin console, status). Empty means everything uses the primary. See [scalability](scalability.md).                                                                                                    |
| `DB_POOL_MAX`                                                                                   | `10`                                          | backend        | Connections each service instance keeps. Keep instances x this within PgBouncer `max_client_conn`.                                                                                                                                                          |
| `RATE_LIMIT_PER_MINUTE`                                                                         | `180`                                         | backend        | Per-instance request limit. `0` leaves limiting to the gateway.                                                                                                                                                                                             |
| `NOTIFIER_CONCURRENCY`                                                                          | `4`                                           | notifier       | Parallel reminder delivery lanes per notifier instance.                                                                                                                                                                                                     |
| `TRUST_PROXY`                                                                                   | `false`                                       | backend        | Trust `X-Forwarded-For` from the gateway. Compose sets `true`.                                                                                                                                                                                              |
| `DOCKER_DATABASE_READ_URL`                                                                      | empty                                         | compose        | Read route for the containers, e.g. `postgres://orbyn:PASSWORD@pgbouncer:6432/orbyn_read`.                                                                                                                                                                  |
| `PGBOUNCER_READ_HOST`                                                                           | empty                                         | compose        | Replica host for PgBouncer's `<db>_read` route, e.g. `postgres-replica`.                                                                                                                                                                                    |
| `SERVICE_RATE_LIMIT_PER_MINUTE`                                                                 | `1200`                                        | compose        | `RATE_LIMIT_PER_MINUTE` for the containers.                                                                                                                                                                                                                 |
| `GATEWAY_API_SERVERS`                                                                           | `api:8000`                                    | compose        | Space-separated `host:port` instances of the API; likewise `GATEWAY_AI_SERVERS`, `GATEWAY_REALTIME_SERVERS` (`realtime:8000`) and `GATEWAY_STATUS_SERVERS`.                                                                                                 |
| `GATEWAY_RESOLVER`                                                                              | `127.0.0.11`                                  | compose        | DNS server the gateway uses to re-resolve hostnames.                                                                                                                                                                                                        |
| `GATEWAY_TRUSTED_PROXIES`                                                                       | empty                                         | compose        | Address ranges of load balancers in front of the gateway, for real client addresses.                                                                                                                                                                        |
| `GATEWAY_RATE_LIMIT_EXEMPT`                                                                     | `127.0.0.1/32 192.168.65.0/24`                | compose        | Ranges never rate limited, for local load tests. Leave empty in production.                                                                                                                                                                                 |
| `API_REPLICAS`                                                                                  | `2`                                           | compose        | Copies of the API; `scripts/deploy.sh` replaces them without downtime. Likewise `AI_REPLICAS` (2), `REALTIME_REPLICAS` (2; the live streams, scaled on open connections), `STATUS_REPLICAS` (1), `NOTIFIER_REPLICAS` (1).                                   |
| `UPDATE_REPO`                                                                                   | empty                                         | backend        | `owner/repo` on GitHub for update checks in Admin → System.                                                                                                                                                                                                 |
| `UPDATE_BRANCH`                                                                                 | `main`                                        | backend        | Branch those checks compare against.                                                                                                                                                                                                                        |
| `GITHUB_TOKEN`                                                                                  | empty                                         | backend        | Read-only token for update checks on a private repository.                                                                                                                                                                                                  |
| `DEPLOY_URL`                                                                                    | deploy workflow                               | backend        | Where Admin → System links to start a deploy.                                                                                                                                                                                                               |
| `APP_URL`                                                                                       | `http://localhost:8080`                       | backend        | Where people open the web app. Every emailed link (booking confirmations, manage links, invitations, RSVP) and the calendar feed are built from it, so in production it is the public address.                                                              |
| `ALLOW_PRIVATE_WEBHOOKS`                                                                        | `false`                                       | backend        | `true` lets webhooks call private network addresses. Local development only.                                                                                                                                                                                |
| `CLOUDFLARE_TUNNEL_TOKEN`                                                                       | empty                                         | compose        | Token of a Cloudflare tunnel. Set it and start the stack with `--profile tunnel` (or `scripts/deploy.sh`, which starts it when set) to serve the app without opening a port. See [deployment](deployment.md#public-access-through-a-cloudflare-tunnel).     |
| `CLOUDFLARED_IMAGE`                                                                             | `cloudflare/cloudflared:latest`               | compose        | Pin a cloudflared release instead of following the latest image.                                                                                                                                                                                            |
| `MAIL_HOSTNAME`, `MAIL_DOMAIN`                                                                  | empty                                         | compose        | Your own mail server's name and sending domain, with `DOCKER_SMTP_HOST=mail`. See [deployment](deployment.md#sending-mail-yourself).                                                                                                                        |
| `MAIL_CONFIG`                                                                                   | `maddy.conf`                                  | compose        | `maddy.conf` delivers straight to recipients; `maddy-relay.conf` hands the last hop to `MAIL_RELAY` with `MAIL_RELAY_USER` and `MAIL_RELAY_PASSWORD`.                                                                                                       |
| `MADDY_IMAGE`                                                                                   | `foxcpp/maddy:0.9.5`                          | compose        | The mail server image.                                                                                                                                                                                                                                      |
| `BACKUP_KEEP`                                                                                   | `7`                                           | deploy script  | How many database dumps `scripts/deploy.sh` keeps in `backups/`.                                                                                                                                                                                            |

Mobile has its own `mobile/.env.example`:

| Variable                     | Description                                                              |
| ---------------------------- | ------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_URL`        | API base URL the app calls. Use your computer's LAN IP on a real device. |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS project id, required for push tokens.                                |

### AI providers

Assistant chat and automation requests enqueue a database job. The AI service
(and single-process local server) consumes up to eight jobs at once. If a
deployment runs the notifier without an AI service, set
`AI_RUNNER_IN_WORKER=true` to enable its queue consumer; the default is false.
Each claim uses a sixty-second lease, renewed while the job runs.

The AI assistant is configured only in the app, never in `.env`. Sign in as an admin and open
**Admin → AI** (on mobile: **Settings → Admin console → AI**), then:

1. **Add provider**: pick one of the built-in providers (OpenAI, Anthropic, Google Gemini, Azure
   OpenAI, OpenRouter, Groq, Mistral, Matilda (Maincode), ZenMux, opencode, LM Studio, Ollama, Together, Fireworks, Mistral, xAI, Perplexity, DeepInfra, Nebius and more) or "Other
   OpenAI-compatible", and paste its API key if it needs one.
2. **Test** it and load its models.
3. **Use for assistant** with the model you want.

Keys are encrypted before they are stored and only a masked hint is ever shown. For a local model
reached from Docker, use `http://host.docker.internal:11434/v1` (Ollama) or
`http://host.docker.internal:1234/v1` (LM Studio) as the base URL.

## 2. Run everything with Docker Compose

```bash
docker compose up -d --build
docker compose ps
```

Services started:

| Service    | Purpose                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `postgres` | PostgreSQL 17 with a persistent `postgres_data` volume.                |
| `migrate`  | One-shot container that applies `backend/migrations/*.sql` then exits. |
| `api`      | The HTTP API. Waits for migrations to finish. Has a health check.      |
| `worker`   | Schedules and delivers reminders (in-app, email, push).                |
| `desktop`  | internal `desktop:8080`                                                | Web app files; served through the gateway's web port |
| `mailpit`  | Local SMTP sink with a web inbox at <http://localhost:8025>.           |

Useful commands:

```bash
docker compose logs -f api worker      # follow logs
docker compose up -d --build api worker # rebuild after backend changes
docker compose down                     # stop, keep data
docker compose down -v                  # stop and delete the database volume
```

## Services and ports

`docker compose up -d --build` starts the backend as separate services behind a gateway:

| Service            | Reached at                                          | Notes                                                                    |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `desktop`          | <http://localhost:8080>                             | Web app; `/api` goes to the gateway                                      |
| `gateway`          | <http://localhost:8080> and <http://localhost:8008> | The only service with host ports: the web app (with `/api`) and the API  |
| `api`              | internal `api:8000`                                 | Planner API                                                              |
| `ai`               | internal `ai:8000`                                  | Assistant and AI provider settings                                       |
| `status`           | internal `status:8000`                              | Status probes; public report at `/status`                                |
| `notifier`         | no port                                             | Reminder delivery                                                        |
| `files`            | internal `files:8000`                               | File store for imports; uploads arrive through the gateway's `/files/u/` |
| `converter`        | no port                                             | Turns imported PDFs, Word files and photos into pages                    |
| `formula`          | internal `formula:8000`                             | Equations on scanned pages (`formula` profile; optional)                 |
| `ocr`              | internal `ocr:8000`                                 | Heavy OCR model (`ocr` profile; off by default, big servers only)        |
| `postgres`         | `localhost:5433`                                    | Database                                                                 |
| `pgbouncer`        | internal `pgbouncer:6432`                           | Connection pooler every service connects through                         |
| `postgres-replica` | `localhost:5434`                                    | Streaming read replica (`replica` profile, optional)                     |
| `mailpit`          | <http://localhost:8025>                             | Local email inbox                                                        |

To spread services across machines, add a read replica, or run on Kubernetes, see
[scalability.md](scalability.md) and [deploy/k8s](../deploy/k8s/README.md).

Check them with `docker compose ps`, and the public status report with
`curl localhost:8008/status`. The web app shows it at <http://localhost:8080/status>.

## 3. Run locally for development

Start only the infrastructure in Docker:

```bash
docker compose up -d postgres mailpit
```

Install, build the shared packages, and migrate. The default `.env.example` `DATABASE_URL`
already points at the Compose Postgres on port 5433:

```bash
npm install
npm run build:packages
npm run migrate
```

`@orbyn/core` and `@orbyn/api-client` are consumed from their compiled `dist/` folders, so run
`npm run build:packages` after cloning and whenever you edit them (or keep `npm run dev:packages`
running to rebuild on change).

Run the API with hot reload and the web app. `dev:api` runs every backend module in one process,
which is simplest for development; `npm run dev:api -w backend`, `dev:ai -w backend`,
`dev:status -w backend`, and `dev:notifier -w backend` run the services one by one:

```bash
PORT=8008 npm run dev:api  # http://localhost:8008
npm run dev:web            # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:8008` by default. If you choose another
local API port, start the web app with `API_PROXY_URL=http://localhost:YOUR_PORT npm run dev:web`.
`API_PORT` controls Docker port publishing only; `PORT` controls a local API process. Compose
fixes the internal API port at 8000, so changing your local `PORT` does not break its health check.

Run the worker:

```bash
npm run build -w backend
npm run worker -w backend
```

Importing PDF and Word files into Docs needs `FILES_SECRET` in `.env` (any long string locally).
In single-process mode the file store is part of `dev:api`, so set `FILES_URL` to that API's
address (for example `http://localhost:8008`). Then run the converter:

```bash
npm run dev:converter -w backend
```

Scanned pages and photos are read with Tesseract, which the converter runs directly. For that
locally, install it with `pdftoppm` (`brew install tesseract poppler` on macOS, or
`apt install tesseract-ocr poppler-utils`). Without them, only Word files and PDFs with real text
import.

Never build the `formula` or heavy `ocr` image on a development machine. To try the heavy model's
path, run the stand-in, which answers like it without the model, and point the converter at it:

```bash
node scripts/ocr-standin.mjs
```

```bash
OCR_URL=http://127.0.0.1:8098 npm run dev:converter -w backend
```

### Electron desktop shell

```bash
npm run build -w desktop
npm run desktop -w desktop
```

When loaded from `file://`, the app calls `http://localhost:8008` unless `VITE_API_URL` was set at
build time. To produce installers:

```bash
npm run package -w desktop   # output in desktop/release/
```

The installed app registers the `orbyn://` scheme (`build.protocols` in `desktop/package.json`) and
runs as one copy: `orbyn://task/<id>`, `doc/<id>`, `project/<id>`, `today`, `review/<id>`,
`search?q=` and `add?text=` open in it as the web app's `/app/…` links do (a link that adds opens ⌘K
filled in, to confirm). `desktop/preload.cjs` is the only bridge to the page. Copied links point at
`VITE_WEB_URL` (else `VITE_API_URL` without `/api`, else an `orbyn://` link).

## 4. Tests

Tests run against a separate, disposable database, never the one the app uses. Start it and run
the suite:

```bash
docker compose --profile test up -d postgres-test
TEST_DATABASE_URL=postgres://orbyn:orbyn-test@localhost:55434/orbyn_test npm test
```

| Safeguard          | What it prevents                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Separate server    | The `postgres-test` container is its own server on port 55434, with data kept in memory                                       |
| Separate setting   | Tests read only `TEST_DATABASE_URL`; `DATABASE_URL` is ignored                                                                |
| Name check         | The database name must end in `_test`                                                                                         |
| Server-side marker | The database must have `orbyn.environment = 'test'`, set by `backend/tests/db/init-test-db.sql` when the container is created |

If the suite refuses to run, it names the check that failed. Never add the marker to a database
that holds real data. CI runs its own throwaway PostgreSQL and marks it the same way.

## 5. Working in the monorepo

- Add shared types, validation, or pure helpers to `packages/core/src` and export them from its
  `index.ts`. Both the backend and the apps import from `@orbyn/core`.
- Add new API endpoints as a method on `OrbynClient` in `packages/api-client/src/client.ts` so
  web and mobile stay in sync.
- Backend features are folders under `backend/src/modules/<name>/` with a `routes.ts` (HTTP) and,
  when there is logic worth sharing, a `service.ts`. Register new route plugins in
  `backend/src/app.ts`.
- Web features are folders under `desktop/src/features/<name>/`; mobile screens live in
  `mobile/src/screens/`. Reusable UI goes in each app's `components/`.
- `npm install` at the root installs every workspace, including mobile. npm 11.4.0 creates broken
  scoped workspace symlinks; use npm 10.x or 11.5+ (see the README).

## 6. Admins

The first account registered on a fresh database becomes a system admin. Any email in
`ADMIN_EMAILS` is also made an admin when it registers or signs in. To promote an existing account
on a database that already has users:

```bash
npm run admin:grant -w backend -- someone@example.com
# or, with Docker
docker compose run --rm api node backend/dist/grant-admin.js someone@example.com
```

Admins can then promote others from the Admin console in the web or mobile app.

## 6a. Email confirmation

Once a mail server is configured (Admin → System, or `SMTP_*`), new members must confirm their
email before they can use the app: they get a confirmation link on sign-up, and until they follow
it the app holds them at a "confirm your email" screen with a resend button. The first admin and
any `ADMIN_EMAILS` address are created already confirmed, so setup is never blocked, and with no
mail server every account is usable immediately. An admin can confirm anyone by hand from the Admin
console (the **Verify** button next to an unconfirmed address) if a link is lost. Confirmation and
password-reset links point at `APP_URL`, so set it to the address people actually open.

## 7. Smoke test

`npm run smoke -w backend` calls every API endpoint through the shared client against a running
server and prints a pass or fail line for each: auth, profile, items, teams and membership rules,
devices, reminders delivered by the worker, the AI assistant, and the admin console. Accounts it
creates are deleted at the end.

```bash
SMOKE_API_URL=http://localhost:8008 \
SMOKE_ADMIN_EMAIL=admin@example.com SMOKE_ADMIN_PASSWORD='the admin password' \
npm run smoke -w backend
```

The admin email must already be an admin, or be listed in the server's `ADMIN_EMAILS` so the script
can register it. The worker must be running for the reminder check. When the server has no AI
model configured, the AI checks report that and pass; set `SMOKE_AI=skip` to skip them entirely.

## 8. Formatting

```bash
npm run format        # write
npm run format:check  # verify (CI runs this)
```
