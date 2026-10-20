---
name: tdd
description: "Write a focused failing-before regression and fix when the user requests TDD or testing and the affected behavior has a practical test boundary."
---

# Tdd

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Respect verification authorization in AGENTS.md. This skill does not itself
permit tests excluded by the current user or session.

Identify the smallest observable contract. Reproduce the defect in a test at its
owning boundary, run it before the fix and check it fails for the intended reason.
Make the production correction, then rerun that check and relevant adjacent cases.
Do not test a copy of the implementation or weaken assertions to obtain green.

If the practical test requires unrelated harness churn or unrealistic mocks,
explain the limitation and use the closest authorized evidence. Retain failing
attempts. A passing new test without a demonstrated baseline failure provides
less regression evidence; state that distinction. No production databases or
unapproved live-provider calls. Read [development](../../docs/agents/development.md)
for guarded database and package prerequisites.
