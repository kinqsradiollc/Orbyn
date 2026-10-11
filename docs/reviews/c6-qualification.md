# C6 qualification handoff

## Candidate and phase

- Scope: complete C6 plugin/backend/host extensions and security checkpoint,
  retaining all required gates. Voice and computer use remain excluded.
- Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
- Branch: `codex/c6-file-viewer`
- Source candidate: `81e4c812`; base `058a63e5`.
- Phase: Test. Next owner: Orbyn Tester. Review counter: **0/3**.
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

Read [progress](c6-progress.md), [serial Builder checks](c6-builder-checks-2026-10-11.md),
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

## Required external/scan gates still open

- Real HTTPS plugin host discovery/OAuth, account switching/reconnect/events,
  composer selection and platform-supported file resource read/save.
- Live managed/BYO provider behavior beyond the local mock upstream.
- Current-source security qualification: prior partial diff scan covers only
  `058a63e5..88f46bb2`. Deep Scan rejoin failed with “Deep Scan cannot safely
  start a read-only worker: the parent must provide a managed filesystem
  permission profile.” No whole-repository completion is claimed.
- Reviewer acceptance (round1/3 after Tester), main integration/push; production
  deployment remains owner-controlled.

Missing external access stays unverified unless the owner explicitly defers it.
Tester should not silently waive these requirements. Builder batches reported
fixes; Reviewer inspects code and test evidence and gives correction guidance,
without coding or running tests.
