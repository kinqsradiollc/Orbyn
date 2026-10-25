# Orbyn agent roles

`orbyn-agent` and `orbyn-light` are the shared agent types for repository work
in Codex and Claude Code. A role describes the assignment it receives, its allowed effects and the
result it returns. Roles do not require separate permanent agents or sessions.
The owning session acts as Lead for substantial work and remains responsible
for the final result. It delegates execution, then reviews and verifies handoffs.

| Role                | Responsibility and output                                                                        | Primary skills                                               | Effects                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Lead                | Ground scope and design; assign bounded owners; integrate, review and verify actual results      | `orbyn-workflow`, `orbyn-plan`, `architect` as applicable    | Coordination and scoped integration; no implicit external effects              |
| Investigator        | Trace current behavior and relevant history; return source locations, mechanisms and uncertainty | `how`, `why`                                                 | Read-only                                                                      |
| Planner             | Ground scope, research unknowns and sequence coherent delivery units                             | `orbyn-plan`, `orbyn-research`                               | Plan-only unless implementation is authorized                                  |
| Architect           | Define interfaces, ownership, lifecycle and alternatives; return a concrete design               | `architect`, `arena`                                         | Design artifacts only unless implementation is requested                       |
| Engineer            | Implement the agreed change; preserve caller contracts and recovery behavior                     | `orbyn-workflow`, `language-best-practices`, `figure-it-out` | Assigned source files                                                          |
| Diagnostician       | Reproduce or trace a failure, identify its cause and propose or implement the scoped fix         | `how`                                                        | Source edits only within the brief; checks need authorization                  |
| Verifier            | Execute the agreed checks against the exact candidate; report outcomes and limits                | `orbyn-workflow`, `tdd`                                      | Owned fixtures/reports; no product edits during independent verification       |
| Reviewer            | Challenge concrete correctness, authority and evidence gaps; return actionable findings          | `interrogate`                                                | Read-only candidate; report output                                             |
| Designer            | Resolve the user's task flow, content and responsive layout within Orbyn's design system         | `orbyn-ui-design`, `orbyn-content-design`                    | Assigned UI/copy files or a design-only artifact                               |
| Writer              | Explain the implementation, decisions and delivery state using supported facts                   | `unslop`, `show-me-your-work`                                | Assigned documentation                                                         |
| Workflow maintainer | Improve agent instructions from demonstrated lessons and explicit user preferences               | `orbyn-skill-creator`, `reflect`, `orbyn-setup`              | Authorized skill/config files only                                             |
| Artifact analyst    | Investigate packaged software or runtime evidence and preserve provenance                        | `reverse-engineer-anything`                                  | Target/evidence scope in the brief; no implicit execution or tool installation |

## Assign and reuse

Read [orbyn-workflow](../../skills/orbyn-workflow/SKILL.md) before substantial
work. The parent brief names the role, outcome, file/fixture ownership, allowed
checks and stopping condition. Read only the mapped skills needed for that task.
A role may run in the current session, in a separately requested project session,
or as a bounded native subagent under [coordination](coordination.md).

Select `orbyn-agent` for complex work or `orbyn-light` for bounded work when the
host supports the named definition; follow [model policy](model-policy.md). Resume the same
child for continuation instead of creating a duplicate. If the host cannot select
the definition, report that capability gap and continue authorized direct work
where possible; do not substitute a generic inherited agent or CLI process. Do not claim a named agent ran when it did not.
Children report to the owning session and do not recursively delegate. Independent
review or verification remains separate from the engineer's implementation work.
Lead review and proportional authorized verification are required for substantial
work; extra independent roles follow the requested qualification scope. A role
label never authorizes tests, publication or other external effects by itself.

## Model routing

Roles describe responsibility; agent types select the model and effort from
[models.json](models.json) under [model policy](model-policy.md). Preserve standard
processing, without Fast/Priority/Ultrafast modes or speed variants. Route by the
actual assignment:

| Assignment                                                                                                      | Agent type                                                       |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Cross-cutting planning, architecture, complex implementation, difficult diagnosis, consequential review         | `orbyn-agent`                                                    |
| Bounded source lookup, clear small edits, routine authorized checks, documentation, focused evidence collection | `orbyn-light`                                                    |
| Strongest-model work explicitly selected by the human                                                           | Human-selected session/model from the registry's human-only tier |

An Investigator may need the standard tier for an ambiguous subsystem; a Reviewer
may use the light tier for a small, clear diff. Do not force every role onto the
same tier or create extra agents merely to use multiple models. The owner may
move a bounded assignment from light to standard when complexity warrants it,
recording why. Never automatically select the human-only tier.

Host definitions: Codex [standard](../../.codex/agents/orbyn-agent.toml) and
[light](../../.codex/agents/orbyn-light.toml); Claude Code
[standard](../../.claude/agents/orbyn-agent.md) and
[light](../../.claude/agents/orbyn-light.md).
