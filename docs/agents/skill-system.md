# How Orbyn skills work together

One owning workflow selects a small set of skills for the requested outcome.
For substantial work, its lead delegates investigation and implementation, then
reviews the actual artifacts and verifies the integrated outcome under
[coordination](coordination.md) and [delivery](delivery.md). Skill selection does
not itself create new project chats. Skills exchange concrete artifacts: source findings, a decision, an implementation
plan, changed files or a verification record. They do not recursively invoke each
other or load the whole catalog. [Roles](roles.md) define responsibility;
[stack](stack.md) defines the technology boundary. [Model policy](model-policy.md)
routes complex work to the standard tier and bounded work to the light tier in
[models.json](models.json), and reserves its human-only tier for explicit selection.

| Task or unknown                    | Primary skill                              | Useful input / handoff                                                                              |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Clear bounded implementation       | `orbyn-workflow`                           | Small clear edit → direct change; substantial work → delegate → lead review and authorized evidence |
| Broad or explicitly requested plan | `orbyn-plan`                               | Outcome + stack + findings → ordered executable plan                                                |
| Unknown current behavior           | `how`                                      | Owning files → mechanism and evidence                                                               |
| Historical reason                  | `why`                                      | Relevant Git/source history → constraints, with uncertainty                                         |
| External/version uncertainty       | `orbyn-research`                           | Specific question → cited finding for the planner/designer                                          |
| Upstream code/skill freshness      | `orbyn-upstream-review`                    | Pinned source + local owner → reviewed differences, dispositions and scoped update                  |
| Interface/ownership/module layout  | `architect`                                | Grounded requirements → contracts, lifecycle and allowed module dependencies                        |
| API/service effects                | `orbyn-backend-design`                     | Caller contract + authority → transactional effect and client errors                                |
| Stored-data/schema transition      | `orbyn-data-migration`                     | Reader/writer inventory → compatible cutover and recovery                                           |
| CI and contribution automation     | `orbyn-ci-design`                          | Event/trust model → scoped checks and reviewable promotion                                          |
| Consequential competing designs    | `arena`                                    | Shared criteria → bounded alternatives and one decision                                             |
| Large execution                    | `figure-it-out`                            | Agreed plan → completed units and concise handoffs                                                  |
| UI flow/layout                     | `orbyn-ui-design` + `orbyn-content-design` | User task + actual tokens → coherent UI/copy                                                        |
| Social posts and carousel copy     | `social-content`                           | Supplied facts + author voice → copy, claim notes and optional visual brief                         |
| Social graphics and feed previews  | `social-preview`                           | Chosen copy + assets → editable visual source, rendered review and requested exports                |
| Language implementation/review     | `language-best-practices`                  | Actual changed paths/runtime → relevant language guide and affected callers                         |
| Technology/stack selection         | `orbyn-stack-selection`                    | Requirements + existing baseline + fresh evidence → bounded decision and revisit trigger            |
| TypeScript contract                | `typescript-best-practices`                | Existing schema/callers → precise valid states                                                      |
| Requested tests/TDD                | `tdd`                                      | Failure contract + allowed environment → focused regression and fix                                 |
| Existing security findings         | `orbyn-security-remediation`               | Saved findings + current source → scoped fixes and authorized evidence; no new scan                 |
| Concrete adversarial review        | `interrogate`                              | Candidate + intended behavior → actionable findings                                                 |
| Artifact/runtime investigation     | `reverse-engineer-anything`                | Target + authority + actual tools → traceable evidence                                              |
| Skill creation/refinement          | `orbyn-skill-creator`                      | Routing gap → integrated skill, links and docs                                                      |
| Host configuration                 | `orbyn-setup`                              | Supported host + user preferences → scoped configuration                                            |
| Lessons/preferences                | `reflect` / `automate-me`                  | Current-task evidence + authorization → owning instruction change                                   |
| Prose / durable evidence           | `unslop` / `show-me-your-work`             | Supported facts → concise result or decision record                                                 |

Select principle leaves when the decision needs them: ownership and boundaries,
root cause, idempotency, shared-state isolation, simpler design, compatibility,
context cost and evidence. They refine the task; they are not separate obligatory
phases or approval gates. REA maintenance skills apply only when that tooling is
the requested target.

