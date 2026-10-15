# ADR 003 technical review — round 1/3

Current decision: **approved for agreed ADR 003 scope, round 1/3**. Delegated
Reviewer accepted product `e2813634`, reconciled at documentation `22cb6162`,
after read-only source and receipt assessment. R1–R7 and V1–V17 are closed.

**Current disposition:** formal affected checks, actual web/Expo document and
assistant interactions, V16 density/PDF retention, V17 retained-selection pane
ownership and the parent's finite recovery list have the required evidence in
[Tester](adr-003-tester.md), [Visual Check](adr-003-final-visual.md) and
[parent interactions](adr-003-parent-visual.md). No further test or visual sweep
is required for this scope. Earlier pending statements and failures below remain
historical, with their original source limits. Acceptance does not imply every
inventory file received a separate browser exercise. Native apps, installed
desktop behavior, external providers/hosts and production retain their recorded
exclusions. Integration/push is a subsequent delivery action in the
[ledger](ui-ux-redesign.md). Reviewer ran no tests/builds/browser actions.

Reviewed on 15 October 2026 in `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`. Assigned range: `c7b3bdb7..b0baced59c393d22c4e0124a3cfdc83329d96a2f`, including implementation `15fc3a5a` and fixture correction `b0baced5`. The checkout advanced during inspection to `626c58eed917d0e6bd5221b9b5dc5cb3a7566666`; its bounded typography/fixture diff was inspected as a supplemental correction, not substituted silently for the assigned candidate. Before report completion, docs-only `5b10872e` recorded its focused retest. The three source findings below remain applicable there.

This continues the recorded **1/3** round. Corrections and their verification can close this round; no counter reset or fourth round is authorized. This report records neither merge nor deployment approval.

## Basis and limits

Inputs: `AGENT.md`, reviewer and coordination guides, ADR 003 and its owner refinements, candidate and working Tester reports, UI/content skills and design rules, surface inventory, source/test diffs, and retained failure-log excerpts. Scope includes all ADR families, not just the original palette changes. The range is 629 files with substantial functional changes. This is a risk-focused technical assessment and requirement/evidence audit, not a claim that every line or every rendered screen was independently verified.

Reviewer performed read-only source, Git and report inspection and wrote this report only. No tests, builds, database operations, browser interactions, provider calls, security scans or outbound session messages were performed. Concurrent Tester/tracker/Visual documents were preserved. Rendered behavior below is either attributed to Tester or explicitly pending.

## Source findings requiring correction

### R1 — P2: narrow second pane loses shared navigation and search

**Location:** `desktop/src/app/App.tsx:345`, `:385`, `:2538`, `:2560`; `desktop/src/app/workspace.css:270` and `:332`.

At widths up to 1279px, selecting Second pane makes the whole primary pane `display:none` and inert. The only Sidebar is inside that primary pane (`!secondary`), and the secondary top bar is unconditionally hidden by CSS. The second-pane toolbar provides only its label and Close. Thus the single-pane fallback removes the shared navigation/search controls precisely when the secondary pane is focused. Switching back to First pane changes the navigation target back to the primary controller, so it is not an equivalent way to navigate the secondary pane. Below the tab threshold, even the secondary strip is unavailable.

**Expected:** shared navigation and search remain reachable by pointer/touch and keyboard, and act on the focused visible pane while both pane drafts remain mounted.

**Builder guidance:** give shared chrome a lifetime/layout outside the content region that is hidden for narrow switching, or provide one narrow shared-chrome placement bound to `dispatchChrome`. Keep one shared controller and one navigation collapse action. Do not solve this by duplicating planners, recreating the hidden pane, or routing all narrow navigation to main.

**Verification:** at 900px and 320px, select Second pane, open navigation and search by visible controls, navigate only that pane, repeat search without losing its query, then return to First pane and verify its draft and scroll. Include keyboard focus return and a blocked document save. This belongs in the final bounded visual batch after a focused controller regression.

### R2 — P2: document capture shortcuts bypass pane and dialog ownership

**Location:** `desktop/src/features/docs/DocEditor.tsx:1639–1667`; related global menu Escape handlers at `:631` and `desktop/src/features/docs/StructuredDocEditor.tsx:619`.

The selected-text handler registers a document-level capture listener and consumes Cmd/Ctrl+B, I, Shift+H, Shift+X and K whenever its retained `picked` state is non-null. It does not check the focused pane, hidden/inert ancestry, the event's input owner, or an active dialog. `styleWords` updates document content. The parent controller's `ownsEventsRef` checks cannot protect this child listener: it runs in capture and stops propagation first. With retained selection while focus moves by keyboard to the other pane or an overlay, the wrong editor can consume the shortcut or style the retained selection. Hidden/inert DOM does not disable listeners attached to `document`. Menu Escape handlers likewise prevent default without checking current ownership.

