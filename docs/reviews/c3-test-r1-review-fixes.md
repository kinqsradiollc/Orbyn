# C3 Tester retest — Reviewer round 1 fixes

Cycle `C3-agent-platform`, 9 October 2026. This report retests Reviewer findings R1 and R2 against the Builder's frozen correction. It does not claim Reviewer closure, merge, push or deployment.

## Candidate and fixture

- Candidate checkout: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`
- Branch: `codex/c3-agent-platform`
- Exact candidate: `6082b5eacc542c3fb8688e8531a8050fb2afa20f`
- Previous candidate: `7b052a4f3d0d1d70eca431a012b79084ba6b7e34`
- Database: disposable PostgreSQL 17 fixture `orbyn-c3-qa`, database `orbyn_test`, bound to `127.0.0.1:55438`; `current_setting('orbyn.environment')` returned `test`. Test processes used `TEST_DATABASE_URL`. The migration command received `DATABASE_URL` explicitly set to this same marker-checked fixture.
- No product or test source was edited. Candidate checkout remained clean.

The fix changes scheduled Agenda authority checks, reservation accounting, migration 261 and their focused tests. The Agenda path now intersects the Background assistant's current read and effect rules at enqueue and claim/apply, and binds the run to the captured rules revision. The shared budget reservation now subtracts prior segments from the per-run ceiling; maintained-page recovery uses that same path.

## Checks

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm run migrate -w backend` | **PASS** | Marker preflight was `orbyn_test` / `test`; migration `261_agenda_assistant_rules.sql` is recorded, `agenda_summary_runs.assistant_rules_revision` exists, and there are 0 pending candidate migrations. Log: `/tmp/orbyn-c3-r1-reviewfix-migration.log`. |
| `node --import tsx --test --test-concurrency=1 backend/tests/agenda-scheduled-runtime.test.ts backend/tests/assistant-lane-budgets.test.ts backend/tests/maintained-page-runs.test.ts` | **PASS**, 43/43 | Covers Agenda read/effect authority, cumulative job reservations, lower limits, exhausted reservations, concurrent daily claims, and maintained-page recovery. Log: `/tmp/orbyn-c3-r1-reviewfix-focused.log`. |
| `node --import tsx /tmp/orbyn-c3-r1-reviewfix-agenda-phase.mjs` | **PASS**, 2/2 | Effect deny blocked enqueue with 403. Effect ask added after enqueue caused the worker claim to fail as `authority_changed`, with no transport job created before provider dispatch. Log: `/tmp/orbyn-c3-r1-reviewfix-agenda-phase.log`. The verifier is outside the repository; no test file was added or changed. |
| `node --import tsx --test --test-concurrency=1 backend/tests/assistant-process-recovery.test.ts backend/tests/assistant-runtime-lanes.test.ts` | **PASS**, 19/19 | Re-ran all 13 process-recovery cases and 6 runtime-lane cases after changing the shared budget claim path. Log: `/tmp/orbyn-c3-r1-reviewfix-recovery.log`. |
| `npm run typecheck -w backend` | **PASS** | `tsc --noEmit`, exit 0. |
| `git diff --check 7b052a4f3d0d1d70eca431a012b79084ba6b7e34..HEAD` | **PASS** | No whitespace errors. |

## Finding coverage

For **R1**, `agenda-scheduled-runtime.test.ts` passed its read-rule cases: a Background read deny blocks enqueue; a read ask added after enqueue blocks the claim before any provider work. Its pending-inference case changed the Background edit rule to deny after inference began; the signed result was rejected with 409 and the Agenda paragraph stayed unchanged. The inline verifier additionally confirmed that an edit deny blocks enqueue and an edit ask added after enqueue makes the worker claim fail before a transport job/provider dispatch.

For **R2**, the budget tests confirmed that a job's 1,000-token ceiling survives a 600-token settled segment and a subsequent 400-token segment; an exhausted run and a stale estimate cannot reserve more. Lowering a run's limit to 1,000 after 1,200 tokens blocks its next segment. Competing daily claims yielded one 1,000-token reservation and one refusal. Maintained-page reclaim kept the same 1,000-token cumulative ceiling after 600 tokens and refused another segment at exhaustion. The active-reservation settlement/hourly-start test also passed. Process recovery and runtime-lane tests passed with the new claim accounting.

The previous handoff/profile/rule focused evidence, shared-package build, and desktop/mobile typechecks remain applicable where their source is unchanged; this revision changes no core package or client source. The affected Agenda, budget and maintained-page suites were rerun in full, as were process recovery and runtime lanes. The complete 103-test integration group was not rerun as a single command. The scheduled-runtime suite emitted a non-failing node-postgres deprecation warning about a query issued while another query was active; all assertions passed.

**Tester disposition: PASS for R1/R2 retest.** The requested authority phases, cumulative budgets, migration, and backend typecheck are green on `6082b5ea`. The retest evidence is ready for Reviewer closure; the full integration suite and visual/native checks were not rerun.
