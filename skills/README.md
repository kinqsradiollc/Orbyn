# Orbyn skills

Start with [orbyn-workflow](orbyn-workflow/SKILL.md) and the
[skill system](../docs/agents/skill-system.md). Use
[orbyn-skill-creator](orbyn-skill-creator/SKILL.md) to maintain this catalog,
[orbyn-plan](orbyn-plan/SKILL.md) for planning and
[orbyn-setup](orbyn-setup/SKILL.md) for host configuration.

Canonical folders are linked into Codex and Claude Code. Load only the relevant
skill body and references. Roles, stack boundaries and model/session policy live
in `docs/agents/`. This index is generated from `catalog.json` and frontmatter by
`python3 scripts/sync-agent-skills.py --write`.

## Workflow and planning

- [automate-me](automate-me/SKILL.md) — Capture explicitly requested working preferences in a reusable local skill, using the current conversation or user-selected examples.
- [figure-it-out](figure-it-out/SKILL.md) — Plan and execute an authorized large migration or cross-cutting task with measurable completion criteria and a concise evidence trail.
- [orbyn-plan](orbyn-plan/SKILL.md) — Scope and sequence an Orbyn change, migration or investigation before implementation; use for explicit planning requests and consequential cross-cutting work.
- [orbyn-research](orbyn-research/SKILL.md) — Resolve a specific architectural, dependency, platform or design uncertainty using local evidence and authoritative external sources before choosing an implementation.
- [orbyn-setup](orbyn-setup/SKILL.md) — Configure Orbyn repository skills, agent roles, models and session coordination for Codex or Claude Code when requested.
- [orbyn-skill-creator](orbyn-skill-creator/SKILL.md) — Create, refine, merge or retire Orbyn repository skills while keeping task routing, technology boundaries, host discovery and documentation consistent.
- [orbyn-workflow](orbyn-workflow/SKILL.md) — Route substantial Orbyn engineering work through evidence-led investigation, design, implementation and verification. Use for Orbyn workflow requests and multi-step changes.
- [reflect](reflect/SKILL.md) — Review the current task for reusable lessons when requested, and update only the authorized workflow or skill scope.
- [show-me-your-work](show-me-your-work/SKILL.md) — Keep a compact decision and evidence trail for substantial migrations or unattended work that the user will review later.

## Engineering practice

- [architect](architect/SKILL.md) — Design data shapes, interfaces and ownership for substantive features or refactors before implementation.
- [arena](arena/SKILL.md) — Compare competing design or implementation sketches when a consequential choice cannot be resolved cheaply from existing evidence.
- [how](how/SKILL.md) — Trace source behavior, data flow, ownership and module boundaries before explaining or changing an unfamiliar subsystem.
- [interrogate](interrogate/SKILL.md) — Challenge a specified design, patch or claim for concrete correctness, ownership and evidence gaps. Use for adversarial review, not every routine edit.
- [orbyn-security-remediation](orbyn-security-remediation/SKILL.md) — Investigate and resolve existing Orbyn security findings, record evidence and add preventive checks without starting a security scan.
- [tdd](tdd/SKILL.md) — Write a focused failing-before regression and fix when the user requests TDD or testing and the affected behavior has a practical test boundary.
- [typescript-best-practices](typescript-best-practices/SKILL.md) — Design and edit TypeScript data models and boundaries using precise types, existing schemas and explicit lifecycle handling.
- [unslop](unslop/SKILL.md) — Edit agent prose and documentation for clear factual communication while preserving the requested voice and evidence.
- [why](why/SKILL.md) — Investigate design rationale, regressions and trade-offs using Git history and relevant authorized records; distinguish documented intent from inference.

## Fullstack contracts and delivery

- [orbyn-backend-design](orbyn-backend-design/SKILL.md) — Design and implement API/service behavior across validation, authorization, persistence, concurrency and client errors using the consuming project's stack. Use architect first for unsettled ownership; use orbyn-data-migration for stored-format changes.
- [orbyn-ci-design](orbyn-ci-design/SKILL.md) — Design or repair CI checks, contribution automation and release promotion with scoped credentials, deterministic artifacts and clear evidence boundaries. Use for workflow changes; not permission to publish, merge or deploy.
- [orbyn-data-migration](orbyn-data-migration/SKILL.md) — Plan and implement stored-data, schema and writer migrations with compatibility, cutover, retry and recovery evidence. Use for durable format changes; not a routine in-memory type refactor or permission to run production migrations.

## Engineering principles

