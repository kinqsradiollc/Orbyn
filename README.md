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

To enable the AI assistant, set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` in `.env` and run
`docker compose up -d` again. Use a provider with an OpenAI-compatible `/chat/completions` endpoint and bearer authentication
(or no authentication for a local server). Set its exact model or deployment name. Providers
that require a different authentication header or URL shape need a compatible gateway.

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
- [Deployment](docs/deployment.md) - production checklist

## Scripts

All commands run from the repository root.

| Command                      | Purpose                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `npm install`                | Install every workspace (see the npm note below)                                         |
| `npm run build:packages`     | Compile `@orbyn/core` and `@orbyn/api-client` to `dist/` (required before anything else) |
| `npm run dev:packages`       | Rebuild the shared packages on change                                                    |
| `npm run dev:api`            | API with hot reload on port 8000                                                         |
| `npm run dev:web`            | Web app dev server on port 5173                                                          |
| `npm run dev:mobile`         | Expo dev server                                                                          |
| `npm run typecheck`          | Build packages, then type-check backend, desktop, and mobile                             |
| `npm test`                   | Backend integration tests (needs an `orbyn_test` database)                               |
| `npm run build`              | Build packages, backend, and the web bundle                                              |
| `npm run format`             | Format everything with Prettier                                                          |
| `npm run desktop -w desktop` | Launch the Electron shell against the built web app                                      |
| `npm run package -w desktop` | Produce installers (dmg, nsis, AppImage)                                                 |

> **npm note.** npm 11.4.0 has a bug that creates broken symlinks for scoped workspace packages
> (`node_modules/@orbyn/*`). Use npm 10.x (bundled with Node 22) or npm 11.5+. If
> `@orbyn/core` cannot be resolved after `npm install`, run `rm -rf node_modules/@orbyn && npx npm@latest install`.

## Tests

The backend suite uses a real PostgreSQL database and refuses to run against anything not named
`orbyn_test`:

```bash
docker run -d --name orbyn-test-postgres -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=orbyn -e POSTGRES_PASSWORD=orbyn-test -e POSTGRES_DB=orbyn_test postgres:17-alpine
DATABASE_URL=postgres://orbyn:orbyn-test@127.0.0.1:55432/orbyn_test npm test
```
