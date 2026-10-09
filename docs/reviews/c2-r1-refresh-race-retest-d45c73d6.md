# C2/M1 Reviewer-round-1 retest — d45c73d6

Cycle `C2-full-2026-10-08`, 9 October 2026. This addendum retests the native
token-refresh/lease-heartbeat race found in Reviewer round 1. It does not start a
new review round.

## Candidate and assertion review

- Checkout: `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`
- Branch: `codex/c2-chatgpt-completion`
- Frozen candidate: `d45c73d6cfe9acc957bdf782e28d6cdf0bfb93b6`
- Parent: `9077d92391168dfab2493fbbd228ec4959f20801`
- The existing [Tester report](c2-full-2026-10-09-tester-eec23da9.md) remains
  intact.

The patch limits retired-token heartbeat allowance to the exact refresh in
progress, gives lease renewal a separate live-connection check, and routes
heartbeat signing through that check. New assertions block refresh-proof
verification while exercising heartbeats, verify inference uses the rotated
grant only after refresh completes, keep the foreground scheduler ready during
the overlap, and reject invalid refresh proof or session replacement.

## Checks

| Command                                                                                                                                                                                           | Result                                                                                  | Log                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `npx tsx --test --test-concurrency=1 backend/tests/chatgpt-native-sign-in.unit.test.ts backend/tests/chatgpt-executor-signing.unit.test.ts backend/tests/chatgpt-executor-lifecycle.unit.test.ts` | **PASS**, 122/122; 0 failures, skips, or cancellations; exit 0; 8.2 s.                  | `/tmp/orbyn-c2-tester-d45c73d6-refresh-lifecycle.log` |
| `npx tsx --test --test-concurrency=1 backend/tests/chatgpt-foreground-runtime.unit.test.ts`                                                                                                       | **PASS**, 5/5; 0 failures, skips, or cancellations; exit 0; 0.4 s.                      | `/tmp/orbyn-c2-tester-d45c73d6-foreground.log`        |
| `npm run typecheck`                                                                                                                                                                               | **PASS**, exit 0; rebuilt shared packages and typechecked backend, desktop, and mobile. | `/tmp/orbyn-c2-tester-d45c73d6-typecheck.log`         |
| `git diff --check 9077d923..HEAD`                                                                                                                                                                 | **PASS**, exit 0.                                                                       | Terminal receipt from this run                        |

The focused native suite includes the new cases “inference refresh keeps lease
heartbeats live after token retirement,” “foreground scheduler stays ready when
a lease heartbeat overlaps native refresh verification,” and “invalid refresh
proof or changed session cannot keep a retired native executor live”; all passed.
No backend or migration code changed in this race fix, so no database rerun was
needed.

**Tester disposition:** the affected refresh, signing, lifecycle, and foreground
scheduler checks pass on `d45c73d6`. No live ChatGPT authorization, visual check,
Android verification, or full-suite run was performed. Hosted web sign-in remains
deferred; phone executor enrollment and phone-owned inference are not independently
claimed. This is Tester evidence, not Reviewer acceptance or merge.
