# C5 review — round 1/3

**Final decision: ACCEPT / APPROVE C5 at `bbb7f28d0eb55b27ae1d8fea4b50c717b96b9dc5`, review round 1/3, under the agreed scope and explicit live Slack/Teams/native deferrals. R1, R2, C5-VIS-001 and C5-E1 are closed.** Earlier decisions below are historical; the final assessment at the end supersedes their pending/changes-required status. Acceptance is not a claim of merge, push or deployment.

**Decision: changes required.** Two P2 lifecycle findings below; bounded visual qualification is also pending. This is full review round **1/3**, with corrections to be assessed as continuations of this round.

Reviewed candidate `046c0b85a56b82966db7f398c63c8537fbb5bea5`, base `9c7c3fdb`, branch `codex/c5-pages-publication`, checkout `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`. Product/test source remained unchanged during review. Existing architecture, setup, tracker and Tester/Visual Check documentation changes were inspected and preserved.

## C5-R1 — P2: Pause cannot stop a binding after an ordinary human edit

**Locations:** `packages/api-client/src/page-maintenance-store.ts:166–179`; `backend/src/modules/docs/maintenance.ts`, `updateMaintainedPageBinding` revision check and snapshot capture. Both PageMaintenanceDialog and PageMaintenanceSheet call this shared pause operation.

**Failure:** Create a schedule at document version 5, then edit the page to version 6. Pause sends `binding.snapshot.doc_version` (5), so the server returns 409. Reloading retains the same binding baseline and repeats the failure. The schedule cannot be paused through its advertised control without editing/rebinding it or deleting it. The current store test explicitly asserts the stale baseline payload against a mock; it never exercises this server rejection. This is an existing shared-store behavior newly exposed through the structured editor, reviewed here as part of full C5 lifecycle scope.

**Correction:** Separate stopping a schedule from accepting a new content baseline. An owner-authorized, binding-revision-fenced pause should stop/cancel outstanding work while retaining the original snapshot. Preserve current authority checks. Resume after source changes must require explicit review/rebinding; do not simply substitute the latest document version into the existing general update call, which would silently recapture human edits.

**Verification:** Real API/store scenario: create binding, human edit, reload, pause successfully; snapshot unchanged and queued/running/waiting work cannot subsequently apply. Stale binding revisions and unauthorized callers must fail. Resume cannot silently accept changed source. Verify both clients use the corrected operation.

## C5-R2 — P2: Withdrawn pre-queue comment requests permanently consume active-request capacity

**Locations:** `backend/src/modules/docs/maintenance.ts`, `createMaintainedPageBinding` active-comment count; `backend/src/worker/maintained-page-scan.ts`, refusal catch; `backend/src/modules/docs/comment-request-context.ts`, source validation.

**Failure:** Create an `@orbyn` comment, then edit or resolve it before its first scan (or while Background cannot run). The context guard correctly refuses the withdrawn request, but its binding remains `schedule_exhausted=false`. The scan catches the 409 without retiring the binding. The active-comment quota counts every such row through `NOT b.schedule_exhausted`, even though none can ever run against its captured comment revision. After 100 withdrawn requests, all further mentions fail and their comment inserts roll back. These rows are hidden from the ordinary binding list; resolving/editing the discussion does not release capacity. Existing run expiry handles runs, not bindings that never obtained a run.

**Correction:** Give irreversibly invalid one-shot comment requests a terminal disposition, or exclude them from active capacity using the same current source/thread validity contract. Retire invalid pre-queue requests without deleting human comments, retaining retry deduplication and preventing stale replies. Distinguish permanent source withdrawal from temporary provider/authority availability; do not discard valid waiting work just to free slots.

**Verification:** Create and resolve/edit requests before queueing, including a resolved parent thread; run the normal scanner/cleanup path and prove their active capacity is released and no reply appears. A new valid mention must still succeed after 100 withdrawn requests. Valid unqueued and queued/running/waiting requests must continue to count, and duplicate processing must not create extra replies.