## Orbyn Engineering identity

Use the [fullstack contract](../../skills/orbyn-workflow/references/fullstack-contract.md)
to connect domain, transport, persistence, clients and operations. Resolve the
consuming project’s actual stack before applying examples. The skills preserve
source attribution and provide concrete decision examples rather than claiming
all methods originated here. Backend, stored-data and CI skills own separate
boundaries; they do not duplicate the architect or launch extra workflow stages.

## Keep the system coherent

Shared skill changes follow the [public upstream contract](skill-upstream.md).
The public library owns shared content; this application keeps its own
product policy and consumes a hash-pinned copy. Explicit skill-only export and
review replace automatic publication of private changes.

Social writing and visuals share a brief, not a recursive workflow: `social-content`
owns the message and evidence; `social-preview` owns composition and rendering.
`unslop` supplies prose refinement. In-app language and product layout stay with
the product design skills. A text-only post needs no renderer, and a supplied
caption needs no rewrite merely to preview it. PDF, presentation and image tools
are optional output paths selected from capabilities actually available in the
host. See the [source/design record](../../tools/research/social-content.md).

`skills/catalog.json` inventories canonical skills and routing relationships.
`sync-agent-skills.py` maintains the index and both host discovery links. The
asset checker catches broken links, missing imports, stale names and wrong defaults.
Use [documentation policy](documentation.md) to keep product contracts separate
from workflows. The creator changes the owning rule once and migrates callers;
it must not add another competing policy document for the same concern.

## Static routing examples

- “Plan a shared schema migration”: planner reads stack and current callers, uses
  architecture for the contract and produces a plan; plan-only does not edit code.
- “Fix a typo”: current session makes the small edit; no research or agent panel.
- “Redesign Docs on mobile”: UI/copy skills inspect actual components and pane
  width; research only unresolved facts; no new framework implied.
- “What changed in a provider API?”: researcher checks current primary docs and
  gives evidence to the owning implementation or plan.
- “Add a reusable skill”: creator checks overlap, catalog, both hosts and docs;
  it does not register MCP or change global settings.

- “Implement a substantial feature”: lead grounds the affected contracts, selects
  architecture where needed, delegates owned implementation, reviews the diff,
  verifies authorized behavior, and routes findings back before delivery.
- “Use a child to implement this migration”: that child completes its owned slice;
  it does not recursively spawn engineers. The parent supplies review separation.
- “Use a named delegate” when it is unavailable: state the capability failure and
  permitted direct fallback; do not substitute a generic inherited model.

- “Write a LinkedIn update from these feature notes”: social writing produces
  a supported draft; it does not infer release status from implementation alone.
- “Preview this exact caption with a two-card carousel”: social preview preserves
  the caption and renders the cards at wide/narrow sizes; it does not publish.
- “Shorten this Settings label”: product content design owns the edit, not social writing.
- “Export this carousel” without an available exporter: deliver editable source
  and identify the missing export step; HTML generation is not PDF/PNG evidence.

These examples are routing expectations, not claims of executed model trials.

## Consumer-owned skills and offline setup

A setup request selects [orbyn-setup](../../skills/orbyn-setup/SKILL.md); agents
complete authorized discovery, classification, migration, registration and checks
without asking the human to invoke each skill or command. Keep company-only
skills in `project-skills/`, outside public sync; follow the
[ownership guide](../../skills/orbyn-setup/references/project-skills.md).
Use [offline guidance](../../skills/orbyn-setup/references/offline.md) and the
existing owning skills from disk. Module contracts, delivery slices, diagnosis,
TDD and review guidance are integrated directly into those owners. Explicit portable audits use
[orbyn-security-audit](../../skills/orbyn-security-audit/SKILL.md); skill authoring
and installation never start an application or hosted security scan.

[orbyn-worktree](../../skills/orbyn-worktree/SKILL.md) owns primary-clone sibling
paths, naming, branch/fork publication, reuse and cleanup. The main workflow
selects it from isolation needs; the human need not invoke it separately.
