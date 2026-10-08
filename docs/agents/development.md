# Development rules

## Start from the current repository

- Read `AGENT.md` and [roles](coordination.md); check `AGENTS.md`, `CLAUDE.md`,
  `.cursorrules` and `codex.md` where present in the affected scope.
- Confirm checkout, branch, worktrees and uncommitted ownership before editing.
  Preserve user/other-session changes. Never overwrite an existing environment file.
- Use [current ADR state](../reviews/adr-current-state.md) and
  [execution order](../reviews/adr-execution-order.md), not a historical handoff.
- Read the relevant [architecture](../architecture.md) and [setup](../setup.md)
  sections. Env schema: `backend/src/config/env.ts`; permissions:
  `packages/core/src/rbac.ts`. Never print credentials or put them in reports.

## Dependency boundaries

```text
web/desktop, mobile → @orbyn/api-client, @orbyn/core
@orbyn/api-client → @orbyn/core
backend → @orbyn/core, @orbyn/api-client
```

Shared packages must not import apps or backend code. Backend must not import
app code. Apps must not import one another. `@orbyn/core` currently uses Zod and Yjs; manifests and the
lockfile are authoritative. Shared schemas/types belong in core; API transport
belongs in api-client. Backend enforces authority; UI permission checks are hints.

## Implementation conventions

- Match neighboring code and repository Prettier output; no unrelated reformatting.
  Existing TypeScript uses double quotes. Older single-quote guidance is stale.
- Use kebab-case modules, PascalCase React components/types and camelCase functions.
  Keep responsibilities clear, types precise and helpers justified.
- Document public contracts and non-obvious business rules. Use structured logging
  where needed; never log secrets, provider tokens or private document content.
- Preserve optimistic concurrency, transaction boundaries, cancellation and cleanup.
  Do not bypass ownership/visibility checks or silently change fallback behavior.
- Apply [UI/UX rules](ui-ux.md) for product UI/copy and
  [operations](operations.md) for services, migrations, privacy and deployment.

## Development and verification

Builder owns product/test source and development checks. Tester owns formal
checkpoint execution; Reviewer assesses code quality and test evidence without
coding or running tests. Follow the complete **Implement → Test → Review** flow.

- Unit tests isolate dependencies. Integration/runtime tests may use the guarded,
  disposable PostgreSQL test database documented in [setup](../setup.md#4-tests).
  Do not use a production database. Mock external providers for deterministic tests.
- New/changed endpoints need applicable authentication, authorization, validation,
  rate-limit and error/recovery coverage. Do not force irrelevant status cases into
  every test or equate mocked SQL with real transaction/migration verification.
- Record exact source, command, terminal exit and result. Failed setup attempts,
  skipped checks and older source-scoped evidence remain explicit.
- Live provider measurements need an authorized isolated fixture and protected
  credentials; distinguish them from deterministic test results.
- Build shared packages before focused tests that import their generated exports.
  Retest changed behavior; reuse older results only with relevant source equivalence.

## Local commands

Node **22+**, npm **10+**; use `npm ci` with the committed lockfile.
Prepare local env/test services using [setup](../setup.md); do not copy over existing envs.

| Purpose                       | Command                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Shared package prerequisites  | `npm run build:packages`                                                                 |
| Local combined backend        | `PORT=8008 npm run dev:api`                                                              |
| Shared web/desktop UI preview | `API_PROXY_URL=http://127.0.0.1:8008 npm run dev -w desktop -- --port 5174`              |
| Mobile UI browser preview     | `EXPO_PUBLIC_API_URL=http://127.0.0.1:8008 npm run start -w mobile -- --web --port 8083` |
| Types across workspaces       | `npm run typecheck`                                                                      |
| Backend tests                 | `npm test` with the guarded `TEST_DATABASE_URL` from setup                               |
| Production backend/web build  | `npm run build`                                                                          |
| Formatting                    | Prettier on changed files; avoid repository-wide writes for a small change               |

These ports are local examples: reuse existing owned processes and matching APIs.
Run migrations only against the intended database. Background and Overnight have
separate runtimes; launch commands and service ownership are in setup/architecture.
Web qualifies shared desktop UI; Expo web qualifies mobile browser UI. Do not add
desktop-app, iOS/Android or C1 200% verification jobs excluded by the user.