## Evidence assessment

- Tester's referenced logs corroborate **471/471 focused** and **78/78 structured/docs** checks, with zero failures/skips. Build, workspace types and existing/fresh migration results are accepted as Tester-reported; Reviewer did not execute them.
- Inspected structured maintenance preservation/conflict assertions, scoped comment API/context/worker/approval/dedup tests, selected publication and client-store tests, media/revocation paths, and local channel authentication/reply/lifecycle implementation and receipt coverage. Selected publication applies explicit consent/revision fences, filters leaves, masks internal object references and rechecks current authority; comment output is a deduplicated reply rather than a page mutation. No additional blocking source finding identified in those inspected paths.
- Passing tests do not resolve R1/R2: their missing scenarios concern real lifecycle transitions rather than the assertions currently covered.
- Slack/Teams live workspace delivery is explicitly user-deferred. Local contracts remain qualified only to that scope; no external installation/delivery proof is claimed.

## Remaining gates and documentation

**C5-E1 — evidence pending:** The replacement Visual Check session is still qualifying candidate-backed shared web wide/320px and Expo web: Page updates, reply approval, sharing selection/mode/consent/revocation and anonymous viewer. The current report contains no C5 flow pass and records an API provenance mismatch and absent Expo preview at its observation time. Treat those as historical observations pending the replacement report, not proof of its current runtime. Do not infer a visual waiver from the older tooling/block note or C4's separate disposition. Assess the replacement evidence before accepting C5.

Builder should reconcile the current-state tracker and progress summary at handoff: several sections still say Test/0-of-3, missing tooling and pending Tester qualification despite the latest Review/1-of-3 handoff. Preserve historical receipts under clearly historical labels. Architecture/setup changes appropriately distinguish implemented local contracts from unverified live delivery; keep that distinction.

Next: Builder batches R1/R2 fixes; Tester executes the named regressions and affected checks; Reviewer assesses the corrected candidate and visual report within round 1/3. No main-integration acceptance, merge, push or deployment is granted by this report. Production deployment remains user-owned.

Reviewer performed read-only source/evidence inspection and wrote this report only: no product/test edits, tests/builds, database actions, browser operation or external messaging.

## R1/R2 closure — dc75c780, round 1/3 continuation

Correction candidate: `dc75c780b69d01aa4baa0b9eac8317c67f62ea60`, same checkout and branch. Reviewed the delta from `046c0b85`, changed regression assertions and Tester's appended retest. The referenced `/tmp/orbyn-c5-r1-retest-dc75c780.log` corroborates **88 passed, 0 failed, 0 skipped**; workspace typecheck passed according to Tester. Prior 471/471 and 78/78 receipts remain baseline evidence for unchanged covered paths, not fresh executions on this correction candidate.

- **C5-R1 closed.** The strict lifecycle payload contains only binding revision and pause state. Pause checks human page-write permission and binding ownership/revision, preserves the snapshot, and cancels queued/running/waiting runs while clearing their lease, proposal and waiting ID. Resume rechecks assistant/page authority and refuses a changed page baseline instead of recapturing it. The real API regression covers pause after a version change, outsider/stale-revision rejection and required rebind before resume. Run-state regressions cover each active state and stale claim/apply/approval refusal. Both clients use the corrected shared-store operation. These tests advance the document revision directly; they qualify the server lifecycle boundary, not a rendered edit-and-pause interaction.
- **C5-R2 closed.** Retirement now runs before scanning and before comment-request capacity counting. It exhausts invalid source/revision/thread bindings without active queued/running/waiting work and keeps rows for deduplication. Provider or grant unavailability alone does not make an otherwise valid source withdrawn. Existing active-run counting remains intact. The quota regression reaches 100, confirms refusal, resolves/edits the sources, runs the normal scanner, verifies no remaining active withdrawn bindings or replies, and successfully creates another request. Parent-thread retirement is also asserted. Retention of valid/active work is supported by the explicit SQL predicates and existing lifecycle cohort; the new quota fixture does not independently exercise every concurrent active-state permutation.

