# C6 qualification handoff

## Candidate and phase

- Scope: complete C6 plugin/backend/host extensions and security checkpoint,
  retaining all required gates. Voice and computer use remain excluded.
- Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
- Branch: `codex/c6-file-viewer`
- Source candidate: `dc094b4b` (round 1 corrections and env templates), superseding `4da327dc` and `81e4c812`; base `058a63e5`.
- Phase: affected Tester retest, then same-round Reviewer closure. Review counter: **1/3**.
- No main merge, push, deployment or full completion is claimed.

## Implementation to qualify

Private opt-in plugin Compose process/gateway and deployment sequencing;
independent recipient-bound OAuth/principal; shared capabilities and scoped UI
resources; bounded launch context/import jobs/reconnect cursors; separately
consented managed/BYO inference with pinned provider/model/limits and uncertain
outcome handling; user-click Today sidebar; host Markdown source read/edit with
ETag save/conflict/reload guards; scoped title/link composer mentions.

The owner explicitly authorized composer title/link sharing on 11 October 2026.
Full item contents remain excluded. Mention visibility follows the connection’s
search capability and UI opt-in. Host-supplied account/scope/path fields cannot
select authority. Read-only Markdown resources cannot be saved; oversized source
is bounded. This file source editor is not D1’s rendered Mermaid preview.

## Evidence and proportionate checks

Read [saved-finding remediation](security-remediation-2026-10-11.md), [progress](c6-progress.md), [serial Builder checks](c6-builder-checks-2026-10-11.md),
[security boundaries](c6-security-boundary.md), [Today visuals](c6-visual-report.md)
and [file visuals](c6-markdown-file-visual.md). Verify source/dependency equivalence
before retaining results. The serial 123-test run applies to `55e94ca5`;
follow-up service16/16 + protocol11/11 and backend typecheck apply to `81e4c812`.
Do not sum overlapping runs or infer broad coverage from narrow assertions.

Tester chooses affected checks and build/runtime smoke proportionate to the
complete candidate. Use marked disposable `_test` databases, run provider-setting
suites serially, protect secrets and preserve other sessions’ fixtures. Report
commands, candidate, exits, assertions, failures and unverified requirements in
`docs/reviews/c6-tester-report.md`. Do not edit source. No new visual sweep or
native build is requested; retain delegated synthetic evidence with its limits.

## Required external gates still open

- Real HTTPS plugin host discovery/OAuth, account switching/reconnect/events,
  composer selection and platform-supported file resource read/save.
- Live managed/BYO provider behavior beyond the local mock upstream.
- The owner canceled the current scan and prohibits further Codex Security scans
  unless explicitly requested. Saved findings are handled through
  [remediation](security-remediation-2026-10-11.md), focused checks and code review;
  a replacement scan is no longer a required automatic gate.
- Reviewer acceptance (round1/3 after Tester), main integration/push; production
  deployment remains owner-controlled.

Missing external access stays unverified unless the owner explicitly defers it.
Tester should not silently waive these requirements. Builder batches reported
fixes; Reviewer inspects code and test evidence and gives correction guidance,
without coding or running tests.

## Formal review round 1 — remediation candidate

Source `4da327dc`; docs freeze `462ac8db`. Tester’s
[focused report](security-remediation-tester-2026-10-11.md) records 218/218,
backend types/builds and configuration checks. Reviewer assesses the saved-finding
fixes and affected C6 authority contracts against this source, without code edits,
tests/builds or scans. This is the first formal round; prior bounded remediation
patch closure is source investigation, not full C6 acceptance. External gates
above remain explicit. Maximum three formal rounds; same-round closure allowed.

## Current correction handoff

Frozen `dc094b4b` addresses SR-R1/SR-E1, as recorded in the remediation ledger.
Tester requalifies only affected upgrade, deploy-ordering, real SSE and OAuth
paths plus configuration/types. Reviewer closes the original round after that
report. Environment template parity is included; private env files remain local
and uncommitted. Do not infer full C6 or production readiness from this subset.

### Latest same-round correction freeze

Candidate `937cb16f` fixes the fresh-database SSE cursor fixture and prevents
legacy decryption from recreating a retired credential key. Builder affected
checks: 6/6 and backend types pass. Tester is assigned a fresh marked database
retest of live revocation, secret retirement, secrets-db and secret upgrade, plus
backend types. Retain the earlier 37/38 result and failed fixture in the report;
reuse unaffected OAuth/deploy/config evidence only with source equivalence.
Reviewer closure remains round 1/3.

The owner is considering real-host testing through the production plugin
endpoint. Follow [production-host test](../plugin-production-test.md) after
accepted code is merged and the owner deploys. No installed plugin, active public
endpoint, production deployment or completed real-host acceptance is claimed.

## Accepted local production-test checkpoint — 11 October 2026

Reviewer accepted runtime `937cb16f` and documentation/templates through
`b607e1dc` for main integration in round 1/3. SR-R1 and SR-E1 are closed.
Fresh Tester checks: 6/6 and backend types; retained unchanged-source receipts:
OAuth33/33 and deploy cutover2/2, not summed. Reports retain the prior fixture
failure and recovery limits.

This qualifies the local code/remediation checkpoint for the owner’s production
plugin test. Full C6 real-host acceptance stays open; deployment, real HTTPS
OAuth/account switching, host files/composer and live providers are not proven.
No Codex Security scan or automatic public plugin publication is required.
