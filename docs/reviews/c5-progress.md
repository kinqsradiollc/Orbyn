# C5 delivery record

## Final handoff — accepted and pushed; production pending

**Accepted candidate:** `bbb7f28d0eb55b27ae1d8fea4b50c717b96b9dc5` on `codex/c5-pages-publication`, based on main
`9c7c3fdb`. Reviewer accepted C5 in round **1/3** under the agreed scope; R1, R2,
C5-VIS-001 and C5-E1 are closed. C5 was fast-forward pushed to remote `main`:
`9c7c3fdb..392f24450dbc361740376c3095602c246e5c4681` (`git push origin HEAD:main`, exit 0). Production has not
been deployed.

Tester evidence is incremental by candidate: baseline `046c0b85` build/workspace
types/migrations and **471/471** focused plus **78/78** structured/docs tests;
**88/88** on `dc75c780`; **9/9** on `7f7bc08f`; **11/11** plus api-client build on
`d416d6bb`; mobile typecheck on `82dee01b`; **10/10** plus api-client build on
`a713bfbd`; and desktop/mobile typechecks on `bbb7f28d`. No final full-backend
suite rerun is claimed. See [Tester evidence](c5-test-report.md) for candidate-specific
scope and receipts.

Final bounded Visual evidence confirms Home-to-Docs structured navigation and the
initial reply-review list on `bbb7f28d`; web→Expo and Expo→web posting each updated
the already-open thread without refresh/reopen while preserving the other client's
unsent draft. Expo selected sharing, snapshot/live modes, consent and revoke were
verified on `82dee01b`; later fixes affected navigation and reply-list visibility,
not publication. Replies used a local mock provider. Screenshots were inspected
inline and have no supported file export path. Live Slack/Teams delivery and native
iOS/Android behavior remain explicitly deferred and unverified.

C5 is accepted and pushed to main. Production deployment remains user-owned. C6 is
next in the roadmap and has not started. All candidate-specific receipts below are
historical checkpoints retained for traceability; earlier pending decisions are
superseded by the final acceptance and delivery above.

Accepted C5 scope covers maintained page bindings/schedules and scoped mentions,
publication consent/revocation, and Slack/Teams channel lifecycle across shared
web/desktop and mobile clients. Permission, revision, human-edit, source-privacy and
waiting-reply boundaries were preserved.

Live Slack/Teams workspace checks remain explicitly deferred and unverified; local
channel tests do not establish external delivery. Native iOS/Android checks are also
deferred. C4/D1 browser checks remain production follow-ups, outside C5 acceptance.
Production deployment is user-owned. Main integration is complete by fast-forward push
to `main` at `392f2445`.

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

## Historical checkpoint — scoped comment implementation

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

## Historical handoff — initial candidate 046c0b85

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

### Historical verification plan — superseded by final acceptance

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

## Historical correction checkpoint — reply refresh on 7f7bc08f (round 1/3)

C5-VIS-001 correction frozen at `7f7bc08fbed63552354ff4186b08acd48298b72d`.
Shared authorized document-event refresh now updates comments independently of
content version and local decisions invalidate open views. Refreshes coalesce,
late loads are session/disposal fenced, and failed loads retain prior comments
with Retry. Comment composers and resolved filters stay mounted. Open review
cards refresh runs independently of the editor content.

Builder checks: 9/9 focused refresh/store tests passed
(`/tmp/orbyn-c5-refresh-unit-final.log`); final workspace typecheck passed
(`/tmp/orbyn-c5-refresh-types-final.log`). Earlier typecheck encountered a stale
shared declaration while source was still being edited; retained at
`/tmp/orbyn-c5-refresh-types.log`. Final shared rebuild and typecheck exited 0.

Tester received the frozen candidate for formal focused verification. Visual
Check received the bounded two-client posting/draft-preservation recheck and
originally missing Expo sharing coverage. Reviewer acceptance and main delivery
remain pending. No backend source changed in this correction; live Slack/Teams
remains user-deferred. C6 has not started.