This is a source-level ownership defect; Reviewer did not claim a browser reproduction. Ordinary selection-change cleanup is not a reliable authorization boundary for shortcuts in two retained controllers.

**Expected:** only the focused, visible editor or its explicitly owned selection toolbar handles editing shortcuts. A temporary dialog retains input ownership. Hidden panes retain selection without acting on global input.

**Builder guidance:** expose pane ownership to child global handlers or centralize dispatch through the scoped command owner. Guard before preventing default or mutating; account for focused text inputs, top-layer dialogs and the editor's own toolbar. Apply the same rule to the two menu Escape handlers. Preserve selection when yielding ownership instead of clearing it merely to suppress the bug.

**Verification:** mount two editors, retain selection in A, transfer keyboard focus to B and dispatch formatting/search shortcuts; A must not mutate or intercept. Repeat with A hidden and with an owned dialog/input open. Then focus A and prove its intended formatting/link action still works. Add one real keyboard exercise to R1's final pane case.

### R3 — P2: completion-history export has unresolvable item references

**Location:** `backend/src/modules/organize/portability.ts:23–39`, `:76–100`.

The new `completion_history` exports `{item_id, created_at}`, but exported `items` do not include IDs: the item SELECT starts at `i.title`. An offline consumer cannot associate even a top-level completion with its exported task, especially when titles repeat. The history query also includes personal subtasks while the item export excludes `parent_id IS NOT NULL`, creating further unresolved references. Timestamps are present, but the relational history is not usable as exported.

**Expected:** personal completion history has a documented, resolvable identity inside the archive while retaining its original timestamps and personal-only scope.

**Builder guidance:** add a backward-compatible stable identity to exported items and represent the referenced subtask identities, or embed a minimal documented task identity alongside each completion. Do not guess associations by title, silently drop subtask history, or manufacture historical completions during import. This finding does not add a requirement for automatic history re-import; it concerns the explicitly required export.

**Verification:** export two same-title tasks and a completed subtask; every completion reference must resolve without consulting the live database, timestamps must match, and another account/team's history must be absent. Preserve compatibility with old archives without the new fields.

## Required evidence and test corrections

### E1 — P1 acceptance gap: exercise the new planner Activity contract

`backend/src/modules/focus/activity.ts`, migration 267 and `items/service.ts:1183` implement a new contract, but the inspected test tree has no references to `item_completions`, `completion_history`, `activitySummary` or `/me/activity-summary`. `assistant-activity.test.ts` imports `assistant-workspace/activity.ts` and creates AI jobs; its green result does not qualify planner completion/focus counts. Tester's Melbourne zero/unavailable-history walkthrough is useful but does not exercise mutation/counting/privacy boundaries.

Builder should add focused marked-database/API tests, and Tester should execute them: non-done→done once, repeated done write, reopen→done, recurring occurrence, connected-account actor, focus work versus break and start-day attribution, local midnight/DST boundary, 30/90/365 limits and rejected invalid periods, pre-recording null versus known zero, active-day deduplication, current visibility after team removal, delete cascade, snapshot restore timestamp preservation, and R3's personal export. Group these fixtures in one finite Activity suite. Missing evidence is not a claim that the implementation currently miscounts.

### E2 — P1 acceptance gap: qualify new import transaction receipts and compiler boundaries

The import source improvement is substantive: the fingerprint binds exact input and `rememberImportResult` writes the result within the import transaction; replay checks live authentication/team permission. However, existing `imports-flow.test.ts` exercises uploaded-file conversion through `/imports`, and the inspected import tests do not assert these new idempotency receipts. A successful one-task/page import does not prove retry-after-response-loss.

Add route-level tests for `/me/import` and `/imports/pages`: same key/input replays the committed result with unchanged object counts; changed input/key reuse rejects; a concurrent duplicate does not create content twice; a transaction failure leaves no committed content/result and a permitted retry succeeds; a committed result survives response delivery failure; revoked authentication/team membership cannot replay private output. Include one component-level failed-response→retry case proving the same key is retained. Keep current exact-input preview/error-retention checks.

The private compiler has credible bounds in source: 256 KiB source and 24 MiB PDF checks, two bounded passes, one active compilation, bwrap namespaces, no shell escape, restricted TeX reads/writes, process-group termination, cleanup, read-only container, private service/key, memory/CPU/PID/tmpfs limits. The API checks write permission and version before and after compile and returns `no-store`. Tester verified the corrected default starter and accented/math PDF generation on the actual image; retain that evidence.

