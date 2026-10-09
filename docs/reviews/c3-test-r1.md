# C3 Tester qualification — round 1

Cycle `C3-agent-platform`, 9 October 2026. This report qualifies the frozen C3 candidate against the handoff/runtime scope. It records the exact candidate results, including the process-recovery failures; it is not Reviewer acceptance or merge approval.

## Candidate and scope

- Candidate checkout: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`
- Branch: `codex/c3-agent-platform`
- Frozen candidate: `0287f4fdf47ba6130924c91aa9e5c0e54ffe864a`
- Base: `88b49d8810974bbcfefd1f44e9477f8c81734972`
- Tester report checkout: `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`, branch `codex/c2-chatgpt-completion`
- Database: disposable PostgreSQL 17 fixture `orbyn-c3-qa`, database `orbyn_test`, bound to `127.0.0.1:55438`; the database marker is `orbyn.environment=test`. Test processes received the connection through `TEST_DATABASE_URL` only. The setup warning about `DATABASE_URL` in `.env` was informational; tests used `TEST_DATABASE_URL`.
- Covered rules/authority, handoff dispatch and recovery, lane budgets, profiles, scheduled runtime, and shared client contracts. Visual review and standalone desktop/iOS/Android builds were excluded by the handoff.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run build:packages` | **PASS** | Shared packages built on the candidate. |
| `npm run typecheck -w backend`, `-w desktop`, `-w mobile` | **PASS** | All three TypeScript checks completed successfully. |
| `git diff --check 88b49d8810974bbcfefd1f44e9477f8c81734972..HEAD` | **PASS** | No whitespace errors; candidate checkout remained clean. |
| C3 handoff/rules/budget/profile focused test group | **PASS**, 41/41 | Eight suites: `assistant-handoff-dispatch`, `assistant-handoff-requests`, `assistant-handoff-storage`, `assistant-handoffs.unit`, `assistant-lane-budgets`, `assistant-profiles-client.unit`, `assistant-profiles`, and `assistant-read-rules.unit`. Log: `/tmp/orbyn-c3-r1-core-tests.log`. |
| Runtime/authority/scheduled integration group | **FAIL**, 93/103 | Nine suites, including rules, replay authority, proposal rules, runtime lanes, night window, process recovery, polling recovery, night budget, and scheduled agenda runtime. All 10 failures were in `assistant-process-recovery.test.ts`; other suites passed. Log: `/tmp/orbyn-c3-r1-integration-tests.log`. |
| `assistant-process-recovery.test.ts` alone | **FAIL**, 3/13 passed | The same 10 cases failed on an isolated rerun, so the failure is not caused by ordering with the other integration files. |

The failed process-recovery cases were: post-apply SIGKILL receipt recovery; night work/Review behavior; parked-question recovery; Stop from another API process; full-trust night event staging; night planning; large private-addition Review behavior; and the specialist-receipt, delegate-receipt, and separate background/overnight recovery cases.

A temporary diagnostic copy of the test file set `assistant_rules_revision = 1` on each test checkpoint at enqueue. All 10 failing cases then passed across three focused runs. The diagnostic copy was removed, and neither candidate source nor its test files were changed. The frozen tests currently omit this new revision field when creating checkpoints; some cases also mutate the checkpoint directly into progressed state. The candidate rejects progressed checkpoints without a saved rules revision, so the failure is sensitive to this new checkpoint contract. This isolates the discrepancy to revision metadata, but does not decide whether the production enqueue path or only these test fixtures should stamp it. Keep the unmodified process-recovery suite as a qualification gate until that contract is resolved and the suite passes without diagnostic changes.

The focused C3 tests cover handoff provenance, distinct receiving work, bounded retries/chains, source freshness, consent windows, lane budget reservations and stale revisions, idle/working/recovery profile states, and read-rule ask/deny behavior. Those cases passed. No product source or test-source edits were made. No visual review or native builds were performed.

**Tester disposition: HOLD.** The C3-specific focused suite, package build, and backend/desktop/mobile typechecks pass. The exact frozen candidate’s integration suite is not green because its process-recovery suite has 10 reproducible failures tied to the new rules-revision checkpoint field. Resolve the queue/checkpoint contract or update the fixtures, then rerun the unchanged process-recovery suite before calling this candidate qualified.
