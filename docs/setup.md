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

| Variable            | Default                                       | Used by        | Description                                                                                           |
| ------------------- | --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `orbyn`                                       | compose        | Database role created in the Postgres container.                                                      |
| `POSTGRES_PASSWORD` | required                                      | compose        | Database password. Compose refuses to start without it.                                               |
| `POSTGRES_DB`       | `orbyn`                                       | compose        | Database name.                                                                                        |
| `POSTGRES_PORT`     | `5433`                                        | compose        | Host port the Postgres container is published on (loopback only).                                     |
| `DATABASE_URL`      | `postgres://orbyn:orbyn@localhost:5432/orbyn` | backend        | Connection string for local runs. Inside Compose it is derived automatically.                         |
| `PORT`              | `8000`                                        | backend        | Port the API listens on inside its container or local process.                                        |
| `API_PORT`          | `8008`                                        | compose        | Host port the API is published on.                                                                    |
| `API_BIND`          | `127.0.0.1`                                   | compose        | Host interface for the API port. Set `0.0.0.0` to expose on the LAN (needed for a physical phone).    |
| `WEB_PORT`          | `8080`                                        | compose        | Host port for the web app.                                                                            |
| `CORS_ORIGINS`      | `http://localhost:5173,http://localhost:8080` | backend        | Comma-separated allowed browser origins.                                                              |
| `AI_BASE_URL`       | `https://api.openai.com/v1`                   | backend        | Base URL of any OpenAI-compatible chat completions API.                                               |
| `AI_API_KEY`        | empty                                         | backend        | Bearer token for the provider. Leave empty for local providers that need none.                        |
| `AI_MODEL`          | empty                                         | backend        | Model name. The assistant is disabled (HTTP 503) until this is set.                                   |
| `SMTP_HOST`         | `localhost`                                   | backend/worker | SMTP server. Empty disables email reminders. Compose overrides it to `mailpit`.                       |
| `SMTP_PORT`         | `1025`                                        | worker         | SMTP port.                                                                                            |
| `SMTP_USER`         | empty                                         | worker         | SMTP username. Empty means no authentication.                                                         |
| `SMTP_PASSWORD`     | empty                                         | worker         | SMTP password.                                                                                        |
| `SMTP_SECURE`       | `false`                                       | worker         | `true` for implicit TLS (port 465).                                                                   |
| `SMTP_FROM`         | `Orbyn <reminders@orbyn.local>`               | worker         | Sender shown on reminder emails.                                                                      |
| `DOCKER_SMTP_HOST`  | `mailpit`                                     | compose        | SMTP host used by the containers. Point at a real relay in production.                                |
| `EXPO_ACCESS_TOKEN` | empty                                         | worker         | Optional Expo access token for push delivery with enhanced security enabled.                          |
| `ADMIN_EMAILS`      | empty                                         | backend        | Comma-separated emails that are always system admins. The first account to register is also an admin. |

Mobile has its own `mobile/.env.example`:

| Variable                     | Description                                                              |
| ---------------------------- | ------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_URL`        | API base URL the app calls. Use your computer's LAN IP on a real device. |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS project id, required for push tokens.                                |

### AI provider examples

```bash
# OpenAI
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4.1-mini

# OpenRouter
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=sk-or-...
AI_MODEL=anthropic/claude-sonnet-4

# Ollama on the host machine, reached from Docker
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_API_KEY=
AI_MODEL=llama3.1
```

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
| `desktop`  | The web app served by nginx, proxying `/api/` to the API.              |
| `mailpit`  | Local SMTP sink with a web inbox at <http://localhost:8025>.           |

Useful commands:

```bash
docker compose logs -f api worker      # follow logs
docker compose up -d --build api worker # rebuild after backend changes
docker compose down                     # stop, keep data
docker compose down -v                  # stop and delete the database volume
```

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

Run the API with hot reload and the web app:

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

## 4. Tests

See the [README](../README.md#tests). The suite needs a database literally named `orbyn_test`.

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