What is missing is negative-boundary evidence. Add API/service tests for wrong ownership/revision, size limit, missing compiler, compilation failure, cancellation/timeout and permission/version change while work is in flight. Use a finite disposable-image check for denied filesystem/network access and resource termination with cleanup; do not start a security scan. These checks should demonstrate the existing bounds, not expand into arbitrary fuzzing. Embedded PDF page appearance remains a separate final visual gate; HTTP 200 and a download link do not close it.

### E3 — P2: finish the regression batch and replace the most consequential source-only claims

Retained evidence from Tester:

| Candidate/check | Result and interpretation |
| --- | --- |
| Original 21-file unit attempt | Failed; truncated output, no invented complete counts |
| Four-file corrected interaction batch | 44/48; focus return defect and stale source-view assertions then corrected |
| `15fc3a5a` affected two-file retest | 29/29; retain the other two unchanged suites' earlier passes |
| Marked database batch | 142/142, no skips; valid for its actual assertions, not every new endpoint |
| `a0c5c7bd` supplemental 17 files | 130/169; 39 failures retained, not 39 product defects |
| `b0baced5` six changed files | 72/87; 15 failures remain in working Tester report |
| `626c58ee` four affected suites | 68/76; eight web picker tests still stop at missing `HTMLFieldSetElement` in the VM harness. Native picker and typography checks now pass. |
| Types/builds | Earlier builds passed as attributed in Tester report; desktop/mobile typechecks also passed at `626c58ee`. Relevant final build remains to be recorded after source corrections. |

`b0baced5` appropriately updates stale picker imports, dynamic filter IDs, disclosure labels and optional helper expectations. Removing the minimum-five-mobile-intros assertion follows the concise-content contract. Its actual ChoicePicker test adds a 5,000-option list, search, selection and disabled/replacement-account callbacks. Those tests initially failed at missing theme mocks and now pass in the `626c58ee` receipt. A FlatList-prop assertion proves configuration, not real scroll-to-last-item or rendered reachability.

The remaining 15 failures are classified in Tester's report: 10 picker harness failures, two copy/layout assertions, one provider-expression assertion and two typography assertions. At `b0baced5`, the typography failures contain real off-scale body/heading choices as well as valid 16px phone-input exceptions. Do not shrink phone fields to 15px merely to satisfy the ratchet. `626c58ee` moves fields to control/input roles and adjusts other type roles, supplies MutationObserver/radii mocks and updates stale assertions. Its no-op MutationObserver mock does not test observer-driven dismissal; retain that as a rendered/DOM behavior gap, not a passing observer test.

The final `626c58ee` receipt closes the stale-copy/provider/type-scale failures; the eight remaining failures are still harness failures, not eight picker defects. Complete the DOM fixture (including fieldset identity) and rerun the affected picker suite once. Retain the other corrected suites, the 11 unchanged suites and other valid receipts instead of rerunning everything without cause. Add focused mounted behavior tests for R1/R2 and the new ViewDraftStore: in-flight save followed by a newer draft, failure/retry, confirmed save followed by failed row refresh, account stop/late response, and pane close while edits are pending. Source regex checks for Admin/provider/dialog guards remain structural evidence; do not label them runtime permission/focus proof.

## Whole-scope assessment and remaining acceptance map

