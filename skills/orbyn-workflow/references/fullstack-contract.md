# The Orbyn Engineering contract

Orbyn Engineering treats a feature as a connected user outcome across domain,
transport, persistence, clients and operations. The consuming project supplies
its actual stack and policies. Orbyn's own application is one consumer; private
application files are not prerequisites for using this library elsewhere.

## Ground → contract → change → evidence → delivery

These are questions to resolve, not five mandatory ceremonies for every edit.

| Decision | Artifact worth keeping | Common failure to prevent |
| --- | --- | --- |
| What exists and what is being requested? | Source anchors, current checkout and exclusions | Implementing a remembered design in the wrong worktree |
| What owns the new behavior? | Caller-facing contract, lifecycle and authority boundary | UI flags becoming a second domain model |
| Which layers must change together? | One vertical slice with named file/resource ownership | API success while a client still uses the old shape |
| What evidence supports the result? | Candidate + observed outcome + meaningful limits | Calling source, mocks or a browser run native acceptance |
| What was actually delivered? | Local/committed/pushed/merged/deployed state | Describing a prepared PR as a production change |

## Resolve the consuming project

Read its AGENTS/CLAUDE instructions, relevant manifests and stack guide. Identify
the domain/schema owner, transport/client owner, API/auth boundary, storage and
migration owner, affected web/mobile surfaces and operational target. Missing
layers are marked inapplicable; do not manufacture a backend for a static edit.
Use existing tokens, components, schemas and commands. Library examples do not
authorize installing Orbyn's stack, changing provider defaults or adding services.

For a cross-stack feature, a useful brief includes the user-visible trigger and
result, current entrypoints, intended contract, owned paths/resources, known
failure modes, allowed checks and exact delivery target. Keep product decisions
distinct from routine implementation choices. Preserve unrelated work.

## Choose the owner before adding layers

- [Architecture](../../architect/SKILL.md) owns interfaces and lifecycle choices.
- [Backend design](../../orbyn-backend-design/SKILL.md) turns a contract into an
  authorized API/service path with deliberate errors and effects.
- [Data migration](../../orbyn-data-migration/SKILL.md) owns persisted-format
  compatibility, writer cutover and recovery.
- [UI](../../orbyn-ui-design/SKILL.md) and
  [content](../../orbyn-content-design/SKILL.md) own the actual task flow.
- [CI design](../../orbyn-ci-design/SKILL.md) owns trusted execution, required
  checks and reviewable promotion; CI success does not prove agent judgment.

The main workflow selects these only when the task crosses their boundary.
Conditional principle methods live under those owners; they add no separate project.
An agent assignment carries a concrete artifact and a stopping condition, not
an instruction to recreate the entire workflow recursively.

## Evidence follows the changed contract

| Changed contract | Useful authorized evidence | Still separate |
| --- | --- | --- |
| Schema/API/authority | Focused behavior check with valid and denied inputs | Live provider and deployment |
| Persisted data | Baseline-to-target and retry/recovery on disposable fixtures | Production migration |
| Web/desktop flow | Rendered changed states, keyboard and narrow pane | Installed native behavior |
| Mobile behavior | Appropriate renderer/device evidence for the claim | Browser parity is not native proof |
| Export/document | Reopen/render the actual file, inspect pages and metadata | Source structure alone |
| Skill or CI change | Routing/link/metadata checks and focused helper checks | Reliable live agent selection |

Use the verification authority actually granted by the task. Record unchecked
boundaries plainly, then complete the authorized delivery work.

## Preview and operating handoff

For a user-facing design, deliver the [preview](../../orbyn-ui-design/references/prototypes.md)
the person can actually open, with states to try and simulated effects labelled.
For implementation, connect that flow to real domain/API/authority and recovery
contracts; preview success does not establish backend persistence. Material service
changes also need the architect's [operating contract](../../architect/references/service-readiness.md).
Retain artifacts and close owned resources under [artifact lifecycle](artifact-lifecycle.md).