**No remaining code correction requested for R1/R2; no new blocking defect identified in the correction diff.** Full C5 remains **evidence pending** because C5-E1's replacement visual report has not yet supplied qualification of the agreed flows. Assess that report and any resulting findings before acceptance. Live Slack/Teams stays user-deferred; no native or production qualification is implied. No merge/push/deployment approval is conveyed.

Reviewer ran no tests/builds and performed no database/browser actions. Only this review report was changed; shared in-progress documentation was preserved.

## Visual evidence continuation — dc75c780, round 1/3

Reviewed the appended resumed/final visual batches and the relevant comment-loading, page-event and maintenance-decision paths. This is delegated visual evidence, not personal screenshot inspection. Candidate remains `dc75c780b69d01aa4baa0b9eac8317c67f62ea60`.

### C5-VIS-001 — P2: committed assistant replies do not refresh an open thread

**Locations:** desktop `DocComments.tsx` load effect (depends only on `docId`); mobile `useDocComments.ts` load effect (depends only on the doc-bound loader); both `StructuredDocEditor.tsx` watch callbacks (ignore events at the saved document version); `PageMaintenanceStore.decide` refreshes document/binding/run data, not comments.

**Observed impact:** Expo Post reply commits successfully and marks the run done, but the open thread omits the reply until the page is reopened. The other open web client also remains stale. Users cannot see the result of their approval in context and may assume it failed. Source inspection supports the observation: `applyMaintainedPageReply` emits `announceDocChange` with the unchanged page version, while structured-editor listeners discard equal-version notifications and neither comment owner subscribes to comment changes. Re-adopting the same document does not rerun the comment-loading effect.

**Builder correction:** Invalidate/refetch the owning comment state after a successful local reply decision and on relevant remote comment notifications, independently of document-content version. Reuse the existing authorized live channel or introduce a specific comment-change signal; preserve content revision semantics. Keep page-update run status fresh for the affected open review view as well. Do not remount the whole editor or bump the content version merely to force rendering. Preserve unsent page/comment drafts, anchors, resolved filters and current selection. Fence late loads by document/account identity, deduplicate refreshes, and provide retryable failure behavior without presenting an empty thread as a successful refresh.

**Expected verification:** Approve a saved reply from web, then Expo, with the same page already open in the other client. Each initiating thread and the other open thread must show exactly one correctly attributed nested reply without reopening or manual run refresh. Cover an unchanged page version, a duplicate notification, an in-progress comment draft, navigation/account change during an outstanding fetch, and refresh failure/retry. Use targeted state/invalidation regressions plus a bounded recheck of the reproduced interaction; no broad visual sweep. Preserve R1/R2 closure unless the correction changes their paths.

### C5-E1 remaining evidence

Accepted within the report's observed scope: candidate-backed web 1280/320 and Expo 390 rendering; schedule creation and human-edit pause/rebind refusal; selected anonymous viewer, snapshot immutability/live refresh, consent and revocation; saved reply review controls on both clients and successful posting from Expo. Mock-generated saved output qualifies the review interaction, not live-provider execution. Inline-only screenshot availability is disclosed and is not by itself a new blocker.

The old tooling absence/provenance mismatch is superseded by the candidate-backed resumed batch. The refresh defect above remains a correction gate. The final report does not explicitly identify Expo execution of sharing selection/mode/consent/revocation; clarify whether those observed sharing actions were web-only. Reuse any existing mobile evidence if recorded, otherwise finish only that originally scoped mobile flow. The refresh recheck should include web Post reply as well as Expo, since the current report records actual posting only from Expo. Do not expand this into native, live Slack/Teams or unrelated C4 checks.

**Decision: changes required, round 1/3.** Builder owns C5-VIS-001; Tester owns focused regression execution; Visual Check owns the bounded interaction recheck and the explicit mobile-sharing coverage disposition. Full C5 acceptance remains withheld. Reviewer changed this report only and ran no tests, builds, browser or database actions.