| ADR family/refinement | Technical assessment | Remaining evidence |
| --- | --- | --- |
| Palette, typography, motion, shared controls | Neutral/blue direction is implemented; no stale palette prohibition applied. Type-role correction is a separate observed commit. | Corrected suite; one light/dark representative check with actual phone field sizes and long values |
| Shell, resizer, tabs, focused navigation | Separate scoped controllers share one planner; remembered focus and departure guards are useful. R1/R2 remain. Resizer has pointer cancel, keyboard bounds and persistence paths. | R1/R2 tests; drag/cancel, keyboard bounds, reload, focus and separate drafts/scroll |
| Chat/Work, project chats, Background/Overnight | Backend adds `kind` filtering; UI retains composer text when choosing project/switching mode. Execution lanes remain distinct. Sweep implementation is unchanged by this range. | Project chat open/rename/pin, mode history filters and cross-account visibility; execute existing `chat-sweep.test.ts` once, including pinned exemption; long composer and lane controls in final batch |
| Personal Activity | New migration, transition insertion, visibility-aware local-day aggregation and snapshot table registration inspected; no guessed completion backfill. | E1 and R3; daily details on both clients |
| Notes, Markdown/equations, standalone TeX | Source callback/epoch checks retain invalid edits; TeX uses a named block and structured leaf operation rather than replacing other note content. Assistant creates reviewable proposals after saved-state checks. | Real accept/reject and failure-retained instruction in each mode, history/conflict, narrow hide/show; E2 and actual embedded PDF appearance |
| Tasks/Calendar/Focus | Broad surface changes and scoped save/refresh handling; representative source paths inspected. | One task edit/cancel/error, calendar block edit and focus completion; no full native claim |
| Projects/Docs/Browse | Creation/detail actions and document departure guards are part of the changed scope. Inventory still contains partial source-assessment rows. | Finish/update those rows accurately; route/deep-link failed-save retention and project create→failed refresh receipt |
| Views | Shared draft store serializes queued definition writes and rejects stopped generations; row locks and refresh receipts need behavior evidence. | E3 store/row cases, one narrow view filter/table/edit flow |
| Teams | Team/week keyed Capacity owner avoids stale reuse from the dependency-less read hook; pending planning ownership is represented in source. | One team/week switch with pending save plus failed read→Retry; permissions remain server-owned |
| Settings/connections/Admin | Focused editors, bounded/searchable controls and full-value paths; source-only tests preserve consent and destructive copy. | One long provider/model picker, connection failure/retry, owned admin form cancel/save, R1/R2 overlay interaction |
| Auth/public/booking/legal | In scope; final surface evidence absent. Concise wording must retain consent and sharing consequences. | One narrow consent/auth form and public booking flow; preserve explicit material choices |
| Mobile/Expo | Separate mobile changes are extensive; responsive desktop is not evidence for them. | Final Expo cases across the families above; native/installed desktop remains excluded |
| Deployment/docs | Private compiler configuration and image correction inspected; no new Activity service/config required. | Changed-document/env coverage check, frozen image/ref receipt and ledger reconciliation; production deployment remains separate |

The inventory is useful provenance but its “source assessed” rows are not Reviewer or rendered acceptance. Resolve its remaining “Partial” rows (notably App, desktop DocEditor, mobile Settings and Projects) against the final implementation; do not simply relabel them as passed.

## Finite correction and verification plan

1. **Builder:** batch R1–R3 and the focused tests in E1–E3; retain supplemental typography fixes. Freeze one commit, identify changed paths, update the candidate map and partial inventory rows. Preserve old failed attempts.
2. **Tester, deterministic checks:** run the corrected picker suite once, the focused new Activity/import/compiler/controller/store tests, and existing chat-sweep coverage once. Run relevant workspace typechecks/builds after the final source batch. Keep complete result counts/log paths and exact ref. Reuse the other corrected suites and unaffected 29/29 and 142/142 evidence where source/dependencies remain unchanged; do not relabel those counts as new-contract coverage.
3. **Tester, bounded runtime:** one controlled import response-loss retry; one compiler negative-boundary batch; one document proposal accept/reject/failure per editing mode; one team/view deferred-response case. A mounted integration test can replace a manual runtime case when it proves the same contract. Stop after these cases; do not begin a broad exploratory scan.
4. **Visual Check, once stable:** one final shared-web and Expo-web batch at 320px, medium and wide, distributing light/dark and states rather than multiplying every axis. Cover shared controls/overlays, R1/R2 panes and sidebar resize, Chat/Work composer/history/lanes, all three document modes including a visibly rendered PDF, Activity details, and representative Tasks/Calendar/Focus, Projects/Views/Teams, Settings/Admin/connections, and auth/public/booking. Record actual viewport, ref, actions, result and capture; use long values and one recovery path where relevant. Fix/recheck only affected failures afterward.
5. **Reviewer:** inspect the batched correction diff and final receipts, close each finding explicitly, and issue the decision within this same round where possible. Acceptance requires the final web/Expo evidence; native builds, security scans and deployment are not added gates.

Optional maintenance, not blockers: consolidate similar account/mount ownership helpers after acceptance and reduce brittle exact-copy/source regex assertions over time. Do not use this review to reopen accepted platform checkpoints or start unrelated refactors.

## Same-round follow-up — pane/export corrections and common Note preview

Reviewed `90305ece`, the formal Tester receipt committed as `0a9afc57`, the additional owner direction in ADR 003, and the functional diff through `3704ec708231f1910c0b3d2749ae8599f2ef47a6`. Also inspected the two-file follow-up `f19566e9f85fb70be43fb4d95e4beed06022b27a`. Observed HEAD subsequently advanced to docs-only `e7f24397`; its two changed documentation paths do not alter these source conclusions. Counter remains **1/3**. No tests/builds/runtime/visual checks were executed by Reviewer.

### Original finding disposition

