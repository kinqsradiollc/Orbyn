# Orbyn agent roles

`orbyn-agent` is the shared agent identity for repository work in Codex and Claude
Code. A role describes the assignment it receives, its allowed effects and the
result it returns. Roles do not require separate permanent agents or sessions.
The owning session coordinates work and remains responsible for the final result.

| Role | Responsibility and output | Primary skills | Effects |
| --- | --- | --- | --- |
| Investigator | Trace current behavior and relevant history; return source locations, mechanisms and uncertainty | `how`, `why` | Read-only |
| Planner | Ground scope, research unknowns and sequence coherent delivery units | `orbyn-plan`, `orbyn-research` | Plan-only unless implementation is authorized |
| Architect | Define interfaces, ownership, lifecycle and alternatives; return a concrete design | `architect`, `arena` | Design artifacts only unless implementation is requested |
| Engineer | Implement the agreed change; preserve caller contracts and recovery behavior | `orbyn-workflow`, `typescript-best-practices`, `figure-it-out` | Assigned source files |
| Diagnostician | Reproduce or trace a failure, identify its cause and propose or implement the scoped fix | `how`, `principle-fix-root-causes` | Source edits only within the brief; checks need authorization |
| Verifier | Execute the agreed checks against the exact candidate; report outcomes and limits | `principle-prove-it-works`, `tdd` | Owned fixtures/reports; no product edits during independent verification |
| Reviewer | Challenge concrete correctness, authority and evidence gaps; return actionable findings | `interrogate` | Read-only candidate; report output |
| Designer | Resolve the user's task flow, content and responsive layout within Orbyn's design system | `orbyn-ui-design`, `orbyn-content-design` | Assigned UI/copy files or a design-only artifact |
| Writer | Explain the implementation, decisions and delivery state using supported facts | `unslop`, `show-me-your-work` | Assigned documentation |
| Workflow maintainer | Improve agent instructions from demonstrated lessons and explicit user preferences | `orbyn-skill-creator`, `reflect`, `orbyn-setup` | Authorized skill/config files only |
| Artifact analyst | Investigate packaged software or runtime evidence and preserve provenance | `reverse-engineer-anything` | Target/evidence scope in the brief; no implicit execution or tool installation |

## Assign and reuse

Read [orbyn-workflow](../../skills/orbyn-workflow/SKILL.md) before substantial
work. The parent brief names the role, outcome, file/fixture ownership, allowed
checks and stopping condition. Read only the mapped skills needed for that task.
A role may run in the current session, in a separately requested project session,
or as a bounded native subagent under [coordination](coordination.md).

Select `orbyn-agent` when the host supports the named definition. Resume the same
child for continuation instead of creating a duplicate. If the host cannot select
the definition, pass its required reads and boundaries explicitly and state the
actual execution arrangement. Do not claim a named agent ran when it did not.
Children report to the owning session and do not recursively delegate. Independent
review or verification remains separate from the engineer's implementation work.
A role label never authorizes tests, publication or other external effects by itself.

## Defaults

All roles use **GPT-6.1 Sol / medium** in Codex and **Sonnet / medium** in Claude
Code. No Astra, Fable, xhigh, max or ultra. A panel is not required for a decision;
one well-scoped assignment is the default. See [model policy](model-policy.md).

Host definitions: [Codex](../../.codex/agents/orbyn-agent.toml),
[Claude Code](../../.claude/agents/orbyn-agent.md).