## Refresh correction review — 7f7bc08f, round 1/3

Candidate `7f7bc08fbed63552354ff4186b08acd48298b72d` changes client refresh code/tests only. Reviewed the exact delta, watcher/store assertions and appended Tester receipt; the referenced log corroborates **9/9 passed**, zero failures/skips. Workspace typecheck is Tester-reported passing. Prior backend evidence remains applicable to unchanged source.

**Comment refresh correction accepted at source level, interaction confirmation pending.** Both comment owners now subscribe independently of content version; successful local decisions invalidate views. The watcher coalesces notifications and repeats a read for an event during a fetch, fences late responses by session/disposal, and reports refresh failures without clearing prior rows. The components retain their draft/filter state and offer Retry. Unit tests qualify the shared primitive, not mounted React draft preservation or actual two-client delivery. The separate decision test does not assert its local-invalidation call; source inspection confirms that call. The pending bounded visual recheck remains necessary.

### C5-VIS-001 continuation — P2: open run cards can still lose a refresh while busy

**Location:** `packages/api-client/src/page-maintenance-store.ts`, `receiveRuns`/`receiveRunsError` and `run`/`take`.

The watcher preserves events during its own fetch, but `receiveRuns` silently discards their result whenever the maintenance store is busy. Concrete ordering: a local prepare/refresh starts `take()` and its runs request reads the old waiting state; the other client posts the reply; the watcher fetches the new done state and delivers it while the local store is still busy; that result is discarded; the older `take()` completes and publishes waiting. With no further event, the open card remains stale until manual refresh. An error in the same interval is also dropped. The new tests exercise watcher coalescing in isolation and do not cover this store/watcher overlap.

**Builder guidance:** Preserve invalidation through store operations. Queue a final runs reload when busy ends, or coordinate request generations so a newer run receipt cannot be dropped or overwritten by an older `take()`. Do not let an obsolete response restore an actionable waiting card. Keep session/disposal fences and existing draft preservation.

**Tester verification:** Deferred-promise store regression with an old `take()` response held, a newer remote run receipt arriving while busy, then the old response released. Final state must be done without another notification or manual refresh. Cover the corresponding refresh failure/retry and account/disposal boundary. Reuse existing unaffected receipts; no backend rerun is requested.

R1/R2 stay closed. **Changes required** for this remaining same-finding race; C5-E1's two-way posting/draft and Expo sharing recheck remains pending. No tests/builds, browser/database actions or product/test edits were performed by Reviewer.

## Run-refresh race closure — d416d6bb, round 1/3

Candidate `d416d6bbcf1f6b23ebbf6cb51cb9b78562e5e858` changes only the shared maintenance store and its unit tests. Reviewed that delta and Tester's appended receipt. The referenced log confirms **11/11 passed**, zero failures/skips. The changed api-client package build passed according to Tester; the previous full workspace typecheck remains a `7f7bc08f` receipt, with client signatures and consuming UI files unchanged.

**C5-VIS-001 overlap race closed at source/regression level.** A remote receipt or error arriving while busy now sets `runsInvalidated`. Completion performs a fresh read instead of permanently dropping that notification. The added deferred-promise regression exercises the reported ordering: hold the old waiting read, deliver done (or a refresh error), release the old read, and assert the automatic second read leaves done with no manual action or additional event. Disposal clears the pending flag, and generation/session checks prevent the queued reload after departure/account change; the second regression verifies those boundaries.

No additional correction is requested from this delta. R1/R2 remain closed. **Overall decision: evidence pending, round 1/3.** Full C5 acceptance still requires the already assigned web-to-Expo and Expo-to-web posting/draft recheck and explicit Expo sharing selection/mode/consent/revocation evidence. Unit-level race closure does not establish mounted UI behavior. Retain live Slack/Teams and native exclusions; no merge, push or deployment is approved here.

Reviewer inspected source and existing logs only, updated this report, and ran no tests/builds or browser/database actions.