| Item | Current disposition |
| --- | --- |
| R1 shared narrow navigation | Source correction accepted: explicit portal host outside hidden panes, shared navigation dispatch remains focused-controller owned, portal events preserve focused pane. Mounted portal test proves placement and callback routing. Full App routing, keyboard, draft/scroll and actual 320/900px layout remain in final Visual acceptance. |
| R2 editor keyboard ownership | Closed for inspected source: `PaneInputOwner` and `ownsEditorKey` guard pane ownership, visible/inert ancestry, active dialogs and text fields before interception. Both menu handlers use the guard. Real-DOM helper tests cover yielding without destroying selection. Retain final browser integration case; do not call the helper test a full two-editor walkthrough. |
| R3 export identity | Closed: top-level items have additive IDs; each completion embeds its own task ID/title/parent identity, including subtasks. Test covers same-title items, subtask, timestamps, personal/team exclusion and legacy input compatibility. No new history backfill/import is claimed. |
| E1 Personal Activity | Closed for the named backend contract: real transition/recurrence, connected-account actor, work/break/idempotency, local start-day, fixed-clock DST SQL, null/zero, visibility/delete, snapshot and export assertions now exist and passed. The fixed-clock test runs the aggregation SQL with a replaced clock expression; it is not evidence of a real wall-clock DST rollover. |
| E2 receipts/compiler | Closed for the finite backend/lifecycle scope: new route tests cover both replay paths, payload conflict, duplicate execution, receipt failure rollback, response failure and current authorization. Compiler API/lifecycle tests plus actual image probes establish the named negative boundaries. UI rendering remains separate. |
| E3 regression/store/history | Original eight picker fixture failures superseded by the passing correction batch. Store and Chat/Work/sweep contracts now have scoped passing evidence. Parent/editor and rendered behavior limitations below remain. |

Tester records **63/63**, zero failed/skipped, across the 12 requested suites on product source `90305ece` (execution HEAD `87d0e8be` differs only in docs). Workspace build/typecheck and 132-variable environment coverage passed. The real compiler probe denied external read/write and the shell/network probe, terminated a nonterminating job after about 10 seconds, removed its workspace, retained health and successfully compiled a subsequent valid PDF. These receipts are retained; the later client presentation change does not invalidate the unchanged sandbox implementation.

The mounted TeamPlanning/TeamAttention and Views cases provide useful pending-save and read-retry evidence with one write; they use deterministic client/table stubs. The three labeled assistant-control cases mount shared controls, not all four editor parents. The new `doc-assist-formats.test.ts` exercises real API proposal/reject/accept persistence using a local stand-in provider, which is stronger format evidence but still not parent-mode UI or live-vendor evidence. Before this report was committed, Tester's working report recorded **49/49** affected source/store/mode/assistant/API tests, zero failures/skips, on exact `f19566e9` source at docs-only `e7f24397`, plus final workspace typecheck/build passes. Retain this receipt. Its wording about four-parent mode entry points is supported by source assertions, not mounted four-parent transition tests; the passing result does not contradict R4–R6.

### R4 — P2: source mode replaces the Note renderer instead of sharing its presentation lifetime

**Locations:** `desktop/src/features/docs/doc-source.css:198–203`; `desktop/src/features/docs/DocSourcePreview.tsx:630–672`; `desktop/src/features/docs/DocLatexPreview.tsx:75–104`; mobile equivalents `DocEditor.tsx:3233`, `DocSourcePreview.tsx` and `DocLatexPreview.tsx`.

The new owner contract says source appears beside the common Note output, and presentation changes retain zoom/disclosure/scroll. The implementation shares the PDF blob/URL, but not the actual rendered surface: CSS hides the normal Note children while source is open; DocSourcePreview renders another iframe (and another Markdown block renderer). Returning to Note unmounts that source preview and reveals a different renderer. On mobile, the legacy Note wrapper is similarly hidden and source owns another DocumentPdfPreview. A user who changes PDF zoom/page/scroll in source preview returns to a different Note viewer state, and vice versa. For mixed notes, the LaTeX source preview also shows just the PDF instead of the same surrounding Note content.

**Expected:** one stable Note render surface per editor/document, with source visibility/mode changing adjacent controls rather than replacing that surface. Preserve existing note blocks and viewer state across Note/Markdown/LaTeX and source hide/show.

**Builder guidance:** hoist the common Note renderer beside the source editor under the existing document owner. Keep its iframe/DocumentPdfPreview identity stable for presentation-only changes; update its PDF on actual compiled-source changes. Route source selection and headings into that same rendered tree. Remove the broad CSS sibling hiding once ownership is explicit. Preserve the existing invalid-source draft guard and narrow single-surface preference.

