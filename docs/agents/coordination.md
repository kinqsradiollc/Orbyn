# Roles and coordination

Use this guide for session ownership. Current stage and delivery live in
[the tracker](../reviews/adr-current-state.md); never infer them from old handoffs.

## Who does what

| Session                               | Responsibility                                                                                                                         | Boundary                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Orbyn Builder — Software Engineer** | Implement the complete checkpoint, write product/tests, fix findings, prepare the candidate and integrate approved work.               | Owns source changes; does not approve its own checkpoint.                                                  |
| **Orbyn Tester**                      | Run appropriate tests/builds/runtime checks on the frozen candidate; report results and defects; retest fixes.                         | Does not change product or test source.                                                                    |
| **Orbyn Reviewer**                    | Review code quality, correctness, ADR coverage, test code and Tester evidence. Give Builder a prioritized fix plan and final decision. | Review only: no coding, test execution or builds. See [review guide](review.md).                           |
| **Orbyn Visual Check**                | Inspect requested browser flows and write screenshot/findings evidence.                                                                | Only bounded checks requested for a concrete visual risk.                                                  |
| **Orbyn Stage Tracker**               | Report current stage and remaining work from durable evidence.                                                                         | Does not implement, test, merge or advance stages. See [tracker guide](../reviews/stage-tracker-guide.md). |

## Handoff flow

1. **Builder completes the whole checkpoint**, including required states and test prerequisites, then freezes one candidate.
2. **Tester qualifies that candidate** and writes a Markdown report.
3. **Reviewer assesses code and test evidence**, then approves or gives Builder actionable findings.
4. **Builder batches all fixes → Tester retests affected behavior → Reviewer closes findings.**
5. **Builder merges/pushes accepted work** and updates the tracker. Production deployment is user-owned.

Maximum **3 full review rounds**, with earlier approval allowed. Record the cycle,
candidate and counter; verified closure can finish the same round. Never reset the
counter or start a fourth round. Unresolved findings stay open.

## Coordination rules

- Handoffs name scope, checkout/branch/commit, reports, remaining gates and next owner.
- One writer and one QA fixture owner at a time. Preserve unrelated work.
- Use web preview for shared web/desktop UI and **Expo web** for mobile UI.
  Follow [UI/UX rules](ui-ux.md) for current exclusions and visual cadence.
- Request visuals through **Orbyn Visual Check** for material UI changes, reproduced
  defects or explicit user checks. Reuse valid evidence; no automatic sweep per edit.
- Builder updates status at transitions; Tracker owns routine status tables.
  Builder still answers direct user questions and provides pause/completion handoffs.
- Message sessions only with direct user authorization. Respect explicit scope and pauses.

Details: [checkpoint workflow](../reviews/checkpoint-workflow.md),
[execution order](../reviews/adr-execution-order.md), [development](development.md).
