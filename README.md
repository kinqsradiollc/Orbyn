# Orbyn

Plan your day. Keep work moving.

Orbyn brings tasks, calendars, projects, documents and an AI assistant into one
workspace, with a web app, an Electron desktop client and an Expo mobile app.
It is an open-source project created by **Anh Dang**, a University of Melbourne student.
See [creator and contact](#creator-and-contact) and [contributing](#contributing).

For source navigation, see the [cross-stack code map](docs/architecture.md#find-the-code).

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

Accounts are admins or members. Public registration creates members, including
addresses listed in `ADMIN_EMAILS`. Grant admin access explicitly with the
server-side `admin:grant` command. Admins manage accounts, providers, usage, storage
and audit records. Team roles are owner, admin, member and viewer; team permissions also
bound connected agents. See [access control](docs/architecture.md#access-control).

## Repository layout

Orbyn is a TypeScript npm workspaces monorepo.

| Path                      | Owner                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| `packages/core/`          | Shared Zod schemas, domain types and planner helpers                         |
| `packages/api-client/`    | Typed API client used by web/desktop and mobile                              |
| `backend/`                | Fastify API, PostgreSQL migrations, provider adapters and service workers    |
| `desktop/`                | React/Vite web app and Electron packaging                                    |
| `web/`                    | Rebuilt web client, in progress; see [the rebuild](docs/work/web-rebuild.md) |
| `mobile/`                 | Expo/React Native client for iOS and Android                                 |
| `gateway/`, `pgbouncer/`  | nginx routing and database connection pooling                                |
| `deploy/`, `compose.yaml` | Service definitions, isolation profiles and deployment tooling               |
| `docs/`                   | Product, setup, architecture and operational references                      |

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

## Development demo accounts and data

Use the [local demo setup](docs/local-demo.md) to populate a verified local database.
`npm run dev:seed` previews the setup; `--apply` creates the fixtures. The script
preserves existing data and requires a database-level development marker.

| Account                  | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `admin@orbyn.local`      | Admin with a rich workspace                         |
| `member@orbyn.local`     | Personal and team work                              |
| `empty@orbyn.local`      | Empty workspace                                     |
| `new@orbyn.local`        | First-run onboarding                                |
| `agent-demo@orbyn.local` | Isolated live agent checks; starts empty and paused |

All five start with the public, local-only password `Orbyn-Demo-2026!`.
Reruns preserve passwords, roles and edits. Agent history is labeled sample data;
no model is run and no provider is configured by the seed.

## Contributing

Start with the [engineering setup](CONTRIBUTING.md#engineering-setup) for contributors
and maintainers. Coding agents read [AGENTS.md](AGENTS.md).

Contribute through the [Orbyn Engineering workspace](https://github.com/kinqsradio/orbyn-fullstack-skills),
with this checkout nested under its ignored `repo/` directory. Engineering policies
and skills live in that outer workspace; no copied installation or skills pin is
maintained here. See [CONTRIBUTING](CONTRIBUTING.md) for the layout and adoption
boundary, [development](docs/development.md) for application commands,
[operations](docs/operations.md) for service ownership and
[design](docs/design.md) for product conventions.

## License

Orbyn's original application code is available under the [MIT License](LICENSE).
Copyright © 2026 Anh Dang. Third-party dependencies, imported tools and adapted helpers retain their own
license and attribution notices under `tools/` and `scripts/licenses/`;
see [third-party notices](tools/THIRD_PARTY_NOTICES.md).

## Creator and contact

Orbyn is created by **Anh Dang**, a **University of Melbourne student**.

- [LinkedIn — Anh Dang](https://www.linkedin.com/in/tran-duc-anh-dang-392b7a231/)
- Personal: [anhdang.contact@gmail.com](mailto:anhdang.contact@gmail.com)
- Orbyn: [anhdang@orbyn.dev](mailto:anhdang@orbyn.dev)

Follow the project or get in touch about Orbyn, its engineering or collaboration.

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
