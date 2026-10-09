# C2/M1 review — round 1/3

**Decision: changes required.** One actionable product finding, R1 below.

Reviewed candidate `9077d92391168dfab2493fbbd228ec4959f20801` on
`codex/c2-chatgpt-completion` in
`/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
Tester input: `docs/reviews/c2-full-2026-10-09-tester-eec23da9.md` in that checkout.
Reviewer inspected source, test assertions and saved terminal logs; no tests,
builds, visual checks or product/test edits were performed.

## R1 — P2: Successful token rotation can stop the native executor

**Locations:** `mobile/src/lib/chatgpt-local-sign-in.ts:817–828` and
`:1306–1324`; `packages/api-client/src/chatgpt-foreground-runtime.ts:85–103`.

The refresh correction writes a version2 retired registration with `grant:null`
before awaiting identity verification and the live-connection lookup. During
that legitimate interval, `decodeRegistration()` returns null. The executor's
`live()` therefore rejects its own unchanged account as disconnected.

Concrete interleaving: an inference claim calls the native adapter, which refreshes
an expiring grant through `readNativeChatgptModels()`. After the provider returns
replacement tokens and retirement is saved, pause backend refresh-proof validation
or the subsequent connection lookup. The independent heartbeat timer runs, calls
`live()`, sees the retired record and throws. The foreground scheduler responds by
closing the executor and aborting its lifetime, which also cancels the otherwise
valid refresh. The device becomes unavailable and can be left requiring reconnect.
Inference uses the separate bounded path, so the ordered catalog/heartbeat queue
does not prevent this interleaving.

**Expected:** retiring a consumed token must prevent its reuse without treating
an exact-owner refresh in progress as a revoked identity. A valid replacement
should complete without a spurious heartbeat failure or runtime shutdown. Actual
disconnect, session replacement, mismatched identity and terminal refresh failure
must still invalidate execution.

**Builder correction:** model refresh-in-progress separately from terminal
retirement, tied to the exact user/session, account key, registration and refresh
revision. Either permit bounded lease maintenance against that verified identity
while credentials remain unusable, or coordinate dependent work with refresh
completion without blocking the refresh on itself or starving lease renewal.
Keep inference/token access gated until replacement verification completes.
Preserve conditional retirement and never restore the consumed token. Do not
solve this by suppressing all heartbeat errors or accepting arbitrary retired
records as live.

**Tester verification:** add a deterministic barrier after the retirement write,
before refresh verification completes. Exercise inference-triggered refresh plus
heartbeat and the foreground scheduler; release the barrier and assert the
runtime stays usable, replacement credentials persist and no old token is reused.
Also assert actual disconnect/session replacement still stops it and invalid
replacement proof still requires recovery. The current test at
`backend/tests/chatgpt-native-sign-in.unit.test.ts:1137` blocks `onRefresh` before
the provider returns, then releases it before the next heartbeat. Its green
result does not cover the retired-record window.

## Other reviewed boundaries

- Earlier identity-only retention and explicit consent findings are addressed in
  native account persistence/selection and both authorization builders. The token
  rollback correction addresses consumed-token restoration but introduces R1.
- Enrollment retains owned live-session checks, exact-session one-use challenges,
  key fingerprints and enrollment epochs. Inference completion checks the owned
  executor, request hash/nonce/model, provider-choice version, lease/enrollment
  epochs and signature before publishing completion and usage.
- Device type/name are app-reported display metadata, not hardware attestation.
  Discovery is owner-scoped; detailed fields are opt-in for compatibility.
  Completion labels obtain device metadata through the accepted executor ID,
  not arbitrary result text. This supports attribution to the registered executor;
  it does not independently prove execution on a physical phone or provider-side
  inference. No additional authority blocker identified in this path.
- Migration253 preserves existing Ed25519 key forms and adds P-256 forms; server
  parsing still enforces canonical DER and curve before proof acceptance.
  Migration254 adds nullable paired display fields, preserving legacy rows as
  unknown. No data rewrite or destructive row operation was identified. Production
  migration/deployment is not established by these checks.

## Evidence and scope

Saved log summaries agree with Tester: original focused run **461/559 passed**,
with all 98 failures caused by the missing `./device` VM resolver; corrected
candidate **98/98 native tests** and **102/102 targeted database/authority tests**
passed, zero skips/failures. The parent-to-candidate diff is only the 10-line
harness fix plus device metadata assertions, so retained product typecheck and
unaffected passing cohorts apply. Counts overlap and must not be added as a new
single suite result.

Reviewed logs: `/tmp/orbyn-c2-tester-eec23da9-focused.log`,
`/tmp/orbyn-c2-tester-eec23da9-typecheck.log`,
`/tmp/orbyn-c2-tester-eec23da9-migration-253.log`,
`/tmp/orbyn-c2-tester-9077d923-native-signin.log`, and
`/tmp/orbyn-c2-tester-9077d923-db-regressions.log`.
The migration253 receipt is an actual SQL compatibility probe; the targeted
database cohort used the guarded in-memory database. Full `npm test` was not run.
Web/iOS build success remains Builder-supplied evidence, not independently rerun
by Reviewer. The initial failed harness run remains part of the record.

Per this handoff's user disposition, standalone hosted sign-in is deferred;
another live authorization, further visuals and Android verification are excluded.
User-reported native Connect success is retained as human evidence. Phone executor
enrollment and phone-owned inference remain independently unverified; an older
desktop executor in the fixture does not prove either. None is relabeled a pass.

Builder should append the current scope disposition to the C2 ledger, whose last
historical section still says hosted access blocks freeze, and batch R1's fix.
Tester should rerun the affected lifecycle/concurrency coverage, then return the
diff and receipts for same-round closure where appropriate. Counter remains
**1/3**, not reset. No merge/push acceptance or production deployment is granted
by this report.