## Structured mobile comment wiring — 82dee01b, round 1/3

Reviewed candidate `82dee01bd88d3a8a3fb1ccaa9cc6f168820cca98` against `d416d6bb`: three mobile files only. Also inspected the existing shared comment hook, DocThread state and owning OpenDoc wiring. Builder reports mobile typecheck passed; no separate Tester receipt for this three-file correction was supplied with this handoff.

**Source correction accepted; rendered closure pending.** The structured editor now receives the page's shared comment state/user identity and renders a block-ID-bound badge and DocThread. OpenDoc projects format-2 leaves for comment anchoring, and the complete-page loader supplies leaves when the initial page object lacks structured content. The existing page-level comment section retains loose threads. A comment-only refresh updates props without changing the open thread's identity or deliberately remounting the editor; DocThread's draft/reply state therefore has a stable owner for the intended same-page refresh case.

No new blocking source defect identified in this diff. Preserve the bounded visual gate: open a nested structured block's existing thread, retain an unsent draft, post a saved reply from the other client, and confirm exactly one attributed reply appears in place with the draft intact. Repeat the posting direction and confirm the page-level/anchored placement and badge are correct. The outstanding Expo sharing selection/mode/consent/revocation checks remain in scope. Typecheck and source wiring alone do not establish those interactions.

R1/R2 and the run-refresh race stay closed at their previously qualified levels. **Overall: evidence pending, round 1/3; no C5 acceptance or integration approval.** Reviewer changed this report only, with no tests/builds, product edits or browser/database actions.

## Generic document read correction — a713bfbd, round 1/3

Reviewed exact commit `a713bfbdddaaa2311aaaf260cb353edc29f65938`: the generic `getDoc` request now declares `x-orbyn-doc-formats: 1,2`, and one focused client test asserts that header and receipt of a structured document. Inspected the server GET capability check, editor-specific read method and generic navigation call sites for context.

**Accepted at source level; no new blocking concern identified.** Ordinary Home/document navigation can now obtain structured pages instead of failing the server's format-capability check. The change preserves the caller's fresh/abort options, response metadata and complete document payload. It does not change write negotiation, bypass authorization or enable a flat content write to a structured page. Editor-specific validation remains in `getDocForEditor`; this change does not claim to add that validation to generic reads.

Builder reports api-client build, desktop typecheck and **10/10** focused checks passing. The appended Tester report inspected during this continuation does not yet contain a separate exact-candidate receipt for this correction, so those results remain Builder-reported. The new test uses a mocked HTTP response: it demonstrates header wiring and payload availability, not rendered navigation or actual server integration. Reuse existing unchanged server capability evidence and the already assigned Home Docs navigation recheck; no broad regression rerun requested.

Full C5 remains **evidence pending, round 1/3** for the bounded reply/draft and Expo sharing interactions and their candidate provenance. Prior finding closures remain intact. Reviewer changed this report only; no tests/builds, product edits or browser/database actions were performed.

## Initial review-list visibility — bbb7f28d, round 1/3

Reviewed `bbb7f28d0eb55b27ae1d8fea4b50c717b96b9dc5`: only the initial `showForm` value changes from true to false in web PageMaintenanceDialog and mobile PageMaintenanceSheet. Inspected the surrounding list/form branches and actions.

**Source correction accepted; no new blocking finding.** A page with comment-request runs and no recurring schedule now opens the Recent runs/review list, rather than hiding those cards behind the new-schedule form. Both clients retain an enabled-when-ready Add schedule action; existing schedules still have Edit, Pause/Resume and Remove. Reply approval, scope and server lifecycle behavior are unchanged. Builder reports web/mobile typechecks passing; this handoff supplies no additional rendered result.

Continue the already assigned two-client saved-reply check on this candidate, explicitly opening Page updates on the comment-only fixture and confirming the waiting cards are initially reachable without creating a schedule. Reuse unchanged evidence and finish the outstanding draft/refresh and Expo sharing cases. **Overall: evidence pending, round 1/3.** This is a source-level closure continuation, not full C5 acceptance. Reviewer changed this report only and ran no tests/builds or browser/database actions.

