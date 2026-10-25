# Match responsibility to the work

Junior, senior and staff are organization-specific roles, not separate skill
catalogs or quality settings. Keep correctness, authority, evidence and respectful
communication at every level. Choose scope from the task and the person's needs;
never infer their seniority or evaluate an employee from a code sample.

| Responsibility | Useful method and result |
| --- | --- |
| Bounded contribution / onboarding | Trace one entrypoint, locate local instructions/runner, complete a small vertical change, explain its invariant and evidence; name the next concrete question when blocked |
| Team-level ownership | Resolve ambiguity, coordinate the changed contracts, select relevant failure/control checks and take the feature through review and operational handoff |
| Cross-team / staff scope | Compare investment alternatives, settle ownership and interfaces with actual decision makers, pilot adoption, sequence independent releases and build capability others can maintain |

Use [how](../../how/SKILL.md), [language guidance](../../language-best-practices/SKILL.md)
and [test strategy](../../tdd/references/test-strategy.md) for execution; use
[planning strategy](../../orbyn-plan/references/technical-strategy.md) and
[large changes](../../architect/references/large-changes.md) for broader scope.
Do not turn an onboarding question into a rewrite, or describe a cross-team
migration as completed merely because one package compiles.

## Onboarding and review that transfer understanding

For an unfamiliar repository, establish a working local path with its documented
runner and a representative bounded change. Explain the nearest relevant owner,
inputs, output and one failure boundary. When coaching is requested, explain the
reason, a small example and a check the learner can interpret; avoid taking over
an exercise when the user asked for guidance. When implementation is requested,
complete it instead of assigning the human a chain of agent commands.

For ordinary review, inspect the actual diff and affected callers. Separate a
correctness/contract defect from a question, optional improvement or formatting
preference. Each blocking finding needs location, triggering state, impact and a
correction direction; acknowledge uncertainty. Give feedback about the change,
not the author. Keep unrelated improvements outside the patch. Automated changes
still need meaningful review of the changed contract. Use `interrogate` only for
a requested adversarial challenge or concrete unresolved risk.

Leave the rationale where the next maintainer needs it: existing code comments,
API docs, design decision or example. Do not copy private history into this public
library. A walkthrough by an agent is not independent human review or evidence of
learning. State what was checked and what the recipient must still validate.

Background, reviewed 25 October 2026:
[GitLab associate](https://handbook.gitlab.com/job-description-library/engineering/development/backend/associate/),
[senior](https://handbook.gitlab.com/job-description-library/engineering/development/backend/senior/),
[staff](https://handbook.gitlab.com/job-description-library/engineering/development/backend/staff/),
and [Google code review](https://abseil.io/resources/swe-book/html/ch09.html).
This is an independently authored scope guide, not certification of a job level.
