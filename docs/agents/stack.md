# Stack and ownership

Inspect current manifests before choosing APIs, tools or a new dependency. This
map is derived from the repository source; exact installed versions live in the
workspace manifests and lockfile. Skills must fit the affected layer.

| Layer | Current stack and source | Working rule |
| --- | --- | --- |
| Shared domain | TypeScript, Zod; `packages/core` | Schemas, state contracts and domain helpers; no application imports |
| Transport | TypeScript fetch client; `packages/api-client` | Shared API behavior; preserve errors, authority and concurrency semantics |
| Web/desktop UI | React, Vite, Electron; `desktop/package.json` | Reuse components, local CSS/tokens and Electron boundaries |
| Mobile | Expo, React Native, native navigation/modules; `mobile/package.json` | Native components and theme; browser parity does not establish native behavior |
| API/services | Fastify, TypeScript, PostgreSQL; `backend/package.json` | Authority at effects, transactions, retries and resource lifecycle |
| Assistant | Repository-owned orchestration and provider adapters; `backend/src/modules/ai/agent/`, service workers | Inspect existing runtime before proposing external orchestration frameworks |
| Deployment | Compose, nginx, PgBouncer, optional Kubernetes; `compose.yaml`, `deploy/` | Respect environment/target ownership; repo edits are not deployment |
| Agent tooling | Portable Markdown skills, Codex TOML, Claude JSON/Markdown | Use supported host tools; no implicit global configuration |
| Artifact investigation | Isolated third-party tooling under `tools/` | Separate toolchain, licenses and runtime prerequisites from Orbyn workspaces |

## Before choosing an approach

Identify the owning module and callers, shared contract, affected clients, storage,
authority and recovery. Use `how` for an unfamiliar path, `architect` for a changed
boundary and `orbyn-research` for an unresolved external dependency fact. Do not
select a technology because a sample skill assumes it. New dependencies need a
concrete benefit against the existing stack, license and operational cost.

## Design constraints

Web tokens live in `desktop/src/styles/global.css` and shared presentation data
in `packages/core/src/presentation.ts`; mobile uses `mobile/src/theme/index.ts`.
Reuse the actual owning components. Do not inject Tailwind, a UI kit, a remote
font or a hosted widget runtime into Orbyn because an external example uses one.
Keep product assets first-party and use existing accessible interaction patterns.

Current root commands and database isolation are documented in [development](development.md).
Only execute the checks authorized for the task. A shared-type edit may affect
several clients; a documentation edit does not imply a native build or full suite.
