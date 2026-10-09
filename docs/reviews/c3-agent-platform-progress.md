# C3 agent platform — candidate handoff

**State:** Whole C3 candidate implemented on `codex/c3-agent-platform` from
main `88b49d88`. Test round 1 found a legacy-checkpoint recovery regression;
Builder corrected it and Tester retest passed. Reviewer round 1 found two more
gaps; Builder corrected them and Tester retest passed. Reviewer closed those
findings but found a queue-progress edge case (R3); Builder corrected it,
pending Tester retest and Reviewer closure.
No C3 code is on main yet.
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

## Review round 1 corrections

[Reviewer round 1](c3-review-r1.md) found that scheduled Agenda summaries did
not intersect current Background read/effect rules, and recovery could refresh
the advertised per-run token limit. Builder now captures and rechecks the
Background rule revision and source-space access through enqueue, provider
dispatch and result application. Existing queued summaries lacking captured
rule evidence fail closed. Per-run reservations count all earlier segments;
lowered limits take effect before the next segment. The same reservation path
serves jobs and maintained pages. Builder's focused Agenda, budget and page
run suites passed **42/42** after these changes; the subsequent budget-only
concurrency and lowered-limit additions passed **5/5**. [Tester retest](c3-test-r1-review-fixes.md)
passed **43/43** affected suites, **19/19** recovery/lane checks and **2/2**
extra Agenda authority phases, plus migration 261 and backend typecheck.
Reviewer closed R1/R2; the queue-progress R3 finding remains pending.

## Queue-progress correction

[Reviewer correction review](c3-review-r1-closure.md) closed R1/R2 and found
that an exhausted oldest job could block later owners' work. The Background
and Overnight claim query now skips jobs with no cumulative per-run or
original-request capacity; a later owner can be claimed, and the held job
becomes eligible again if its owner raises the limit. Builder's two-owner,
both-lane and competing-claimer check plus existing budget/lane suites passed
**12/12**. [Tester retest](c3-test-r1-r3.md) passed **25/25** budget/lane/recovery
cases, migration 262, backend typecheck, and extra checks for checkpoint-only
exhaustion and restored eligibility after raising the cap in both lanes.
Reviewer closure of R3 remains pending in round 1/3.