**Verification:** mount each actual editor parent, open source, hide/show source, return to Note, and assert the same rendered surface/iframe node remains for an unchanged PDF. Include mixed prose + equation + standalone TeX. Final Visual should exercise PDF page/zoom/scroll preservation on web and Expo. `doc-latex-note.unit.test.ts:94–108` constructs an artificial textarea beside DocLatexNote and therefore does not exercise the production replacement path; extend or replace it with parent integration coverage.

### R5 — P2: structured editors retain the superseded source navigation and a modal-era departure lock

**Locations:** `desktop/src/features/docs/StructuredDocEditor.tsx:785–793`, `:1203–1229`; `mobile/src/screens/docs/StructuredDocEditor.tsx:791–813`.

The web structured editor still exposes the Preview/Source/Split button group; mobile still exposes Source/Preview plus Split/Hide split. Choosing Markdown on web selects `activePane='source'` rather than the requested source-beside-Note presentation. This does not satisfy the newly explicit removal of nested source navigation in favor of one source-visibility control. In addition, the web `beforeLeave` still rejects whenever `latexOwner.current` is true, even though a `sourceLeaveCheck` is now supplied to the inline source. A saved, valid inline LaTeX page cannot follow ordinary sidebar/tab navigation until the user manually exits source; it silently returns false. The mobile structured parent already consults that leave check.

**Expected:** consistent primary Note/Markdown/LaTeX choices and one source visibility toggle in all four parents. A valid saved inline source can navigate normally; invalid source and pending mutations retain the draft and block departure with recovery.

**Builder guidance:** integrate structured Markdown into the same format/visibility owner as R4, preserving its lossless structured-source adapter. Remove the old nested button groups. Make the web structured departure predicate consult the latest inline validation guard, then save/check the existing store, matching the intended mobile behavior. Do not merely remove the guard or disable all mode changes while valid edits await saving.

**Verification:** actual web/mobile structured parents: primary mode transitions with saved and unsaved source, exactly one source toggle, wide split and narrow fallback; valid inline LaTeX tab/sidebar navigation succeeds; malformed source and pending saves block without losing content. `document-editor-modes.unit.test.ts` currently checks the standalone button component and parent source text, so it cannot detect these remaining controls or departure behavior.

### R6 — P2: multiple standalone TeX blocks display the first block's PDF as every block's output

**Locations:** `desktop/src/features/docs/DocLatexPreview.tsx:46`, `:75–93`; `desktop/src/features/docs/DocBlocks.tsx:351–353`; corresponding mobile provider `:44`, Note renderer `:56` and `DocBody.tsx:519`.

The provider selects only `docLatexBlock(blocks)` (the first marked block) and has one PDF. Both block renderers now send **every** `latex-document` code block to DocLatexNote. That component consumes the same context PDF without checking block identity; `source` is used only for a stale message. An imported or edited note containing two different valid TeX blocks therefore displays the first document twice and labels the second preview as updating indefinitely. There is no schema uniqueness constraint preventing this content. This is incorrect content presentation, not just a compile-performance preference.

**Expected:** a displayed PDF corresponds to the specific source block it represents. Preserve all original blocks even if only one canonical standalone document is supported for compilation.

**Builder guidance:** bind preview ownership to stable block identity. Either render only the canonical block through that store and retain honest source/fallback for other marked blocks, or use bounded per-block ownership if multiple compiled documents are intended. Do not compare only source text: retaining an older PDF while the same block is edited is explicitly required. Do not silently delete duplicate blocks or show another block's PDF.

**Verification:** a note with two distinct TeX blocks on both clients; each output is correctly identified or the secondary source remains honestly visible. Edit/reorder/remove the canonical block and ensure no stale PDF transfers to the other identity. Keep the same-block last-valid-PDF-on-error test.

### Additional source observations and remaining evidence

- `LatexPreviewStore` has explicit debounce/minimum start interval, readiness gating, generation-based cancellation, last-valid-PDF retention, explicit Retry and stop cleanup. The tests exercise these behaviors directly, including an abort-ignoring late result. Provider instances are keyed by account/document and object URLs are cleaned up. These are useful foundations for R4; sharing a URL alone does not close it.
- Legacy Read→source enters Edit only for `canWrite`; Suggest retains the read-only source callback gate. Structured callbacks also check `canWrite`. The compile API still rechecks ownership/version around work. No new source-level permission bypass was found in these inspected paths, but test the actual four parent transitions rather than treating a disabled button or API permission test as UI proof.
- The API rate change to 20/minute is explicit in the new ADR; automatic starts remain at least four seconds apart. The earlier compiler isolation/runtime receipts remain relevant; the new 49/49 receipt includes API/renderer tests on `f19566e9`. R4–R6 require only their affected correction checks at the next freeze.
- `f19566e9` excludes dialogs from sibling hiding. Its extra `setSourcePreview(null)` duplicates the immediately following existing call; harmless cleanup, not a new acceptance blocker. The prior call already returned to Note before opening the web legacy assistant request. Do not describe the duplicate setter as new functional evidence.
- Toast layout is a CSS change with source assertions; actual one-row dismiss reachability with wrapping text remains in the existing final Visual case.

