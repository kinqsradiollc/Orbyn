# C2/M1 Reviewer-round-1 retest — b7b05211

Cycle `C2-full-2026-10-08`, 9 October 2026. This addendum retests the catalog /
inference-poll overlap in the native token-refresh race found in Reviewer round

1. It does not start a new review round.

## Candidate and assertion review

- Checkout: `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`
- Branch: `codex/c2-chatgpt-completion`
- Frozen candidate: `b7b05211dd9c32a5b806324a7c0c1849f11e7135`
- Parent: `d45c73d6cfe9acc957bdf782e28d6cdf0bfb93b6`
- Earlier Tester reports remain intact: the [initial qualification](c2-full-2026-10-09-tester-eec23da9.md)
  and [refresh-race retest](c2-r1-refresh-race-retest-d45c73d6.md).

The candidate adds a typed `ChatgptRefreshPendingError` for the exact retired-
token refresh window. The foreground scheduler defers that task and retries it
after 3 seconds; other errors still stop the runtime. I inspected the assertions
that block refresh-proof verification while ordering catalog→poll and
inference→catalog timers, verify the executor remains ready and resumes after
the retry, and reject invalid proof or session replacement.

## Checks

| Command                                                                                                                                       | Result                                                                                  | Log                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `npx tsx --test --test-concurrency=1 backend/tests/chatgpt-native-sign-in.unit.test.ts backend/tests/chatgpt-foreground-runtime.unit.test.ts` | **PASS**, 107/107; 0 failures, skips, or cancellations; exit 0; 7.7 s.                  | `/tmp/orbyn-c2-tester-b7b05211-refresh-scheduler.log` |
| `npm run typecheck`                                                                                                                           | **PASS**, exit 0; rebuilt shared packages and typechecked backend, desktop, and mobile. | `/tmp/orbyn-c2-tester-b7b05211-typecheck.log`         |
| `git diff --check d45c73d6..HEAD`                                                                                                             | **PASS**, exit 0.                                                                       | Terminal receipt from this run                        |

The 107-test run passed the four targeted cases: inference→catalog timer
ordering, catalog→poll ordering, invalid refresh proof, and changed session.
The `chatgpt-executor-signing` and `chatgpt-executor-lifecycle` files did not
change in this candidate; their 122/122 result on `d45c73d6` remains applicable
and is recorded in the [prior race retest](c2-r1-refresh-race-retest-d45c73d6.md).
No backend or migration code changed, so no database rerun was needed.

**Tester disposition:** affected native refresh and foreground-scheduler checks
pass on `b7b05211`; workspace typecheck passes. No live ChatGPT authorization,
visual check, Android verification, or full-suite run was performed. Hosted web
sign-in remains deferred, and phone executor enrollment and phone-owned inference
are not independently claimed. This is Tester evidence, not Reviewer acceptance
or merge.
