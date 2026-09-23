# Orbyn

**From orbit.** Your tasks, deadlines, events, and life revolve around one intelligent system.

Orbyn is a planner with a web/desktop app, a native mobile app, and a separate backend. An AI
assistant (any OpenAI-compatible provider) can summarize your planner and propose creates,
updates, and deletes that you approve before they are saved. A background worker sends in-app,
email, and mobile push reminders as deadlines approach.

## Roles and teams

Accounts are either **admins** or **members**. The first account, and any email in `ADMIN_EMAILS`,
is an admin. Admins get an admin console in the web and mobile apps to see usage, manage accounts
and roles, disable or delete users, manage any team, and read the audit log. They never see the
contents of other people's items.

Anyone can create a **team** and share tasks and events with it. Team roles are owner, admin,
member, and viewer. Every team member gets the reminders for team items. See
[architecture](docs/architecture.md#access-control) for the full permission matrix.

## Services and status

The backend runs as separate services (API, AI assistant, reminders, status, and a file store
and converter that turn imported PDFs and Word files into pages) behind an nginx gateway. A public status page shows uptime for each part of Orbyn. Admins connect AI providers
such as OpenAI, Anthropic, Gemini, Azure OpenAI, OpenRouter, Groq, LM Studio, or Ollama from the
admin console; keys are stored encrypted. See [architecture](docs/architecture.md#services).

Every service is stateless and can run as many instances as needed, on one host or many machines,
behind a load balancer. PgBouncer pools database connections, and lag-tolerant reads can go to
read replicas. See [scalability](docs/scalability.md) for the topology, measured load test results
and a capacity plan for a million users.

## Repository layout

Orbyn is an npm workspaces monorepo. Shared code lives in `packages/`, and each deployable app
lives in its own top-level folder.

| Path                   | Package             | What it is                                                                                  |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `packages/core/`       | `@orbyn/core`       | Shared domain layer: zod schemas, TypeScript types, date and planner helpers, `HttpError`.  |
| `packages/api-client/` | `@orbyn/api-client` | Typed fetch client for the API, used by both the web/desktop and mobile apps.               |
| `backend/`             | `@orbyn/backend`    | Fastify + PostgreSQL API, reminder worker, migrations, Dockerfile. Organised by `modules/`. |
| `desktop/`             | `@orbyn/desktop`    | React + Vite web app, also packaged as an Electron desktop app. Organised by `features/`.   |
| `mobile/`              | `@orbyn/mobile`     | Expo (React Native) app for iOS and Android. Organised by `screens/`.                       |
| `docs/`                |                     | Setup, architecture, API reference, deployment, and mobile guides.                          |
| `gateway/`             |                     | nginx gateway template, rendered from environment settings at start.                        |
| `pgbouncer/`           |                     | Connection pooler image with primary and read-replica routes.                               |
| `ocr/`                 |                     | OCR service for imported scans (Unlimited-OCR on CPU); Compose profile `ocr`.               |
| `deploy/`              |                     | Kubernetes manifests (`deploy/k8s`) and Postgres replication scripts.                       |

```
orbyn/
├── packages/
│   ├── core/            schemas, types, dates, planner helpers   (no runtime deps besides zod)
│   └── api-client/      OrbynClient                               (depends on core)
├── backend/
│   └── src/
│       ├── config/      env loading and validation
│       ├── db/          pool, transactions, migration runner
│       ├── lib/         auth helpers, route params
│       ├── modules/     auth, users, items, devices, notifications, ai  (routes + services)
│       ├── worker/      scheduler, delivery, channels/email, channels/push
│       ├── app.ts       composes modules into the Fastify app
│       ├── server.ts    API entry
│       ├── worker.ts    worker entry
│       └── migrate.ts   migration entry
├── desktop/src/         app/, features/, components/, hooks/, lib/, styles/
├── mobile/src/          app/, screens/, components/, hooks/, lib/, theme/
├── compose.yaml         postgres, migrate, api, worker, web, mailpit
└── .env.example
```

Dependency direction is strictly one way: apps depend on `@orbyn/api-client` and `@orbyn/core`;
`@orbyn/api-client` depends on `@orbyn/core`; `@orbyn/core` depends on nothing in the repo.

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d --build
```

Then open:

| Service        | URL                     |
| -------------- | ----------------------- |
| Web app        | <http://localhost:8080> |
| API            | <http://localhost:8008> |
| Mailpit (mail) | <http://localhost:8025> |

Create an account in the web app, add a task with a due date, and a reminder lands in Mailpit
and in the in-app notification tray when the reminder window opens.

To enable the AI assistant, sign in as an admin and open **Admin → AI** to add a provider and
choose its model. Nothing AI-related goes in `.env`; see [setup](docs/setup.md#ai-providers).

## Quick start (local development)

```bash
cp .env.example .env
docker compose up -d postgres mailpit
npm install
npm run build:packages        # compile the shared packages first
npm run migrate
PORT=8008 npm run dev:api     # API on http://localhost:8008
npm run dev:web               # web app on http://localhost:5173 (proxies /api to the backend)
```

For the reminder worker in development:

```bash
npm run build -w backend && npm run worker -w backend
```

For mobile, see [docs/mobile.md](docs/mobile.md).

## Documentation

- [Setup guide](docs/setup.md) - every environment variable, Docker and local workflows
- [Architecture](docs/architecture.md) - services, data model, reminder pipeline, AI proposal flow
- [API reference](docs/api.md) - all HTTP endpoints
- [Mobile guide](docs/mobile.md) - running on a device, push notifications, EAS builds
- [Deployment](docs/deployment.md) - go-live checklist, DNS records, Cloudflare tunnel, your own mail server, updating without downtime
- [Scalability](docs/scalability.md) - multi-host topology, load balancer, replicas, capacity plan
- [Kubernetes](deploy/k8s/README.md) - manifests with autoscaling, ingress and network policies

## Scripts

All commands run from the repository root.

| Command                       | Purpose                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `npm install`                 | Install every workspace (see the npm note below)                                         |
| `npm run build:packages`      | Compile `@orbyn/core` and `@orbyn/api-client` to `dist/` (required before anything else) |
| `npm run dev:packages`        | Rebuild the shared packages on change                                                    |
| `npm run dev:api`             | API with hot reload on port 8000                                                         |
| `npm run dev:web`             | Web app dev server on port 5173                                                          |
| `npm run dev:mobile`          | Expo dev server                                                                          |
| `npm run typecheck`           | Build packages, then type-check backend, desktop, and mobile                             |
| `npm test`                    | Backend integration tests (needs an `orbyn_test` database)                               |
| `npm run build`               | Build packages, backend, and the web bundle                                              |
| `npm run format`              | Format everything with Prettier                                                          |
| `npm run desktop -w desktop`  | Launch the Electron shell against the built web app                                      |
| `npm run package -w desktop`  | Produce installers (dmg, nsis, AppImage)                                                 |
| `./scripts/deploy.sh`         | Install or update a server without downtime: pull, back up, build, migrate, roll out     |
| `./scripts/deploy.sh --check` | Show what a deploy would do and check `.env`, changing nothing                           |
| `./scripts/mail-local.sh`     | Start, test and stop a local stack for the self-hosted mail server                       |

> **npm note.** npm 11.4.0 has a bug that creates broken symlinks for scoped workspace packages
> (`node_modules/@orbyn/*`). Use npm 10.x (bundled with Node 22) or npm 11.5+. If
> `@orbyn/core` cannot be resolved after `npm install`, run `rm -rf node_modules/@orbyn && npx npm@latest install`.

## Tests

The backend tests use their own throwaway PostgreSQL, separate from the app's database:

```bash
docker compose --profile test up -d postgres-test
TEST_DATABASE_URL=postgres://orbyn:orbyn-test@localhost:55434/orbyn_test npm test
```

`TEST_DATABASE_URL` can also live in `.env`. Three safeguards keep tests away from real data:

- Tests read only `TEST_DATABASE_URL`, never `DATABASE_URL`.
- The database name must end in `_test`.
- The database must carry the marker `orbyn.environment = 'test'`, which the test container sets when
  it is created. Development and production databases never have it, so the suite refuses to run
  against them even if the URL is wrong.

The test database keeps its data in memory; stopping it discards everything.
