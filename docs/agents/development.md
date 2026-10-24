# Development

Start with [AGENTS.md](../../AGENTS.md). Identify the requested outcome, active
checkout and existing changes. Read nearby source, its callers and applicable
nested instructions. The current manifests and contracts outrank old reports.

## Branch naming

Use a lowercase, purpose-based branch name. Prefer `<type>/<short-description>`
with a neutral work type such as `feat`, `fix`, `chore`, `refactor` or `docs`.
Examples are `fix/session-recovery`, `feat/calendar-sharing` and
`chore/agent-workflow`. The name describes the change rather than its author.

Never create a branch with agent, assistant, vendor, tool or model branding in
any path component or descriptive suffix. This includes `codex`, `claude`,
`openai`, `anthropic`, `chatgpt`, `copilot` and equivalent product/model names.
Do not copy a host's branded default prefix when creating a branch or worktree;
choose a neutral purpose-based name and check it before creation.

Existing branches and historical source references are not new names. Preserve
them when continuing existing work. Renaming or deleting a shared remote branch,
or moving another chat's checkout, requires an explicit request; this policy
alone does not authorize those operations. An existing branded branch is not a
reason to recreate it for a new task.

## Worktree locations and branch publication

Follow [worktree ownership](../../skills/orbyn-worktree/SKILL.md). For the primary
Orbyn clone, use sibling `orbyn-wt/<purpose>/` by default; resolve the primary from
Git registration even when starting inside a linked checkout. Reuse suitable owned
worktrees and neutral task branches, preserve active legacy paths and verify the
base before editing. Check ignored outputs/configuration before any cleanup.

Branches stay local until publishing is authorized. Prefer a permitted approved
private personal contribution fork when supported, with a meaningful stable name such as
`Orbyn-contributions` when company policy allows it; reuse the fork across tasks.
Verify account, actual visibility, upstream relationship and push destination.
GitHub public-parent native forks stay public; preserve local work or an
authorized private backup until reviewed public PR publication is authorized.
The owning worktree policy distinguishes that backup from a native fork; do not
recreate existing forks or change visibility to enforce a preference.
Do not create remote branches/forks for every delegate, publish restricted code
into a public/unauthorized fork, or silently push a company branch when fork
permission is unavailable. Existing explicit internal contribution instructions
and already-owned delivery branches retain their scope.

## Understand, design, implement

Use [how](../../skills/how/SKILL.md) to trace the affected path. For a substantive
interface change, use [architect](../../skills/architect/SKILL.md): caller usage,
data shape, owner, lifecycle and error behavior before implementation. Inspect
history with [why](../../skills/why/SKILL.md) when a strange constraint may be
intentional. Keep speculative improvements outside the agreed change.

Prefer one authoritative representation. Remove redundant interpretation and
proven obsolete internal paths after migrating their callers. Public APIs,
stored records and older clients need an explicit compatibility plan. A broad
rewrite is not the default response to a local defect.

## Dependency boundaries

```text
web/desktop, mobile -> @orbyn/api-client, @orbyn/core
@orbyn/api-client -> @orbyn/core
backend -> @orbyn/core, @orbyn/api-client
```

Shared packages must not import apps/backend. Apps must not import one another;
backend must not import app code. Shared schemas/types belong in core and API
transport in api-client. Backend enforces authority; UI checks are hints.
Read relevant [architecture](../architecture.md) and [setup](../setup.md) sections.

Use [TypeScript guidance](../../skills/typescript-best-practices/SKILL.md).
Validate untrusted input at boundaries, keep authority checks near effects, and
preserve optimistic concurrency, transaction boundaries, cancellation and cleanup.
Types do not replace runtime validation of persisted or external data.

Match repository Prettier and neighboring code. Current TypeScript uses double
quotes. Use kebab-case modules and PascalCase components/types. Avoid arbitrary
function-length limits, obligatory wrappers and catch/log/rethrow in every helper.
Document non-obvious constraints; never log secrets or private document content.
New configuration must update applicable `.env.example` templates, service
bindings and deployment instructions. Keep private configuration local; client
`VITE_*` and `EXPO_PUBLIC_*` values are public. Use
`node scripts/check-env-examples.mjs` for template coverage when in scope.

## Commands and evidence

Read the current `package.json` before choosing a command. Orbyn requires Node
22+ and npm 10+; vendored tools have separate requirements and lockfiles.

| Purpose                                | Command                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Install Orbyn dependencies when needed | `npm ci`                                                                                 |
| Shared exports                         | `npm run build:packages`                                                                 |
| API example                            | `PORT=8008 npm run dev:api`                                                              |
| Web example                            | `API_PROXY_URL=http://127.0.0.1:8008 npm run dev -w desktop -- --port 5174`              |
| Expo web example                       | `EXPO_PUBLIC_API_URL=http://127.0.0.1:8008 npm run start -w mobile -- --web --port 8083` |
| Types                                  | `npm run typecheck`                                                                      |
| Backend default suite, when authorized | `npm test`                                                                               |
| Production backend/web build           | `npm run build`                                                                          |

Reuse owned matching processes; these ports are examples. Build shared packages
before checks consuming their generated exports. Format only changed authored
files, excluding immutable upstream snapshots. There is no root `npm run lint`.

Follow the [delivery workflow](delivery.md) for scope and
verification authorization. When testing is in scope, use the guarded disposable
database from [setup](../setup.md#4-tests): `TEST_DATABASE_URL`, an `_test` database,
and `orbyn.environment='test'`. Never substitute production. The default backend
suite does not establish that every separate integration lane ran. Inspect the
owning test scripts and record exact commands, terminal results and missing lanes.
Mock providers for deterministic tests; mock evidence is not live-provider proof.

## Select checks by impact

Use [proportional CI policy](../../skills/orbyn-ci-design/references/change-scope.md).
An inert local typo/comment needs relevant diff, formatting or link review, not
an application build or hosted run. Skill instructions need their metadata,
source and routing checks; executable helpers need meaningful helper tests.
Runtime, shared contracts, dependencies and uncertain changes need affected
application checks. A small diff is not evidence of small impact.

The published workflow uses [.github/ci-scope.json](../../.github/ci-scope.json).
Known product docs, license text and skills take the lightweight lane; the shared
skills/source check still runs. Unknown paths, runtime inputs, CI definitions and
the classifier itself run all five application jobs. This initial path policy
does not attempt to prove that a runtime-code edit contains only comments.
Use manual `CI` dispatch for a full run regardless of paths.

`Select CI scope` and `CI result` run for every published candidate. The result
rejects classification failures, missing decisions and failed/cancelled or
unexpectedly skipped selected jobs. Configure `CI result` as a required status in
repository rules when promoting this workflow; editing YAML does not configure
branch protection. Never call intentional skips passed application tests or use
a new filter to hide an observed failure.

CD is separate: docs/skills-only success does not auto-deploy. With the existing
`AUTO_DEPLOY` setting enabled, automatic promotion needs a successful canonical
main push and its exact runtime-change artifact. Manual deployment remains an
explicit operator action. The SSH preflight refuses stale revisions, dirty or
diverged server work and foreign branches; it fast-forwards only to the selected
candidate and invokes deployment with `--no-pull`. No reset/clean or production
operation is authorized merely by this policy.

For migrations and services, read [operations](operations.md). For UI/copy, read
[UI/UX](ui-ux.md). Do not run the vendored REA test suite for an Orbyn change.
