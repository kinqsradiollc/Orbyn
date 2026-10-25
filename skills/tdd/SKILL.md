---
name: tdd
description: "Design focused contract tests or a failing-before regression when the user requests testing or TDD; select practical boundaries, fixtures and evidence within the requested execution scope."
---

# Tdd

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Respect verification authorization in AGENTS.md. This skill does not itself
permit tests excluded by the current user or session.

Identify the smallest observable contract. Reproduce the defect in a test at its
owning boundary, run it before the fix and check it fails for the intended reason.
Make the production correction, then rerun that check and relevant adjacent cases.
Do not test a copy of the implementation or weaken assertions to obtain green.
Use the [reproduction contract](../how/references/reproduction.md) for baseline,
fixture and runner discovery. Confirm the intended test actually ran; zero
selected tests, an unrelated setup error or a skipped mode is not regression proof.

If the practical test requires unrelated harness churn or unrealistic mocks,
explain the limitation and use the closest authorized evidence. Retain failing
attempts. A passing new test without a demonstrated baseline failure provides
less regression evidence; state that distinction. No production databases or
unapproved live-provider calls. Read [development](../../docs/agents/development.md)
for guarded database and package prerequisites.

## Regression evidence across layers

Test observable contracts at real effect/adaptor boundaries. Keep mocks focused
on unavailable effects rather than private helper choreography. Build and verify
one failing contract at a time, then extend from observed behavior; do not write
a speculative batch before confirming that the first signal catches the defect.
An internal reorganization should preserve useful behavior tests.

For a stale update, place the regression at the API/version boundary and assert that the rejected write preserves the original record. A snapshot of the error string alone does not prove the invariant. Add a UI check only when the changed user flow needs separate evidence and that check is authorized.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.

## Choose a useful strategy

For requested test design, use [test strategy](references/test-strategy.md) to select the real boundary, fixtures, failure controls and execution scope. A plan can be the requested output; this skill does not turn every test request into mandatory production edits.
