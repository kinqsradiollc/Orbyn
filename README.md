# Orbyn

Plan your day. Keep work moving.

Orbyn brings tasks, calendars, projects, documents and an AI assistant into one
workspace, with a web app, an Electron desktop client and an Expo mobile app.

## What you can do

- **Plan work:** manage tasks, deadlines, recurring work, calendar events and
  focus sessions. Organize projects, share team work and review your day.
- **Write and study:** keep pages and notes, import PDFs, Word documents and
  photos, and make study cards. Docs provides Note, Markdown and LaTeX editing,
  local previews and explicit PDF export.
- **Work with Orbyn:** use personal and project chats, delegate Background work
  or opt into Overnight work. Orbyn's own orchestration runs durable jobs with
  checkpoints, questions, budgets and review controls. See [Assistant](docs/assistant.md).
- **Connect other assistants:** give MCP clients scoped access to your planner
  through OAuth or agent keys. Permissions and team access are checked on each
  operation. See [MCP](docs/mcp.md).
- **Publish updates:** admins can prepare release notes and images, request AI
  copy suggestions and approve posts for a LinkedIn company Page. LinkedIn
  requires its own connection and permissions. See [Admin Publishing](docs/admin-publishing.md).

AI providers and models are configured in **Admin → AI**. Managed provider keys
are encrypted at rest. Assistant actions follow the person's granted access and
review rules; unattended deletion, outside messages and publishing require Review.
The unified conversation timeline is implemented behind
`ASSISTANT_CONVERSATION_ENABLED=false` by default. Enable it explicitly across
services after the deployment checks; the source tree alone does not establish
that a hosted instance has it enabled.

## Accounts and teams

Accounts are admins or members. The first account and addresses in `ADMIN_EMAILS`
receive admin access. Admins manage accounts, providers, usage, storage and audit
records. Team roles are owner, admin, member and viewer; team permissions also
bound connected agents. See [access control](docs/architecture.md#access-control).

## Repository layout

Orbyn is a TypeScript npm workspaces monorepo.

| Path                      | Owner                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| `packages/core/`          | Shared Zod schemas, domain types and planner helpers                      |
| `packages/api-client/`    | Typed API client used by web/desktop and mobile                           |
| `backend/`                | Fastify API, PostgreSQL migrations, provider adapters and service workers |
| `desktop/`                | React/Vite web app and Electron packaging                                 |
| `mobile/`                 | Expo/React Native client for iOS and Android                              |
| `gateway/`, `pgbouncer/`  | nginx routing and database connection pooling                             |
| `deploy/`, `compose.yaml` | Service definitions, isolation profiles and deployment tooling            |
| `docs/`                   | Product, setup, architecture and operational references                   |
| `skills/`                 | Pinned shared engineering skills; product policy stays in this repository |

Clients use `@orbyn/api-client` and `@orbyn/core`; the API client depends on core.
Shared packages do not import application code. Backend services share an image
but have separate entry points for HTTP, reminders, Background, Overnight, file
conversion and document rendering. See [architecture](docs/architecture.md) and
[scaling constraints](docs/scalability.md).

## Quick start (Docker)

```bash
cp .env.example .env
printf '\nDOC_PDF_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
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
choose its model. Provider credentials are managed there; service URLs, encryption keys and
rollout flags still belong in the server environment. See [setup](docs/setup.md#ai-providers).

## Quick start (local development)

```bash
cp .env.example .env
printf '\nDOC_PDF_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
docker compose up -d postgres mailpit
npm ci
npm run build:packages        # compile the shared packages first
npm run migrate
PORT=8008 npm run dev:api     # API on http://localhost:8008
npm run dev:web               # web app on http://localhost:5173 (proxies /api to the backend)
```

The local API combines HTTP modules. Run the notifier separately for reminders:

```bash
npm run build -w backend
npm run start:notifier -w backend
```

Background and Overnight need their own processes even in local development:

```bash
npm run start:assistant-background -w backend
npm run start:assistant-overnight -w backend
```

Run each process in its own terminal. Import conversion and the private PDF/LaTeX
renderers also need their services; the full Compose stack supplies them.
For mobile, see [docs/mobile.md](docs/mobile.md).

## Development workflow

[AGENTS.md](AGENTS.md) is the shared repository policy for Codex and Claude Code.
Use [orbyn-workflow](skills/orbyn-workflow/SKILL.md) for substantial engineering
work and [Orbyn roles](docs/agents/roles.md) for scoped assignments. The lead
delegates substantial execution, reviews the actual artifacts and performs
authorized verification. Host model/effort settings come from the shared
[registry](docs/agents/models.json) under [model policy](docs/agents/model-policy.md).
Native children and explicitly requested project chats follow
[coordination](docs/agents/coordination.md); new branches follow
[branch naming](docs/agents/development.md#branch-naming).

## Documentation

Start at the [documentation index](docs/README.md) for current guides and their
owning source. The old ADR queue and checkpoint reports have been retired.

- [Setup guide](docs/setup.md) - environment configuration, Docker and local workflows
- [Architecture](docs/architecture.md) - services, permissions, documents and durable assistant execution
- [API reference](docs/api.md) - HTTP contracts and links to owning routes
- [Mobile guide](docs/mobile.md) - running on a device, push notifications, EAS builds
- [Deployment](docs/deployment.md) - go-live checklist, DNS records, Cloudflare tunnel, your own mail server, updating without downtime
- [Scalability](docs/scalability.md) - multi-host topology, shared-storage requirements and historical load evidence
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
| `npm test`                    | Default backend `.test.ts` suite (guarded test DB where needed)                          |
| `npm run build`               | Build packages, backend, and the web bundle                                              |
| `npm run format`              | Format the authored paths selected by the root script                                    |
| `npm run desktop -w desktop`  | Launch the Electron shell against the built web app                                      |
| `npm run package -w desktop`  | Produce installers (dmg, nsis, AppImage)                                                 |
| `./scripts/deploy.sh`         | Install/update a server: preflight, back up, build, migrate and roll out                 |
| `./scripts/deploy.sh --check` | Show what a deploy would do and check `.env`, changing nothing                           |
| `./scripts/mail-local.sh`     | Start, test and stop a local stack for the self-hosted mail server                       |

Use the Node/npm versions required by `package.json` (Node 22+ and npm 10+).
`npm ci` installs the committed workspace lockfile. If a shared package cannot be
resolved, check workspace installation and run `npm run build:packages` before
starting a client or service.

## Tests

Run these when testing is in scope. The default backend script does not include
separate `.integration.ts` lanes; inspect the owning scripts for the requested
contract. See [verification](docs/verification.md).

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
