# Developing Orbyn

Use the [engineering workspace](../CONTRIBUTING.md) for development policy and
skills. This guide records application-specific facts. Check current manifests
and owning modules before choosing commands or dependencies.

## Stack and module ownership

| Layer               | Stack and source                                                                  |
| ------------------- | --------------------------------------------------------------------------------- |
| Shared domain       | TypeScript and Zod in `packages/core`                                             |
| Transport           | TypeScript fetch client in `packages/api-client`                                  |
| Web and desktop     | React, Vite and Electron in `desktop`                                             |
| Mobile              | Expo and React Native in `mobile`                                                 |
| API and workers     | Fastify, TypeScript and PostgreSQL in `backend`                                   |
| Assistant           | Repository-owned orchestration in `backend/src/modules/ai/` and service workers   |
| Deployment          | Compose, nginx, PgBouncer and optional Kubernetes in `compose.yaml` and `deploy/` |
| Supporting services | Python OCR, SQL migrations and shell deployment helpers                           |

For feature paths across backend, web, mobile and shared code, start with the
[code map](architecture.md#find-the-code). Both clients group feature-specific
screens, hooks and helpers in `src/features/`; app shell and platform infrastructure
retain separate owners. Documents are subdivided by editor, source, library,
collaboration, metadata and history.

For source moves, rebase actual import specifiers and inventoried asset/path
references. Runtime strings such as decimal separators, hostname delimiters and
relative paths inside imported document content are data, not module specifiers.
Check moved expressions as well as compiler/module resolution.

Shared packages do not import application code. Clients consume `@orbyn/core`
and `@orbyn/api-client`; backend authority checks remain at the effect boundary.
Shared schemas belong in core and transport in api-client. API errors, optimistic
concurrency, transactions, cancellation and resource ownership are part of those
contracts. See [architecture](architecture.md) and [API](api.md).

Current TypeScript uses double quotes, kebab-case modules and PascalCase
components/types. Match neighboring code and repository Prettier. Environment
changes need matching `.env.example` templates and service bindings. Client
`VITE_*` and `EXPO_PUBLIC_*` values are public. The existing template check is
`node scripts/check-env-examples.mjs`.

## Local commands

Root `package.json` requires Node 22+ and npm 10+. Build shared packages before
commands that consume their exports. There is no root `npm run lint`.

| Purpose                          | Command                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Install committed dependencies   | `npm ci`                                                                                 |
| Build shared packages            | `npm run build:packages`                                                                 |
| Combined development HTTP server | `PORT=8008 npm run dev:api`                                                              |
| Web development                  | `API_PROXY_URL=http://127.0.0.1:8008 npm run dev -w desktop -- --port 5174`              |
| Expo web renderer                | `EXPO_PUBLIC_API_URL=http://127.0.0.1:8008 npm run start -w mobile -- --web --port 8083` |
| Workspace type checks            | `npm run typecheck`                                                                      |
| Backend default suite            | `npm test`                                                                               |
| Production backend/web build     | `npm run build`                                                                          |
| Repository formatting check      | `npm run format:check`                                                                   |

The ports are examples; preserve running services and their owners. The combined
HTTP server does not start all workers or private renderers. See [setup](setup.md)
and [Assistant](assistant.md) for the separate Background, Overnight, notifier and
conversion processes.

Database tests use `TEST_DATABASE_URL`, an `_test` database and the
`orbyn.environment='test'` marker. Never substitute a normal user's database.
The default backend suite selects `tests/*.test.ts`, not every integration file.
See [test setup](setup.md#4-tests) and [verification](verification.md). Application
checks do not qualify vendored REA engines or live external providers.

## Client read caching

`OrbynClient` coalesces concurrent ordinary GETs by token, path and mutation
generation. Each caller receives its own parsed value and can cancel independently;
the transport stops when its last caller leaves. Completed reads are revalidated
with server ETags, rather than kept fresh for a client-selected time window.
Fresh reads, custom-header representations and requests with bodies bypass the
ordinary validator cache; `no-store` and `Vary: *` responses are not retained.

Both clients advance the read generation before dispatching live change events,
including reconnect catch-up. A refresh after an external change must not join a
read started before it. Account and view owners still reject stale completions;
transport sharing does not replace their session or request guards. Hashed web
assets cache successful responses for a year; missing or failed assets use
`no-store` so a deployment race cannot become a persistent cached failure.

## Project-owned CI and deployment decisions

[CI scope policy](../.github/ci-scope.json) is interpreted by
[`scripts/ci_scope.py`](../scripts/ci_scope.py). Product Markdown docs and license
changes use the docs lane. CI definitions, the classifier, unknown paths and
application changes require all five application jobs. Manual CI dispatch forces
the full lane. The retired copied-skill installation has no separate lane or
upstream-pin check.

`Select CI scope` and `CI result` run for every candidate. Failed or missing
classification, failed/cancelled selected jobs and unexpected skips cannot pass
the gate. Intentional docs-lane skips are not application test passes. Required
branch statuses are a repository setting; YAML does not configure them.

The selection job also runs `python3 scripts/check-code-organization.py`. This
checks retired source directories, literal relative TypeScript imports and
dependency directions between applications and shared packages. Its disposable
positive/negative fixtures run with the existing `.github/tests` suite. It does
not resolve computed runtime imports or establish native behavior.

[`scripts/check-tool-sources.py`](../scripts/check-tool-sources.py) verifies
retained snapshot hashes, executable bits and gitlink pins in the selection job.
The indexed-path boundary check rejects recognized retired installation control
files and force-added raw research, without inspecting or deleting untracked
private work. Project-owned instructions, settings and local skills are allowed;
filenames and matching skill names do not establish copied ownership. It also requires
the root research ignore rules. The CI-policy, safe-server-preflight, boundary
and source-integrity fixtures run with
`python3 -m unittest discover -s .github/tests -v`. They use disposable repositories
and do not execute upstream engines. The adapted CI helper retains its
[MIT notice](../scripts/licenses/ci-scope-MIT.txt).

Deployment is separate. With `AUTO_DEPLOY` enabled, automatic deployment needs a
successful canonical-main push and an exact runtime-change receipt. A docs-only
or CI-only success cannot select deployment. Manual deployment is an explicit
operator action. The server preflight rejects stale revisions, dirty/diverged
work and foreign branches, then fast-forwards to the chosen revision and invokes
`deploy.sh --no-pull`. See [deployment](deployment.md) and [operations](operations.md).

## Documentation ownership

Keep application contracts in these product guides beside their owning sources.
Generated API/catalog files retain their generators. Dated records in `docs/work/`
and `tools/research/` preserve historical decisions and receipts; their old paths
and delivery statements are not active installation instructions. Source history
preserves the retired engineering installation.
