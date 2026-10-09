# C2/M1 R1 closure assessment — 9 October 2026

**Decision: changes required; R1 partially resolved. Review remains 1/3.**

Candidate `d45c73d6cfe9acc957bdf782e28d6cdf0bfb93b6`, branch
`codex/c2-chatgpt-completion`, checkout
`/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
Inspected the full delta from `9077d923`, new test assertions, Tester addendum
`docs/reviews/c2-r1-refresh-race-retest-d45c73d6.md` and its three saved logs.
No tests, builds, source edits, visuals or live authorization performed.

## Resolved portion

Heartbeat liveness is now separate in both lifecycle and signer. Its temporary
allowance checks the exact refresh/account/session, retirement bytes/revision,
signing alias, cancellation state and live server connection. Other signing and
credential paths retain strict checks. The new proof barrier exercises the
previously missed post-retirement interval, including the foreground scheduler.
Invalid proof/session tests preserve the failure boundary. This addresses the
specific inference-refresh versus heartbeat interleaving reported earlier.

## Remaining R1 — P2: Other scheduled work still shuts down a valid refresh

Locations: `packages/api-client/src/chatgpt-executor-lifecycle.ts:195`
(`executeNext` initial strict liveness check), its `refreshCatalog` ordered path,
`mobile/src/lib/chatgpt-local-sign-in.ts:1309` (`live`), and
`packages/api-client/src/chatgpt-foreground-runtime.ts:85–103` (fatal handling of
any timer-work rejection).

Deterministic remaining sequence:

1. With an expiring grant and a ready foreground executor, run the 120-second
   catalog tick. Pause refresh-proof verification after retirement is persisted.
2. Run the independent 10-second inference poll. No existing inference need be
   active, so `executing` is false. `executeNext` calls strict `live()` before
   claiming any job. The persisted registration is retired and the heartbeat-only
   allowance does not apply, so it throws.
3. The foreground scheduler catches that rejection, stops the runtime and aborts
   the catalog refresh. A healthy rotation again becomes an unavailable executor
   and potentially a reconnect requirement. This happens even with no queued job.

The reverse ordering also matters: the catalog timer's initial strict check can
fail while inference-triggered refresh is pending. Keeping credentials gated is
correct; treating a known temporary refresh gate as terminal is the defect.
The new scheduler test only starts the inference tick and then the heartbeat
tick, so its success does not cover either catalog/poll overlap.

**Builder correction:** coordinate catalog and claim work with the exact owned
refresh, or explicitly defer that work non-fatally until verification completes.
Do not grant retired credentials inference/catalog authority, broadly suppress
errors, or await the current operation from within its own refresh (deadlock).
Preserve lease maintenance, bounded cancellation and immediate invalidation for
real disconnect/session change or invalid replacement proof.

**Tester verification:** reuse the proof barrier and real foreground scheduler.
Start the catalog tick, reach retirement, run the inference poll, then release
verification. Assert the runtime stays ready, no provider request uses the
retired grant, replacement persists and subsequent work succeeds. Also cover
inference-triggered refresh overlapping the catalog tick, plus cancellation or
invalid proof during that overlap. Avoid holding the barrier while awaiting work
that the corrected implementation deliberately queues behind refresh.

## Evidence and disposition

Saved logs confirm **122/122** native/signing/lifecycle tests, **5/5** foreground
tests and workspace typecheck passed. No backend or migration code changed;
the previous authority/migration assessment remains applicable. The C2 ledger
now records the revised user scope and counter correctly.

Logs read: `/tmp/orbyn-c2-tester-d45c73d6-refresh-lifecycle.log`,
`/tmp/orbyn-c2-tester-d45c73d6-foreground.log`, and
`/tmp/orbyn-c2-tester-d45c73d6-typecheck.log`.

Hosted web sign-in remains deferred. Phone Connect is user-reported; phone-owned
inference remains independently unverified. Further visuals, live authorization
and Android checks remain excluded. Resolve the remaining timer interleaving and
return targeted receipts for same-round closure; this report does not authorize
acceptance or merge. The review counter is not reset or advanced.
