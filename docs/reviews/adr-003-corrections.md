# ADR 003 — round 1 correction handoff

15 October 2026. Review counter remains **1/3**. Checkout:
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`.
This batch follows `5b10872e`; its commit is the source freeze for qualification.
No acceptance, merge, push or deployment is claimed here.

## Source corrections

- **R1:** narrow paired panes portal one shared header/navigation outside either
  hidden content pane. Navigation/search use the focused controller; tab strips
  stay with their pane. Shared-chrome pointer/focus events do not change the
  focused pane. The host is explicitly passed into the primary controller.
- **R2:** document selection shortcuts and both editor menu Escape handlers
  check live pane, visible DOM, input and modal ownership before interception.
  Yielding ownership retains the selection.
- **R3:** version-1 exports add stable optional IDs to top-level items. Each
  completion embeds `{id,title,parent_id}` alongside `item_id` and its original
  timestamp, resolving subtasks and duplicate titles offline. Import remains
  compatible with archives without these additive fields; completion history
  is not backfilled or imported. Team/other-account content stays excluded.
- Complete the web picker's VM fieldset identity fixture; retain prior failures.

## New finite regression coverage

| File in `backend/tests`               | Contract                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `personal-activity.test.ts`           | Auth/ranges, unknown vs zero, real status transitions, recurring tasks, connected actor, work/break/idempotency/local midnight, DST aggregation with fixed SQL clock, visibility removal/deletion, snapshot timestamps, personal export/legacy archive |
| `import-receipts.test.ts`             | Both routes: exact replay, concurrent duplicate, input conflict, receipt-write rollback/retry, post-commit response failure, deleted auth; page team permission recheck                                                                                |
| `import-retry-component.unit.test.ts` | Actual mounted web import component retains input/preview and retry key after response loss, clears after confirmed success                                                                                                                            |
| `latex-preview.test.ts`               | Actual API and controlled private compiler: auth/ownership/version/byte bounds, missing/failing compiler, no-store PDF, in-flight revision and permission changes discard output                                                                       |
| `latex-renderer.unit.test.ts`         | Renderer lifecycle with controlled child process: successful two passes, unavailable/failure/timeout/cancel/invalid PDF and private workspace cleanup; pre-job bounds                                                                                  |
| `view-draft-store.unit.test.ts`       | Actual store: queued newer draft, failure/retry, account generation/late results, pane subscriber close and forgotten item                                                                                                                             |
| `editor-input-ownership.unit.test.ts` | Real DOM key ownership helper and mounted shared-chrome portal. This is not a full App routing or real-browser keyboard claim. Final visual case covers that integration.                                                                              |
| `chat-modes.test.ts`                  | API Chat/Work/project history, open/rename/pin and account isolation                                                                                                                                                                                   |

Builder development attempts are not the formal Tester receipt. Initial Activity/
import run had three fixture failures (422/404 expectations and recurrence input).
After corrections, the six-file development batch was 38/39 (recurrence fixture
still omitted fields); the next Activity/Chat run passed. Keep those attempts in
private logs `/private/tmp/orbyn-adr003-builder-activity-import.tap`,
`/private/tmp/orbyn-adr003-builder-corrections-2.tap`, and
`/private/tmp/orbyn-adr003-builder-final-contracts.tap`. Compiler lifecycle 7/7 and
mounted import 1/1 passed in separate development runs; an earlier import fixture
syntax error was corrected. Desktop typecheck and env-template coverage pass.
Later team-export exclusion assertion is to be formally executed at the freeze.

## Tester — execute once on this complete batch

1. Confirm frozen source; build packages, relevant workspace types/builds. Execute
   the eight new files above, `searchable-picker.unit.test.ts`, existing
   `chat-sweep.test.ts`, and existing `pdf-client.unit.test.ts` /
   `pdf-service.unit.test.ts` for shared cancellation/service contracts. Use the
   marked `_test` database through `backend/tests/setup.ts`. Preserve exact counts
   and complete private logs; retain earlier 29/29, 142/142 and corrected suite
   evidence only for unchanged assertions, not the new contracts.
2. One finite actual compiler image batch: denied external file read/write,
   disabled shell/network access and a bounded nonterminating TeX job; confirm
   private job directories removed, slot released and a later valid compile
   succeeds. Existing owned container `orbyn-u1-latex-fix`, image
   `orbyn-u1-latex-qa:candidate-7dfd1b9`, loopback `18000`, private key from the
   protected QA env. Inspect actual service state. No scan or fuzzing.
3. Finite runtime/mounted acceptance still needed: one proposal accept/reject/
   failed-response-retained instruction for each document mode; one team/week
   pending-save/read-retry case; one View confirmed row save then failed refresh
   and Retry (no second write). These can use deterministic mounted integration
   when it proves the same behavior. Do not label store unit tests as row-refresh
   or proposal UI coverage.
4. Final browser pane routing, keyboard, independent drafts/scroll, picker
   reachability and actual PDF appearance belong to the final Visual batch.

Protected QA env and visual credential handoff paths remain in the candidate
handoff; never print values. Preserve other sessions' working documents.

## Historical inventory reconciliation

The old Partial rows remain historical evidence, not converted into passes.
Their concrete source follow-through is included in the integrated candidate:
App shared controller/portal and editor input guards (R1/R2); normal/structured
and source document owners; mobile Settings action and presentation guards;
Docs/Projects common departure/load owners. Runtime and rendered acceptance for
these paths is pending the finite cases above and the final web/Expo report.
Use those final reports to close each requirement, rather than treating a source
submission or this table as acceptance.

Reviewer closes R1–R3/E1–E3 within round 1 after receipts. Visual Check then gets
one stable whole-candidate shared-web/Expo batch from the candidate map; only
reproduced failures get affected rechecks. Native builds and production deployment
are excluded.

## Owner document and toast corrections — 15 October (additional frozen batch)

All four editor parents expose Note/Markdown/LaTeX directly. Source opens inline;
Note renders ordinary blocks, equations and standalone LaTeX PDF. A shared
account/document store retains the PDF when source is hidden or Note is selected.
Read-to-source enters Edit only for a writer. Source/Split/Preview navigation is
removed in favor of one source visibility toggle. Compilation is automatic on
saved source, with bounded debounce, cancellation, failure retention and Retry.
Toast message/dismiss layout stays on one row with wrapping within the message.
No environment variables were added. The API rate rises from 6 to 20/minute.

Development evidence: 35/35 source/store/provider/mode tests and desktop/mobile
types passed. The first provider fixture used `language` rather than schema `lang`
and failed; corrected fixture passes. Three guarded real-API/DB assistant tests
passed with a local stand-in provider: Note, Markdown equations and standalone TeX
each remain unchanged before approval, reject without edits and persist after
acceptance. The fixture restores AI settings and deletes its user/provider.
These are Builder checks, not rendered acceptance or formal Tester qualification.
Logs: `/private/tmp/orbyn-adr003-note-preview-dev-2.tap`,
`/private/tmp/orbyn-adr003-note-types-2.log`,
`/private/tmp/orbyn-adr003-assist-formats-dev.tap`.

## Batched review corrections R4–R6 — 15 October

- R4: Source-only adapters now sit beside the original Note pane. They do not
  mount another PDF or Markdown renderer. The Note stays mounted when narrowed,
  hidden, or switched among Note/Markdown/LaTeX; ordinary surrounding blocks stay
  in that same rendered tree. Source mode no longer broadly hides all editor
  children. Legacy and structured parents share this composition on both clients.
- R5: Structured editors use primary format choices and a single source visibility
  action, with wide split and narrow single-surface fallback. Valid source mode
  changes save through the existing store; invalid/pending/conflicted work remains
  guarded. Web departure consults the inline leave check before the existing save
  and draft checks, matching mobile. The nested three-way controls are removed.
- R6: The canonical standalone block owns the preview by stable block ID (legacy
  id-less blocks use their current index). Switching canonical owners creates a
  fresh store and discards old results. Other standalone blocks retain their
  actual source, never another block's PDF. This preserves duplicate/imported
  content without claiming multiple compiled standalone documents per Note.

Builder checks: 38/38 finite source/store/provider/mode tests and web/mobile types
passed. Provider tests now cover both clients, canonical reorder and multiple
TeX blocks, actual unchanged iframe identity with sibling source controls, and
teardown. Source-only tests verify the adapter leaves rendering to its parent.
These remain component/store checks: full four-parent transitions, PDF zoom/page
and real navigation are assigned to the final Visual batch; do not describe the
component fixture as complete parent integration.
Logs: `/private/tmp/orbyn-adr003-stable-note-dev-2.tap`,
`/private/tmp/orbyn-adr003-stable-note-types-6.log`.

### R7 — available editor width

Mobile legacy uses the existing `usePaneWidth` hook wired to its root `onLayout`,
then applies the existing font-scale-aware 900pt split threshold to that measured
width. It no longer infers available space from the whole window. A source wiring
regression plus the existing real hook measurement cases passed (29/29 finite
checks); mobile types passed. Final Expo checks include the library open around
a 1000px window, then hiding it and resizing to verify single/split behavior and
retained Note state. Logs: `/private/tmp/orbyn-adr003-pane-width-dev.tap` and
`/private/tmp/orbyn-adr003-pane-width-types.log`.

## Visual blocker V1 — Note block menu

The actual browser reproduced an undefined component crash in SlashMenu. Core
supports headings 4–6, while the web menu icon map stopped at heading 3. Both the
slash and block-conversion menus rendered undefined icons. Added the three actual
Lucide icons and a safe Text icon fallback for future block kinds.

A renderer regression with real Lucide components failed 0/2 on the prior source
with the same React error, then passed 2/2 after correction; desktop types passed.
The test stubs Popover placement, so visible keyboard/menu recovery remains in the
existing browser recheck. Logs `/private/tmp/orbyn-adr003-slash-regression-before.tap`,
`/private/tmp/orbyn-adr003-slash-regression-after.tap`,
`/private/tmp/orbyn-adr003-slash-types.log`. Preserve the failed receipt.

## Visual corrections V2–V7 — batched candidate

- V2: replace host PDF-plugin rendering with the same bundled offline PDF.js
  runtime in web and mobile, sandboxed with no network or host DOM access. Keep
  page/zoom state when source visibility or compiled PDF changes; retain download.
- V3: anchor source controls together at the top. Show preview failure status and
  keep the full error/Retry in common Note rather than repeating it in source.
- V4: remeasure legacy title wrapping when its width changes.
- V5: suppress the redundant outer Agent notes heading using its actual view ID.
- V6: shared blue for new/default booking pages; preserve explicitly saved colors.
  The older green QA fixture is a saved custom value, not a global theme control.
- V7: portal Focus to the viewport root, preserving underlying pane scroll.

Builder development receipts: 62/62 finite checks passed after the final
viewer error/theme/resource-bound corrections; desktop/mobile types passed.
Earlier backend types passed; the affected batch is repeated on the freeze by Tester. Actual PDF
decode/text extraction/painting is exercised with PDF.js and a real canvas;
controller tests cover message gates, page/zoom persistence and bundled isolation.
These are not browser or native acceptance. New source assets, workspace hooks
and Docker builder dependencies are included; no environment additions are needed.

Final Visual Check must recheck V2–V7 and only the previously unrun cases in its
report. User has now reported allowing Expo navigation again: retry the assigned
8083 URL through the supported browser once, preserving any actual policy error.
Do not bypass a persistent browser restriction. Round remains 1/3.

### V2 viewer lifetime correction

Scoped Reviewer identified a desktop-only remount between a new compiled blob
and its asynchronous download URL. Note now mounts the viewer from the owned
PDF state and permits a temporarily unavailable download link. The iframe stays
mounted across a same-block recompile; account/document/canonical-owner changes
still reset it. The provider regression now changes source, recompiles, and
asserts the same actual iframe node on both clients. Builder's affected result
is 2/2; page 2/zoom persistence remains a final browser case. The initial attempted
before-fix run did not finish before the source correction and supplies no valid
before/after comparison. Scoped review found no further V3–V7 source defect.

## V8 — mobile containing width and control consistency

Actual Expo1400px inspection found the editor still capped by DocsSheet's
shared600px reading column; its measured900px split could never activate.
Open documents now use the available column width; the library retains its300px
width without flex growth. Closed library/search lists keep their reading column.
Source format choices reuse DocEditorModes (including LaTeX-only support), with
soft selected state. PDF download uses the mobile palette and touch target;
empty string error guards no longer render text children under native Views.
Builder37/37 affected checks and mobile types passed. Recheck wide source/Note
split, library-open narrow fallback, retained PDF state and phone controls.
