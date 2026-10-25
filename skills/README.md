# Orbyn skills

Start with [orbyn-workflow](orbyn-workflow/SKILL.md) and the
[skill system](orbyn-workflow/references/project-policy.md#routing). Use
[orbyn-skill-creator](orbyn-skill-creator/SKILL.md) to maintain this catalog,
[orbyn-plan](orbyn-plan/SKILL.md) for planning and
[orbyn-setup](orbyn-setup/SKILL.md) for host configuration.

Shared folders are linked into Codex and Claude Code. Consumer-owned skills live
separately under `project-skills/<company-or-repo>/<namespaced-skill>/`; follow the
[ownership guide](orbyn-setup/references/project-skills.md). They are discovered
by both hosts but excluded from this shared catalog and public sync.
Load only the relevant
skill body and references. Consumer instructions own roles, stack boundaries and
model/session policy; use the portable defaults only where guidance is missing.
This index is generated in the full library from `catalog.json` and frontmatter by
`python3 scripts/sync-agent-skills.py --write`.

## Workflow and planning

- [automate-me](automate-me/SKILL.md) — Capture explicitly requested working preferences in a reusable local skill, using the current conversation or user-selected examples.
- [figure-it-out](figure-it-out/SKILL.md) — Plan and execute an authorized large migration or cross-cutting task with measurable completion criteria and a concise evidence trail.
- [orbyn-plan](orbyn-plan/SKILL.md) — Refine an engineering request or scope and sequence a change, migration or investigation. Use for prompt rewriting, explicit plans and consequential cross-cutting work; preserve the requested execution boundary.
- [orbyn-research](orbyn-research/SKILL.md) — Resolve a specific architectural, dependency, platform or design uncertainty using local evidence and authoritative external sources before choosing an implementation.
- [orbyn-setup](orbyn-setup/SKILL.md) — Set up Orbyn skills in an existing project for Codex, Claude Code or Cursor; preserve target guidance and migrate explicitly owned company skills. Model/role configuration requires separate scope and host support.
- [orbyn-skill-creator](orbyn-skill-creator/SKILL.md) — Create, refine, merge or retire Orbyn repository skills while keeping task routing, technology boundaries, host discovery and documentation consistent.
- [orbyn-upstream-review](orbyn-upstream-review/SKILL.md) — Review freshness and changes in external skills, source code or research references; keep downloads in ignored orbyn-references, compare pinned revisions and selectively adapt existing owners.
- [orbyn-workflow](orbyn-workflow/SKILL.md) — Route engineering work through investigation, design, implementation and verification, including open-source contribution intake and bounded PR feedback/CI iteration. Follow the consuming project's instructions.
- [orbyn-worktree](orbyn-worktree/SKILL.md) — Manage local task branches, private contribution storage when supported and Git worktree isolation; use sibling <repo>-wt directories, purpose-based names and preservation before cleanup.
- [reflect](reflect/SKILL.md) — Review current-task evidence for reusable lessons when requested or a demonstrated skill gap emerges; propose bounded improvements and edit only within authorized scope.
- [show-me-your-work](show-me-your-work/SKILL.md) — Keep a compact decision and evidence trail for substantial migrations or unattended work that the user will review later.

## Engineering practice

- [architect](architect/SKILL.md) — Design data shapes, interfaces, ownership and module boundaries for substantive features or refactors; use for code organization, vertical modules and shared-code extraction.
- [arena](arena/SKILL.md) — Compare competing design or implementation sketches when a consequential choice cannot be resolved cheaply from existing evidence.
- [how](how/SKILL.md) — Trace source behavior, data flow and dependency impact across code, build and runtime boundaries; reproduce and reduce defects before explaining or changing an unfamiliar subsystem.
- [interrogate](interrogate/SKILL.md) — Challenge a specified design, patch or claim for concrete correctness, ownership and evidence gaps. Use for adversarial review, not every routine edit.
- [language-best-practices](language-best-practices/SKILL.md) — Implement or review TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, Swift, C, C++, SQL or shell code using its actual runtime, ownership and error contracts. Select only the affected local guide, including TypeScript schemas and lifecycle contracts.
- [orbyn-security-remediation](orbyn-security-remediation/SKILL.md) — Investigate and resolve existing Orbyn security findings, record evidence and add preventive checks without starting a security scan.
- [orbyn-stack-selection](orbyn-stack-selection/SKILL.md) — Choose or reassess a language, framework, database, runtime, hosting or build-versus-buy option from project constraints and current primary evidence. Produce a decision with operating and migration costs; ordinary implementation keeps the established stack.
- [tdd](tdd/SKILL.md) — Design focused contract tests or a failing-before regression for authorized implementation, bug repair or requested testing/TDD; select practical boundaries, fixtures and evidence within the requested execution scope.
- [unslop](unslop/SKILL.md) — Edit agent prose and documentation for clear factual communication while preserving the requested voice and evidence.
- [why](why/SKILL.md) — Investigate design rationale, regressions and trade-offs using Git history and relevant authorized records; distinguish documented intent from inference.

## Fullstack contracts and delivery

- [orbyn-backend-design](orbyn-backend-design/SKILL.md) — Design and implement API/service behavior across validation, authorization, persistence, concurrency and client errors using the consuming project's stack. Use architect first for unsettled ownership; use orbyn-data-migration for stored-format changes.
- [orbyn-ci-design](orbyn-ci-design/SKILL.md) — Design or repair CI, select affected checks, analyze bulk failures, verify release evidence and plan rollout or incident recovery. Keep artifact readiness and deployed health distinct; no implicit deployment authority.
- [orbyn-data-migration](orbyn-data-migration/SKILL.md) — Plan and implement stored-data, schema and writer migrations with compatibility, cutover, retry and recovery evidence. Use for durable format changes; not a routine in-memory type refactor or permission to run production migrations.
- [orbyn-security-audit](orbyn-security-audit/SKILL.md) — Perform an explicitly requested local or offline source security audit when a hosted scanner is unavailable or a portable audit is requested; preserve coverage, independent validation and structured findings.

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
stack and policies. REA maintenance skills apply only to that optional tooling.
Each skill carries its license and any incorporated source records. See
[attribution](orbyn-workflow/references/project-policy.md#documentation-and-attribution)
for the optional full-library indexes.
Old standalone skill files have been retired; use the canonical folders above.
