# C5 delivery record

Started 11 October 2026 from main `9c7c3fdb` on `codex/c5-pages-publication`.
Phase: candidate preparation for Test. Owner: Orbyn Builder. Review round: **0/3**.

Complete maintained page bindings/schedules and scoped mentions, publication
consent/revocation, and Slack/Teams channel lifecycle before Test → Review.
Both shared web/desktop and mobile clients are in scope. Keep permission,
revision, human-edit, source-privacy and waiting-reply boundaries intact.

The user explicitly deferred live Slack/Teams workspace checks on 11 October;
implement and verify local contracts without claiming external delivery proof.
C4/D1 browser checks remain production follow-ups, not passes. Production
deployment is user-owned. No C5 acceptance or main delivery yet.

Initial audit: structured Docs bypasses the old editor's maintenance controls;
maintenance persistence and its client store still assume legacy flat content.
Builder is completing format-2 integration before freezing the full candidate.

## Implementation checkpoint — 11 October

- Structured editors now expose page updates and scoped publication on web/mobile.
- New scoped publication path `/s/:token` has explicit selected leaves, snapshot/live
  modes, consent, expiry, revision checks and revocation. Preview, gateway and
  Kubernetes routing added. Legacy publication links remain visible/revocable.
- Sharing store clears private state after account changes; stale requests and
  React effect replay are guarded. Public media reservations cover response delivery.
- Development evidence: workspace typecheck passed before the final media/proxy
  adjustments; shared build and 10 focused publication/maintenance-store unit tests
  passed after those adjustments. These are development checks, not full C5 acceptance.
- Remaining: scoped `@orbyn` comment jobs/replies, database publication and structured
  maintenance regressions, Slack/Teams lifecycle audit/local checks, bounded visuals,
  frozen full-candidate Test → Review, accepted merge/push. Review remains **0/3**.

No C5 commit or merge yet. Preserve live Slack/Teams checks as user-deferred.

## Scoped comment implementation

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

Next: publication DB/anonymous-boundary tests, structured maintenance regressions,
comment endpoint/permissions coverage, Slack/Teams local lifecycle qualification,
then freeze full C5 for Tester and Reviewer. Review counter remains **0/3**.

## Full candidate handoff

The implementation scope above is now present. Checkout:
`/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`, branch
`codex/c5-pages-publication`, base `9c7c3fdb`. The candidate commit is supplied in
the Tester message. No main merge/push or acceptance yet. Earlier “Next” lists
are historical checkpoints; the current next owner is Tester after freeze.

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
