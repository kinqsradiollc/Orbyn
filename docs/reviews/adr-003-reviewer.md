# ADR 003 technical review — round 1/3

Decision: **changes required**. Whole-ADR acceptance also remains **evidence pending**.

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
