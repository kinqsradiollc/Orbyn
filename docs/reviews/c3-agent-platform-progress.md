# C3 agent platform — candidate handoff

**State:** Whole C3 candidate implemented on `codex/c3-agent-platform` from
main `88b49d88`. Test round 1 found a legacy-checkpoint recovery regression;
Builder has applied a targeted correction and Tester retest passed. Review has not begun and
no C3 code is on main yet.
The user asked to pause the goal after C3 is accepted, merged and pushed.

| Area                | Candidate                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate agents     | Background and Overnight keep independent workers, lane claims, identities, activity and outputs. Profiles now show worker heartbeat status. Background has its own web workspace; web and mobile show compact lane-specific controls.                                                                                                                                                                                 |
| Rules and authority | Owner can edit typed rules in web/mobile Settings with revision guards. Effective read spaces narrow capability context and source reads; pending work rechecks current rule/principal authority. Existing hard stops and approval paths remain.                                                                                                                                                                       |
| Collaboration       | Owner-requested, source-revisioned handoff records are bounded by chain depth/count. Receiving worker rechecks access, rules, provider and budget, then queues distinct source-linked work. Overnight handoffs require the selected window and inherit its deadline. Running work rechecks producer/rules before provider context. Terminal receipts and recipient chats appear in the producing agent's output trail. |
| Work and speed      | Each lane has owner-editable daily estimated-token, hourly start and per-run limits. Serialized reservations cover agent jobs, maintained pages and scheduled Agenda; settlement and stale restart are accounted for. Web/mobile show the same controls. These are estimates, not provider billing.                                                                                                                    |
| Reflection          | Existing explicit-consent Overnight reflection remains source checked and reviewable. No new consent or autonomous action is inferred from handoffs.                                                                                                                                                                                                                                                                   |

## Builder checks

- Fresh disposable PostgreSQL 17 database migrated through the candidate's
  migrations. Focused handoff/profile/rule/budget suites passed **70/70**
  (`40/40` and `30/30`); an additional dispatch rerun passed `3/3` after the
  recipient-chat/profile assertion. Earlier handoff/profile set passed `24/24`.
- Shared packages built; backend, web and mobile typechecks passed after the
  receiving-chat contract. Final backend test-source typecheck passed.
- No visual sweep or separate installed desktop/iOS/Android build was requested
  for this checkpoint. Existing user-confirmed C2/M1 ChatGPT connection is not
  requalified here.

## Qualification handoff

Tester: execute the current candidate's relevant runtime, migration, rule,
budget/recovery and client checks; write an evidence report. Reviewer: inspect
the candidate and Tester's evidence for source authority, state transitions,
budget races, UI contracts and code quality; give Builder a concise fix plan or
accept. Maximum three full review rounds, with earlier acceptance allowed.
Builder owns fixes and main integration. Preserve unrelated changes in the
primary checkout. The disposable fixture `orbyn-c3-qa` on port 55438 belongs to
Builder until qualification is finished.

## Round 1 correction

Tester recorded `41/41` focused checks, all workspace typechecks and a
`93/103` wider integration run in [the report](c3-test-r1.md). Ten failures
were all in legacy process recovery: progressed pre-C3 checkpoints did not
carry a typed-rules revision. The Builder correction lets such a checkpoint
resume only while its rules remain at revision 1 with an empty ruleset;
edited-rule states still hold. The unchanged recovery suite now passes
`13/13` on the corrected candidate. Tester independently confirmed that
result plus `29/29` typed-rule checks and backend typecheck in
[the retest report](c3-test-r1-retest.md). Reviewer assessment remains required.
