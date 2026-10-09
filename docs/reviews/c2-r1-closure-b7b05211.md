# C2/M1 acceptance — 9 October 2026

**Decision: approve the agreed revised C2/M1 scope. R1 closed in round 1/3.**

Accepted candidate: `b7b05211dd9c32a5b806324a7c0c1849f11e7135`, branch
`codex/c2-chatgpt-completion`, checkout
`/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.

Reviewed the delta from `d45c73d6`, both overlap test assertions and Tester report
`docs/reviews/c2-r1-catalog-poll-overlap-retest-b7b05211.md`. This closes the
remaining finding in `c2-r1-closure-d45c73d6.md`; earlier reports remain historical.

The native liveness check now signals a typed temporary condition only for the
exact active refresh and matching retired record. Scheduled work defers for three
seconds instead of stopping the executor. Other errors remain fatal. The pending
branch grants no catalog, inference or credential access; heartbeat retains its
separate owned-session check. Once refresh ends or fails, the temporary exception
no longer applies. Cancellation and session invalidation remain enforced.

The proof-barrier tests now cover both catalog→inference-poll and
inference→catalog orderings through the foreground scheduler, including the retry.
They assert continued readiness and resumed inference after verification; the
catalog-first case also asserts no response while the grant is retired and
durable replacement afterward. Earlier invalid-proof/session and heartbeat
coverage remains. No remaining actionable blocker was identified in this closure.

## Evidence and limits

- Tester **107/107 native/foreground tests passed**, zero failures/skips/
  cancellations; saved summary inspected at
  `/tmp/orbyn-c2-tester-b7b05211-refresh-scheduler.log`.
- Workspace typecheck passed; saved log inspected at
  `/tmp/orbyn-c2-tester-b7b05211-typecheck.log`.
- Earlier signing/lifecycle and backend authority/migration receipts remain
  applicable to their unchanged source. These overlapping cohorts are not a new
  combined full-suite run. The original harness failure remains documented.
- Reviewer ran no tests/builds, edited no source, and performed no visuals or
  live account authorization.

Acceptance follows the recorded user scope: independent hosted web sign-in is
deferred; phone Connect is user-reported; phone executor enrollment and phone-owned
inference remain independently unverified. Repeat live authorization, further
visuals and Android verification are excluded, not passed. This acceptance does
not establish production readiness beyond the recorded scope or provider eligibility
for hosted execution.

Builder may proceed with the separately user-authorized main integration/push,
preserving the accepted source and review/Tester records. No additional CI wait
is imposed by this decision. Merge, push and production deployment have not been
performed or verified by Reviewer. Final review counter: **1/3**.