### Revised finite completion plan

1. Builder batches R4–R6, retaining R1–R3 and the existing store/sandbox protections. Freeze one product/test ref and name the actual parent integration tests. No new full review round.
2. Tester retains the completed 49/49 document/store/API receipt and reruns only affected suites/types/build after the correction freeze. Add R4–R6 regressions and valid/invalid structured departure cases. Reuse the unchanged 63/63 backend/picker/store/sweep and compiler-boundary receipts; do not rerun the sandbox probes solely for presentation changes.
3. Retain the final visual plan as **prepared, acceptance pending** until source findings settle and Tester returns the fixture. In its existing document case, verify the same Note renderer, primary modes, source toggle, actual PDF state, assistant proposal visibility/accept/reject/failure and reader/Suggest authority on web and Expo. Keep the existing pane/resize/settings/planner/public cases; no per-edit sweep or new native requirement.
4. Reviewer closes R4–R6 against the correction diff and receipts, then issues whole-ADR approval only when the final web/Expo gate is complete. Until then: **changes required; final evidence pending; round 1/3**.

## Same-round follow-up — stable Note freeze `9b1fb984`

Inspected exact source `9b1fb9844aa09c486bfe93a90609990257889e8b`, including whitespace-insensitive diffs for all four parents, source adapters, preview providers/renderers, layout CSS and revised tests. The working tree contained only the two unrelated tracker/Visual documents before this report edit. Reviewer executed no tests/builds or browser actions. Counter stays **1/3**.

| Finding | Source disposition at this freeze |
| --- | --- |
| R4 duplicate Note renderer | Closed for the identified renderer-lifetime defect. Both source adapters accept `sourceOnly` and omit their PDF/Markdown render tree. Parents keep the original Note subtree mounted; desktop uses adjacent grid areas, mobile retained sibling panes. Presentation changes no longer substitute a second PDF renderer. Actual viewer zoom/page preservation still needs the final browser case. |
| R5 structured controls/departure | Closed for inspected source. Nested Preview/Source/Split controls are removed. Primary choices use `chooseFormat`, save dirty valid content, and recheck account/document/conflict state before adoption. Web inline departure now consults `sourceLeaveCheck` before existing save/validation checks. Wide Markdown requests split; narrow uses the retained one-surface fallback. |
| R6 incorrect duplicate-block PDF | Closed for the canonical stable-ID path. Provider ownership includes document/account/block identity; only the matching block renders its PDF. Secondary marked blocks retain actual source. Switching canonical IDs creates a fresh store and discards old results. |

The revised provider tests mount both client providers and assert one viewer, the same unchanged iframe node, visible secondary TeX source, canonical reorder, fresh compilation and cleanup. Source-only adapter tests assert absence of the second renderer. These are appropriately named component/provider tests, not four-parent integrations; native PDF presentation is stubbed. The final visual plan explicitly retains actual four-parent transitions. Builder reports 38/38 development checks and both client types; at this report cutoff no formal Tester receipt for `9b1fb984` is recorded. Do not promote development counts to formal qualification.

For legacy blocks without IDs, the provider uses current index as a fallback identity. The new tests use stable IDs. Keep this limitation explicit: the reorder assertion does not establish identity preservation for arbitrary id-less replacement at the same index. Prefer assigning stable IDs at the existing document normalization boundary if such content must support persistent preview identity; no broader migration/refactor is requested by this review.

### R7 — P2: mobile legacy source layout uses window width instead of editor width

**Location:** `mobile/src/screens/docs/DocEditor.tsx:337–339`, `:3132` and `:3248`; containing layout `mobile/src/screens/docs/DocsSheet.tsx:292–294`, `:905–906`, `:2959–2963`.

`sourceBesideNote` is computed from `useWindowDimensions().width / fontScale >= 900`. The actual editor can be much narrower: DocsSheet displays a 300px library beside an open document when its outer pane is at least 1000px and multiple documents exist. At a 1000px Expo window, the editor has roughly 700px before padding, yet the new code selects the wide two-column source/Note layout and hides the adapter's compact mode controls. This bypasses the ADR's explicit available-pane-width fallback and differs from the measured structured editor. It also fails to respond when only the containing library/pane changes size.

