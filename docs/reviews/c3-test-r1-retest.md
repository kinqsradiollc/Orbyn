# C3 Tester round 1 retest — 7b052a4f

Cycle `C3-agent-platform`, 9 October 2026. This retest closes the recovery finding from the initial Tester qualification. It is Tester evidence for the revised candidate, not Reviewer acceptance or merge approval.

## Candidate and scope

- Candidate checkout: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`
- Branch: `codex/c3-agent-platform`
- Revised candidate: `7b052a4f3d0d1d70eca431a012b79084ba6b7e34`
- Previous tested candidate: `0287f4fdf47ba6130924c91aa9e5c0e54ffe864a`
- Retest fixture: disposable PostgreSQL 17 fixture `orbyn-c3-qa`, database `orbyn_test`, bound to `127.0.0.1:55438`. The test processes used `TEST_DATABASE_URL` only.
- The candidate diff from the previous revision changes the `run.ts` checkpoint guard and review documentation. No test source changed. The guard now permits a progressed legacy checkpoint with no saved rules revision only when the assistant grant remains at revision 1 with an empty ruleset; edited rules remain fail-closed.

## Checks

| Check                                                             | Result          | Evidence                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged `assistant-process-recovery.test.ts`                    | **PASS**, 13/13 | Covers process replacement, SIGKILL around apply/delegate/specialist receipts, parked questions, Stop, night Review and execution, and separate background/overnight recovery. Log: `/tmp/orbyn-c3-r1-retest-process.log`.                                        |
| Typed change and rules authority suites                           | **PASS**, 29/29 | Ran `assistant-proposal-rules.test.ts` and `assistant-rules.test.ts`. This includes typed changes retaining Background rule evidence, rejection after a rule edit, and waiting approval invalidation after a rule edit. Log: `/tmp/orbyn-c3-r1-retest-rules.log`. |
| `npm run typecheck -w backend`                                    | **PASS**        | `tsc --noEmit`, exit 0.                                                                                                                                                                                                                                           |
| `git diff --check 0287f4fdf47ba6130924c91aa9e5c0e54ffe864a..HEAD` | **PASS**        | No whitespace errors; revised candidate checkout is clean.                                                                                                                                                                                                        |

The earlier C3 focused suite (41/41), package build, and desktop/mobile typechecks remain source-equivalent: the retest commit changed no shared package, client, migration, or test source. The previous wider integration run had 10 failures, all in process recovery; those same recovery cases now pass in the unchanged 13/13 suite. The complete 103-test integration group was not rerun as one command. Its other suites were unchanged, and both rule-authority suites most relevant to the guard change were rerun above.

No product or test source was edited. No visual sweep or native builds were performed.

**Tester disposition: PASS — Test round 1 retest is closed for the recovery finding.** The revised candidate is ready for Reviewer assessment. This does not claim Reviewer acceptance, merge, or delivery.
