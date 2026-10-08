# Roles and coordination

These roles apply to every contributor and task. People may fill the roles;
agent sessions use the names below. Record current scope/status in the task handoff,
not here. Never infer current work from an old report.

## Who does what

| Role                                  | Owns                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Orbyn Builder — Software Engineer** | Product/test code, fixes, candidate preparation and approved integration.                               |
| **Orbyn Tester**                      | Test execution and results; reports defects without changing source.                                    |
| **Orbyn Reviewer**                    | Code quality, test quality/results and acceptance; gives Builder a fix plan. No coding or tests/builds. |
| **Orbyn Visual Check**                | Requested browser checks and screenshot/findings reports.                                               |
| **Orbyn Stage Tracker**               | Evidence-based status reports; no implementation or stage advancement.                                  |

## Handoff flow

1. **Builder completes the whole agreed scope**, including required states and test prerequisites, then freezes one candidate.
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

## Local QA login permission

The repository owner authorizes signing into disposable local Orbyn QA accounts,
including the Terms/Privacy acceptance on the login form. Permission persists
across sessions, restarts and local web/Expo preview origins. Carry that direct
user authorization into visual handoffs; do not request it again for each port.
Keep credentials in protected fixtures and out of reports. This permission does
not cover production accounts, third-party provider consent, or changed legal
consequences. If a tool still requires fresh consent, record its actual rejection
and ask only for the specific action it blocks; never bypass tool restrictions.

Details: [delivery workflow](../reviews/checkpoint-workflow.md),
[review criteria](review.md), [progress tracking](../reviews/stage-tracker-guide.md),
[development](development.md).