**Builder guidance:** measure the legacy editor's containing View with the existing `usePaneWidth`/`onLayout` pattern, retaining `useWindowDimensions` only for font scale if needed. Derive source/Note splitting and `showModes` from that measured width. Measure the outer editor before splitting, not either half, to avoid breakpoint oscillation. Keep both surfaces mounted and preserve the chosen draft/mode.

**Verification:** one focused parent/layout regression with window width 1000 or 1200 and measured editor width 700 must select one surface; increasing actual editor width past the threshold must restore the split without losing draft or viewer identity. Include library-open versus library-hidden in the existing final Expo editor case; no new screenshot sweep or native gate.

**Current decision:** changes required for R7; R4–R6 source corrections accepted. Tester should complete the already assigned affected batch, then retest only R7's changed paths and relevant types after its small correction. Retain unchanged backend/compiler receipts. Final actual-parent interactions, PDF appearance/state, pane routing and the rest of the existing web/Expo batch remain required for whole-ADR approval. All work stays within round **1/3**.

## Same-round closure of R7 — `3f7cd319`

Inspected exact commit `3f7cd319d7a23842d5c78f14159daf17fdaf5667`, its three-file diff, the existing `usePaneWidth` implementation and its measurement regression assertions. **R7 source finding closed.** The legacy editor now measures its outer root View via `onLayout`, applies the existing font-scale-aware 900pt threshold to that measured width, and uses window dimensions only for font scale. The measured node contains both surfaces, so the breakpoint is not calculated from one split half. The hook retains positive measured width through unrelated window changes and ignores invalid/hidden zero measurements.

The added test checks source wiring; existing hook tests execute measurement updates. Together they support the correction's mechanism but do not mount the full editor/library. Builder's reported 29/29 and mobile typecheck remain development receipts until Tester's formal affected result is recorded. The existing final Expo case at a roughly 1000px window with the library open/hidden remains the rendered qualification; no additional gate or sweep is added.

**Latest decision: evidence pending, round 1/3.** No R1–R7 source finding remains open. The candidate can proceed through the already planned affected Tester qualification and final bounded shared-web/Expo batch. Retain actual four-parent transitions, draft/permission/failed-save behavior, unchanged PDF viewer state and the existing whole-scope cases. Source closure is not whole-ADR approval, merge, push or deployment. Reviewer changed only this report and ran no tests/builds, runtime actions, scans or browser checks.

## Scoped visual-blocker review V1 — `239ce769`

Inspected exact commit `239ce76918258f33c28fda5d7e6d1cf31316591d`, the complete menu/test diff, the retained before/after TAP summaries, and Visual Check's partial working report. **V1 source correction accepted; browser closure pending.** Core's supported heading levels 4–6 had no entries in the icon map, so both SlashMenu and DocBlockMenu could pass an undefined component to React. The correction imports/maps actual Heading4/5/6 icons and applies the existing valid Type icon as fallback in both lookup paths. It does not change selection callbacks, document writes, authority or menu dismissal.

The regression renders both production menu components with real React/Lucide and the actual BLOCK_KINDS catalog. Before-fix receipts record **0/2 passing, 2 failing**; after-fix receipts record **2/2 passing**. This is meaningful coverage for the reproduced undefined-component failure. Popover placement is stubbed and server rendering does not execute effects, so keyboard positioning, dismissal/focus and successful insertion/conversion remain the focused browser recheck. Builder's desktop typecheck and 2/2 are development receipts; the formal Tester V1 receipt was not yet present at this review cutoff. Reviewer did not execute them.

The working Tester report now supplies formal **38/38** R4–R6 checks with workspace types/build at `9b1fb984`, and **29/29** R7 checks plus mobile types at `3f7cd319`. These close the previously pending scoped execution evidence; they remain component/source/store evidence, not full-parent rendered acceptance. Retain all earlier failed attempts and their exact refs.

Visual Check's partial report independently reproduces the slash-menu crash on the earlier source and explicitly leaves the remaining batch unrun. Its empty LaTeX fixture establishes neither a successful live PDF nor a confirmed rendering defect. The existing document case must use actual nonempty standalone source, show a compiled PDF, edit/save it, and check Note/source persistence; a reproduced failure should be recorded as a finding. The initial Expo policy block is historical evidence, not a pass; resumed allowed execution must supply its own results. No alternate browser or policy bypass is requested by this review.

**Decision remains evidence pending, round 1/3.** Retain R1–R7 source closure. Finish only V1's formal two-test/types/build check and its affected menu recovery case, then continue the already prepared final web/Expo batch. No new review round, broad rerun, native gate or security scan. Only this Reviewer report was changed.
