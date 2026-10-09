# C3 Tester retest — R3 queue progress

Cycle `C3-agent-platform`, 9 October 2026. This report retests Reviewer finding R3 against the Builder’s frozen candidate. It does not claim Reviewer closure, merge, push, or deployment.

## Candidate and fixture

- Candidate checkout: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`
- Branch and exact candidate: `codex/c3-agent-platform`, `1fce0b66e441bc5b962ec173e0de2d6efd8b67a0`
- Previous R1/R2 candidate: `6082b5eacc542c3fb8688e8531a8050fb2afa20f`
- The candidate checkout was clean before and after verification. No product or test source was edited for this retest.
- Disposable PostgreSQL fixture: container `orbyn-c3-qa`, database `orbyn_test`, bound to `127.0.0.1:55438`. The server marker returned `test`. Test processes used `TEST_DATABASE_URL`; the migration command received `DATABASE_URL` set explicitly to this same fixture.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run migrate -w backend` | **PASS** | Migration `262_assistant_work_run_history.sql` is recorded. The `assistant_work_job_history`, `assistant_work_page_history`, and `assistant_work_agenda_history` indexes exist. There are 0 pending candidate migrations. |
| `node --import tsx --test --test-concurrency=1 backend/tests/assistant-runtime-lanes.test.ts backend/tests/assistant-lane-budgets.test.ts backend/tests/assistant-process-recovery.test.ts` | **PASS**, 25/25 | All 7 runtime-lane, 5 budget, and 13 process-recovery tests passed against the marked fixture. Log: `/tmp/orbyn-c3-r1-r3-focused.log`. |
| `npm run typecheck -w backend` | **PASS** | `tsc --noEmit`, exit 0. |
| `git diff --check 6082b5eacc542c3fb8688e8531a8050fb2afa20f..HEAD` | **PASS** | No whitespace errors. |

The migration and focused tests ran only against the marked disposable test database. The database verification also confirmed the current name and marker, all three history indexes, migration 262, and an empty pending-migration list.

## R3 verification

The committed runtime-lane regression test starts an older Background or Overnight job with a 2,000-token allowance, requeues it after 1,200 tokens, lowers the owner’s limit to 1,000, then enqueues work for a second owner. Concurrent real `claimAssistantJob` calls claim the later eligible job, a repeated tick returns no claim, and the exhausted row remains queued. Its reservation history stays at one 2,000-token reservation reported as 1,200; no additional reservation is added for the held row. Both lanes pass.

Two temporary verifiers outside the repository cover the additional eligibility paths requested in the review:

- **Checkpoint-only exhaustion:** in both lanes, a queued checkpoint at `LEAD_TOKEN_BUDGET` with no reservation history is skipped. Concurrent claimers advance to a later owner, another tick does not stall, the exhausted row stays queued, and it receives no reservation. Script: `/tmp/orbyn-c3-r1-r3-checkpoint-skip.mjs`.
- **Restored owner limit:** in both lanes, after a 1,200-token segment is held by a 1,000-token cap, raising the cap to 2,000 makes the old job claimable again. The next reservation is 800 tokens, preserving the cumulative 2,000-token ceiling. Script: `/tmp/orbyn-c3-r1-r3-restore-limit.mjs`.

R1 and R2 evidence remains in [the prior Tester report](c3-test-r1-review-fixes.md): 43/43 affected Agenda, budget, and maintained-page tests; 2/2 Agenda authority phases; 19/19 recovery and runtime-lane tests; migration 261; and backend typecheck passed. This candidate changes the claim query, adds migration 262 and its runtime-lane regression, and does not modify those R1/R2 product paths. The full 103-test integration group and visual/native builds were not rerun.

**Tester disposition: PASS for targeted R3 verification.** The queue progresses past checkpoint-exhausted and lowered-cap jobs in both automation lanes, concurrent claimers make progress, and restoring an owner’s limit makes held work eligible again. Evidence is ready for Reviewer follow-up.