## Final C5 assessment — accepted, round 1/3

**Accepted candidate:** `bbb7f28d0eb55b27ae1d8fea4b50c717b96b9dc5`, branch `codex/c5-pages-publication`, base `9c7c3fdb`, managed checkout `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`. HEAD and absence of uncommitted product/test changes were rechecked. Reviewed the completed Tester and Visual Check appendices against the retained requirements and all correction decisions above. No remaining actionable acceptance finding identified.

### Finding and requirement closure

- **R1/R2 remain closed:** distinct pause/resume control preserves human-edit baselines; withdrawn pre-queue requests release capacity without losing deduplication. The exact correction's 88/88 cohort covers the identified lifecycle cases.
- **C5-VIS-001 closed:** source fixes and the 11/11 refresh cohort address same-version invalidation, busy-read overlap, retry and stale-session boundaries. The final delegated visual batch confirms posting from web updates the already-open Expo thread with its exact unsent draft preserved, and posting from Expo does the same on web, without manual refresh/reopen. The reported defect did not recur.
- **Mobile comment visibility, ordinary structured-page navigation and initial review-list visibility closed:** source corrections are supported by targeted typechecks, the independently rerun 10/10 document-client contracts and final Home Docs/review-card observations. The earlier Builder-only receipt limitation for `a713bfbd` is superseded by Tester's exact-candidate appendix; Tester also reran both client typechecks on `bbb7f28d`.
- **C5-E1 closed within the bounded assigned scope:** retained web schedule/pause/rebind, selected sharing, snapshot immutability/live behavior and anonymous revocation evidence is complemented by explicit Expo selection/mode/consent/revocation checks and two-way reply/draft observations. Expo sharing was observed on `82dee01b`; subsequent changes affect the generic read header and initial maintenance view, not the publication implementation. Final navigation and reply checks use `bbb7f28d`.
- **A5/A6/A7 agreed scope accepted:** structured maintained-page ownership/schedules and human conflicts, scoped human comment jobs/replies, selected snapshot/live publication privacy/media/consent/revocation, and local Slack/Teams lifecycle contracts have the reviewed source and qualified evidence recorded above. Live delivery remains explicitly deferred, not passed.

### Evidence boundaries retained

The 471/471 focused and 78/78 structured/docs results, production build, workspace types and fresh/existing migrations belong to `046c0b85`. Correction receipts are incremental: 88/88 and workspace types on `dc75c780`; refresh checks/types on `7f7bc08f`; 11/11 and changed-package build on `d416d6bb`; mobile typecheck on `82dee01b`; 10/10 and api-client build on `a713bfbd`; web/mobile typechecks on `bbb7f28d`. Reuse is limited to unchanged covered code; no final all-suite rerun is claimed or required.

Visual evidence is delegated, with inline screenshots and disclosed lack of file export. Earlier wide/320px web and 390px Expo observations remain retained; final two-way interaction captures measured web 390×844 and Expo 861×890. These are the recorded dimensions, not a claim of a fresh full viewport matrix. Local mock output qualifies the scoped worker/review interaction, not live model-provider delivery. Live Slack/Teams and native checks remain user-deferred and unverified. C4 production follow-ups are not relabelled as C5 passes.

### Delivery disposition

Reviewer approves this exact candidate for Builder's authorized C5 integration workflow. Builder should reconcile the stale pending/current-candidate summaries in progress/tracker documents and retain this report and receipts in closeout. This is documentation reconciliation, not an open product acceptance defect. Cleanup is reported complete for the isolated C5 fixture and mock services; Vite remains as disclosed.

No merge, push or production deployment was performed or verified by Reviewer. Production deployment remains user-owned; acceptance does not automatically advance C6. All corrections stayed in **round 1/3**. Reviewer performed read-only code/evidence assessment and edited this report only, without tests/builds, database/browser operations or product/test changes.
