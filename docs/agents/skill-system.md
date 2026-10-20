# How Orbyn skills work together

One owning workflow selects a small set of skills for the requested outcome.
Skills exchange concrete artifacts: source findings, a decision, an implementation
plan, changed files or a verification record. They do not recursively invoke each
other or load the whole catalog. [Roles](roles.md) define responsibility;
[stack](stack.md) defines the technology boundary.

| Task or unknown                    | Primary skill                              | Useful input / handoff                                                              |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Clear bounded implementation       | `orbyn-workflow`                           | Current source → scoped change → authorized evidence                                |
| Broad or explicitly requested plan | `orbyn-plan`                               | Outcome + stack + findings → ordered executable plan                                |
| Unknown current behavior           | `how`                                      | Owning files → mechanism and evidence                                               |
| Historical reason                  | `why`                                      | Relevant Git/source history → constraints, with uncertainty                         |
| External/version uncertainty       | `orbyn-research`                           | Specific question → cited finding for the planner/designer                          |
| Interface/ownership decision       | `architect`                                | Grounded requirements → chosen contracts and lifecycle                              |
| Consequential competing designs    | `arena`                                    | Shared criteria → bounded alternatives and one decision                             |
| Large execution                    | `figure-it-out`                            | Agreed plan → completed units and concise handoffs                                  |
| UI flow/layout                     | `orbyn-ui-design` + `orbyn-content-design` | User task + actual tokens → coherent UI/copy                                        |
| TypeScript contract                | `typescript-best-practices`                | Existing schema/callers → precise valid states                                      |
| Requested tests/TDD                | `tdd`                                      | Failure contract + allowed environment → focused regression and fix                 |
| Existing security findings         | `orbyn-security-remediation`               | Saved findings + current source → scoped fixes and authorized evidence; no new scan |
| Concrete adversarial review        | `interrogate`                              | Candidate + intended behavior → actionable findings                                 |
| Artifact/runtime investigation     | `reverse-engineer-anything`                | Target + authority + actual tools → traceable evidence                              |
| Skill creation/refinement          | `orbyn-skill-creator`                      | Routing gap → integrated skill, links and docs                                      |
| Host configuration                 | `orbyn-setup`                              | Supported host + user preferences → scoped configuration                            |
| Lessons/preferences                | `reflect` / `automate-me`                  | Current-task evidence + authorization → owning instruction change                   |
| Prose / durable evidence           | `unslop` / `show-me-your-work`             | Supported facts → concise result or decision record                                 |

Select principle leaves when the decision needs them: ownership and boundaries,
root cause, idempotency, shared-state isolation, simpler design, compatibility,
context cost and evidence. They refine the task; they are not separate obligatory
phases or approval gates. REA maintenance skills apply only when that tooling is
the requested target.

## Keep the system coherent

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

These examples are routing expectations, not claims of executed model trials.
