# C5 delivery record

## Review handoff — round 1/3

**Current: Builder corrections within round 1/3.** Reviewer requested C5-R1
(pause after human edit) and C5-R2 (withdrawn pre-queue comment quota).
Product source now has uncommitted corrections after `046c0b85`; do not describe
the working tree as frozen. Lifecycle control retains snapshots, cancels active
runs, and requires rebind to resume changed source. Scanner/creation cleanup retires
irreversibly withdrawn comment sources while retaining dedup records and active
runs. Initial correction checks passed 15/15; expanded run-state/parent-thread
checks passed 24/24 and workspace types passed. Revised freeze and Tester retest are next.
Visual Check was told to retain exact served-source provenance during these edits.

Frozen product source remains `046c0b85a56b82966db7f398c63c8537fbb5bea5`.
Tester report: [c5-test-report.md](c5-test-report.md): build/types, existing/fresh
migrations, **471/471** focused contracts and **78/78** structured/docs regressions
passed. Reviewer now owns code and evidence assessment; full review counter **1/3**.
Documentation updates in architecture/setup and tracking reports are uncommitted;
product/test source is unchanged. New Visual Check session
`01a12831-cdc4-7340-8af3-63f2ccf7aafc` is correcting preview provenance and completing
the bounded UI batch. Current internal-browser navigation succeeded; the old saved
Block note is historical, not a newly observed denial. No visual acceptance yet.
Live Slack/Teams delivery remains user-deferred. No main merge/push yet.

Started 11 October 2026 from main `9c7c3fdb` on `codex/c5-pages-publication`.
Phase: **Test**. Frozen full candidate: `046c0b85a56b82966db7f398c63c8537fbb5bea5`.
Tester qualification and bounded Visual Check are dispatched. Review round: **0/3**.

Complete maintained page bindings/schedules and scoped mentions, publication
consent/revocation, and Slack/Teams channel lifecycle before Test → Review.
Both shared web/desktop and mobile clients are in scope. Keep permission,
revision, human-edit, source-privacy and waiting-reply boundaries intact.

The user explicitly deferred live Slack/Teams workspace checks on 11 October;
implement and verify local contracts without claiming external delivery proof.
C4/D1 browser checks remain production follow-ups, not passes. Production
deployment is user-owned. No C5 acceptance, main merge/push or production deployment yet.

Initial audit: structured Docs bypasses the old editor's maintenance controls;
maintenance persistence and its client store still assume legacy flat content.
At that initial audit, format-2 integration was still in progress; it is included
in the frozen candidate described below.

## Earlier implementation checkpoint — superseded by full-candidate handoff

- Structured editors now expose page updates and scoped publication on web/mobile.
- New scoped publication path `/s/:token` has explicit selected leaves, snapshot/live
  modes, consent, expiry, revision checks and revocation. Preview, gateway and
  Kubernetes routing added. Legacy publication links remain visible/revocable.
- Sharing store clears private state after account changes; stale requests and
  React effect replay are guarded. Public media reservations cover response delivery.
- Development evidence: workspace typecheck passed before the final media/proxy
  adjustments; shared build and 10 focused publication/maintenance-store unit tests
  passed after those adjustments. These are development checks, not full C5 acceptance.
- At this checkpoint, scoped `@orbyn` comment jobs/replies and full-candidate
  qualification were still outstanding. The later full-candidate handoff below
  supersedes this interim status.

No accepted main merge/push or deployment. Preserve live Slack/Teams checks as
user-deferred.

## Scoped comment implementation checkpoint

`@orbyn` on the human comment endpoint now creates a one-shot page binding,
using the anchored block (or existing identified page blocks, bounded at 100).
It reuses page provider snapshots, lease fencing, budgets and review decisions.
Only the initiating remark and selected page blocks enter the prompt; unrelated
comments and private internal-link labels are excluded. Replies carry the
assistant grant, deduplicate by originating comment, and never modify page content.
Changed/resolved/deleted comments invalidate work; deleting the origin also removes
its request/reply. Web/mobile page-update review cards can approve a saved reply.

Development evidence (not frozen-candidate qualification):

- Workspace typecheck passed after correcting missing context propagation/types.
- `page-comment-requests.test.ts`: **3/3 passed** on guarded `orbyn_test` at 55434.
  Initial run failed on unsupported COUNT recurrence; corrected to the existing
  schedule schema with explicit one-shot exhaustion, then passed.
- `maintained-page-consumer.test.ts`: **35/35 passed**, including new reply,
  source-change-during-generation and exact saved-review reply cases. Mock local
  HTTP provider; no live vendor qualification claim.

These development suites fed into the full candidate described below; they do not
replace frozen-source Tester qualification or Reviewer acceptance.

## Full candidate handoff

The implementation scope above is now present. Checkout:
`/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`, branch
`codex/c5-pages-publication`, base `9c7c3fdb`. Frozen candidate:
`046c0b85a56b82966db7f398c63c8537fbb5bea5`. Tester qualification and bounded Visual
Check have been dispatched. Review remains **0/3**. There is no accepted main
merge/push or production deployment. The visual report records unavailable
browser-control tooling and no rendered pass; user direction to enable tooling or
defer is pending. Live Slack/Teams workspace checks remain explicitly deferred.

Additional development receipts (not formal acceptance):

- Slack/Teams and agent-channel local suites: **231/231 passed**; live delivery
  remains explicitly deferred by the user.
- Scoped publication database tests: **8/8 passed**, including pinned/live scope,
  expiry, revoke/recreate, private labels, moved pages and current team authority.
- Structured maintenance plus publication tests: **21/21 passed**. The first
  fixture bypassed the structured writer; corrected to use the real writer.
- Media/log/inventory batch: **24/25 passed** initially. The inventory failure
  exposed eight existing unclassified control/credential routes; these were
  classified, and the inventory rerun passed **6/6**. Media includes scoped link
  revocation during a storage fetch and selected-file boundaries.
- Human comment API first-use initially failed because its assistant grant had
  not been initialized. Fixed initialization before page locks to match worker
  lock order. API/service rerun **6/6 passed**; added parent-thread resolution
  regression brings service suite to **4/4 passed**.
- Workspace typecheck passed. Final formatting touched only C5-owned files.
- Mobile selection is bounded to a scrollable checklist. Rendering is not yet
  visually qualified.

### Verification plan

Tester: qualify the frozen full candidate with shared build, types, focused
maintained-page/comment/publication/store/media/log/inventory suites and existing
Slack/Teams/agent-channel contracts. Use guarded `_test` PostgreSQL with test marker;
the owned test service is on port 55434. Apply migrations 263/264 through the normal
runner; also check their fresh-schema behavior. Do not contact live Slack/Teams.
Reports: `docs/reviews/c5-test-report.md`, then `c5-review.md`. Reviewer examines
code and Tester evidence, gives Builder a batched correction plan; no code or test
execution by Reviewer. Maximum three full rounds, currently **0/3**.

Visual Check: one bounded web wide/320px and Expo-web batch for structured-editor
Page updates, comment reply approval, sharing selection/mode/consent/revocation,
and the anonymous read-only viewer. Record exact preview source. Report in
`docs/reviews/c5-visual-report.md`; no native build or broad UI sweep. Honor any
browser permission block without alternate-browser/port bypass.

Known boundaries: legacy whole-page/folder publication remains visible and
revocable, separate from new selected-block links. No live Slack/Teams claim;
production deployment and the earlier C4 production UI follow-up remain user-owned.