- [principle-boundary-discipline](principle-boundary-discipline/SKILL.md) — Design validation and error handling at real trust or effect boundaries.
- [principle-build-the-lever](principle-build-the-lever/SKILL.md) — Choose reusable automation for repetitive or fragile work.
- [principle-encode-lessons-in-structure](principle-encode-lessons-in-structure/SKILL.md) — Prevent a demonstrated recurring error at its owning boundary.
- [principle-exhaust-the-design-space](principle-exhaust-the-design-space/SKILL.md) — Resolve a consequential unfamiliar design choice by comparing concrete alternatives.
- [principle-experience-first](principle-experience-first/SKILL.md) — Resolve product trade-offs around the person completing the task.
- [principle-fix-root-causes](principle-fix-root-causes/SKILL.md) — Trace a defect to the owner of the invalid state or interpretation.
- [principle-foundational-thinking](principle-foundational-thinking/SKILL.md) — Choose data shape, ownership and lifecycle before adding logic.
- [principle-guard-the-context-window](principle-guard-the-context-window/SKILL.md) — Keep investigation context useful during large searches and long tasks.
- [principle-laziness-protocol](principle-laziness-protocol/SKILL.md) — Simplify a design or diff without losing required behavior.
- [principle-make-operations-idempotent](principle-make-operations-idempotent/SKILL.md) — Design commands and workers that tolerate retries, crashes and duplicate delivery.
- [principle-migrate-callers-then-delete-legacy-apis](principle-migrate-callers-then-delete-legacy-apis/SKILL.md) — Replace an internal API while eliminating duplicate old paths.
- [principle-minimize-reader-load](principle-minimize-reader-load/SKILL.md) — Reduce indirection and hidden mutable state in difficult-to-follow code.
- [principle-never-block-on-the-human](principle-never-block-on-the-human/SKILL.md) — Continue authorized reversible work without unnecessary confirmation.
- [principle-outcome-oriented-execution](principle-outcome-oriented-execution/SKILL.md) — Complete an agreed migration without accumulating temporary compatibility debt.
- [principle-prove-it-works](principle-prove-it-works/SKILL.md) — Match a completion claim to direct evidence about the requested artifact.
- [principle-redesign-from-first-principles](principle-redesign-from-first-principles/SKILL.md) — Integrate a new requirement into a coherent design instead of layering patches.
- [principle-separate-before-serializing-shared-state](principle-separate-before-serializing-shared-state/SKILL.md) — Prevent concurrent writers from corrupting a shared artifact or state object.
- [principle-sequence-verifiable-units](principle-sequence-verifiable-units/SKILL.md) — Order a multi-part change so failures are localized and delivery is understandable.
- [principle-subtract-before-you-add](principle-subtract-before-you-add/SKILL.md) — Reduce existing complexity before extending an affected design.
- [principle-type-system-discipline](principle-type-system-discipline/SKILL.md) — Use types to express valid states and prevent meaningful contract mistakes.

## Product design

- [orbyn-content-design](orbyn-content-design/SKILL.md) — Write and arrange concise Orbyn product content, labels, status, errors and help across web, desktop and mobile. Use for visible interface copy and content hierarchy; preserve user-authored documents and messages.
- [orbyn-ui-design](orbyn-ui-design/SKILL.md) — Design, implement, or review Orbyn UI and UX across web, desktop, and mobile: task flows, concise copy, responsive layouts, overlays, and AI interactions. Use for visible product flows; not backend-only work.

## Social content and visuals

- [social-content](social-content/SKILL.md) — Draft and revise LinkedIn and other social posts, product announcements, threads and carousel copy from supplied evidence in the author's voice. Use social-preview for visual assets and feed mockups.
- [social-preview](social-preview/SKILL.md) — Create and inspect local social post previews, announcement graphics and carousels for LinkedIn and other platforms. Use for feed mockups and exportable social visuals, not product UI changes or publishing.

## Artifact investigation and REA maintenance

- [rea-analysis-optimization](rea-analysis-optimization/SKILL.md) — Optimize a measured REA analysis bottleneck while preserving evidence and resource ownership; scoped to REA.
- [rea-changelog-update](rea-changelog-update/SKILL.md) — Prepare REA release notes from pinned upstream history when requested; does not publish or infer REA history from Orbyn Git.
- [rea-ci-tests-audit](rea-ci-tests-audit/SKILL.md) — Audit REA test and CI quality when specifically requested; does not run REA qualification for unrelated Orbyn changes.
- [rea-tool-design](rea-tool-design/SKILL.md) — Design REA tools or CLI/MCP contracts when modifying the vendored REA project; not ordinary Orbyn API work.
- [reverse-engineer-anything](reverse-engineer-anything/SKILL.md) — Analyze shipped binaries, packages, Electron/JavaScript apps or authorized runtime behavior with REA and preserve evidence provenance. Ordinary source questions use how.

## Scope and attribution

These are Orbyn Engineering workflows, usable with a consuming project's own
stack and policies. REA maintenance skills apply only to that optional tooling. See [tooling](../docs/agents/tooling.md) and
[notices](../tools/THIRD_PARTY_NOTICES.md) for complete source and attribution.
Old standalone skill files have been retired; use the canonical folders above.
