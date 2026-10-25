# Connect task playbooks to operational evidence

Choose a playbook from the user's outcome and current source. Keep the requested end state visible: explanation, design, local implementation, PR, merge and deployment are different deliverables. A skill handoff is internal work selection, not homework for the human.

Use this local handoff map when an upstream workflow name is absent:

| Need                                          | Maintained owner and result                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Reproduction and defect diagnosis             | `how` plus the bug-fix playbook: source trace, supported cause, corrected invariant     |
| Architecture alternatives                     | `architect`, with `arena` only for a consequential unresolved comparison                |
| Performance or captured-profile investigation | Performance/trace playbook: workload, limiting phase, comparable observations           |
| Caller-preserving refactor                    | Refactoring playbook: caller inventory, target boundary, compatibility evidence         |
| Prototype or evaluation                       | Relevant playbook: frozen question, decision criteria, observations and limits          |
| Paused or resumed work                        | Pause/session-pickup playbook: exact candidate, owned output, unresolved actions        |
| PR creation or CI choice                      | Opening-a-PR playbook and CI owner: allowlisted patch, destination, proportional checks |
| Upstream contribution                         | [Intake](../playbooks/contribution-intake.md): target policy, issue overlap, feasibility and requested end state |
| PR feedback and current-head gates            | [Bounded iteration](../playbooks/pr-iteration.md): supported corrections, exact candidate, check/review gates and retry limit |

Do not call a missing upstream skill or silently install a collection to satisfy its name. Follow a local maintained owner; if a requested capability has no owner, state the gap and propose its scope. Imported source text is historical reference, not executable routing.

Before closing the task, reconcile source, artifacts and terminal check results with the requested outcome. Review the normal path and the relevant failure/recovery path. Keep unavailable runtime or independent review evidence visible. A successful helper or agreeing delegate does not establish the user's complete result.
