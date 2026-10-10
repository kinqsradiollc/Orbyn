# C4/D1 delivery record

## Latest Reviewer decision — ccae5a60

**Changes required, round 1/3; full C4/D1 remains unaccepted.** R3 caller
corrections are accepted at source level, with browser interaction pending.
R4 still has a concrete defect: Preview scrolling selects quote/list wrapper
paths that are absent from its block-only source map, so nested content does
not synchronize back to Source. The saved Browser Use Block is a separate
external gate. The full ledger also retains rendered-export, authorization
and source-equivalence evidence work; the checkpoint is not held solely by
browser access. Preserve native/exhaustive/routine-visual exclusions.

Correction and qualification guidance:
[`c4-d1-review-r1-ccae5a60.md`](./c4-d1-review-r1-ccae5a60.md).

Started 10 October 2026 from pushed main `6410c65c` on
`codex/c4-docs-parity`. Builder owns implementation until the complete stage
is frozen for Test → Review. Review round: **1/3**. Production deployment is
user-owned.

| Area               | Implemented on this branch                                                                                                                                                                                                                                                                                     | Qualification still required                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Complete ownership | Versioned format 2 creation, reads/writes, leaf and structure operations, extraction, linking, clipping, checklist/task state, history snapshots and restore retain the container tree. Legacy clients receive only the supported projection.                                                                  | Tester checks the frozen candidate, including auth, conflict and history paths.                    |
| Normal editor      | New pages begin in format 2 on web and mobile. Both clients open full ownership and use one title/content revision with source and preview, serialized saves, live revision reconciliation and explicit conflict retention. Mobile queues a failed offline save; navigation waits for a save or queue receipt. | Tester report and functional client checks where available.                                        |
| Page actions       | Structured web editor has comments, history preview/restore and version-fenced export. Mobile keeps the existing comments/history sections and offers export, move and library actions.                                                                                                                        | Confirm rendered layout and keyboard behavior where permitted.                                     |
| D1 content         | Existing Markdown, reference, frontmatter, math, code and restricted Mermaid renderers and export adapters are retained. Source/preview shares one draft; web source ranges map to preview blocks.                                                                                                             | Tester selects the required syntax, diagram, malformed input and export checks for this candidate. |

Builder diagnostics so far: `npm run typecheck` passed for shared packages,
backend, desktop and mobile. Focused structured storage/editor/source/export/
Markdown/Mermaid/math run: **115 passed, 0 failed, 0 skipped** against the
disposable `orbyn_test` database. The candidate is not yet accepted or on main.

Explicit user exclusions: no separate desktop-app check, installed iOS or
Android build, or exhaustive 200% retest. The user stopped routine Visual
Check; no browser screenshot result is claimed here.

Tester execution record for the superseded `c270a9bc` candidate: see
[`c4-d1-tester-r1-c270a9bc.md`](./c4-d1-tester-r1-c270a9bc.md). The later
exact-candidate execution is recorded below.

Reviewer round 1 decision on `1b76c6c3`: **changes required**. Report:
[`c4-d1-review-r1.md`](./c4-d1-review-r1.md).
Open findings: invalid-source validation cleared by unrelated edits/receipts;
mobile offline acknowledgment without durable, draft-specific persistence;
missing structured-editor fragment navigation. The report also identifies
targeted test receipts and the pending confirmation-dialog interaction check.
Builder corrected all three findings in source and added store/storage regressions.
Full workspace typecheck and 52 targeted checks pass on the working revision.
Tester owns the final source-exact execution, including the app-dialog interaction
now that the user has approved local QA sign-in. Reviewer owns closure. No
main-integration acceptance yet.

## Tester execution — 45a80ca

Tester retested the exact frozen candidate `45a80ca14a0de54148e804111642f38c1257aed4`.
The focused ownership and durable-receipt suites passed 91/91, workspace typecheck
passed, and section-navigation tests passed 2/2. The History restore modal and
same-page fragment navigation passed on the available web surfaces. R1 invalid
source recovery passed interactively on web and Expo web. **Disposition: HOLD**
because cross-page structured-document links with a fragment still return HTTP
409 on both surfaces and do not open the initial target. The complete execution
record, remaining limits, and cleanup evidence are in
[`c4-d1-tester-r2-45a80ca.md`](./c4-d1-tester-r2-45a80ca.md). No acceptance,
merge, push, or deployment is claimed.

## Builder correction after the 45a80ca hold

The web and mobile deep-link entry points now read format 2 Docs with the
editor-capable API before opening a cross-page fragment. The structured editors
show a concise in-page message for a missing target instead of sending that
navigation result to the generic global error handler. Cross-page app links
wait for a clean save receipt (or mobile's durable offline receipt), so a draft
stays open if saving fails or newer typing arrives during the request. Full
workspace typecheck passed after these edits. The revised candidate still needs
Tester's focused web and Expo web cross-page, initial-target, missing-target
and dirty-draft retest, followed by Reviewer closure; it is not yet accepted
for main.

## Preliminary Reviewer correction

The source-only [round 1 preliminary review](./c4-d1-review-r1-preliminary-907f45bd.md)
found two more cases before final browser qualification: an older offline save
could acknowledge a newer invalid Source buffer, and an initial mobile fragment
with no target was silent. Builder now retains the validation error through
failed save receipts, refuses an offline acknowledgment or leave while Source is
invalid, and reports a missing initial target in the editor. A failed conflict
refresh also keeps that validation error. The focused store and caller guard
regression passed 7/7; full workspace typecheck passed. These
edits await exact-candidate Tester retest and Reviewer closure within round 1/3.

## Tester execution — b556bac

Tester retested the exact candidate `b556bac61702e01dfeafecd5e8fe22cd3c2d40f8`.
Focused store/replay/navigation tests passed 14/14 and workspace typecheck passed.
Web and Expo web cross-page heading, explicit-block, missing-target, and valid
dirty-handoff paths passed. **Disposition: HOLD** because a mobile object link
bypasses the structured editor leave guard: following a cross-page link with an
invalid Source buffer navigates away and loses that unsaved buffer. Exact
execution, route evidence, cleanup, and remaining limits are in
[`c4-d1-tester-r3-b556bac6.md`](./c4-d1-tester-r3-b556bac6.md). Review remains
within round 1/3; there is no acceptance, merge, push, or deployment.

## Builder correction after the b556bac6 hold

Mobile object pills now hand their destination to the current document's
navigation context, so a structured editor can save or refuse departure from
an invalid Source draft. Links in embedded sections and linked-task embeds use
the same guarded route. A caller-level pill regression, section-navigation
checks, and the affected editor-store checks passed 12/12; workspace typecheck
passed. The revised candidate awaits Tester's focused invalid-Source handoff
retest and Reviewer closure within round 1/3. It is not yet accepted for main.

## Tester retest — 428c7b4d

Tester retested the exact correction `428c7b4d25c32b828a17a35f48fe918c99bda78c`.
The focused store/navigation/object-pill checks passed 12/12 and workspace
typecheck passed. On Expo web, an invalid Source buffer now stays on the target
when its object link is tapped, with the local guard message and buffer intact.
A valid dirty-title handoff still saves and opens the launcher. The prior mobile
object-pill finding is closed for this candidate; Reviewer closure remains
pending in round 1. Exact results and cleanup are in
[`c4-d1-tester-r4-428c7b4d.md`](./c4-d1-tester-r4-428c7b4d.md). No merge, push,
deployment, or overall checkpoint acceptance is claimed.

## Reviewer decision on 428c7b4d — round 1/3

The [source and evidence review](./c4-d1-review-r1-428c7b4d.md) closes the
invalid-source, durable-receipt, and tested object-pill findings. The full
C4/D1 checkpoint remains **changes required**: Mermaid and desktop rich-content
links still bypass draft guards, the structured desktop editor lacks Source/
Preview scroll synchronization, and the full D1 requirement-to-evidence ledger
has not been completed. Builder owns the batched corrections, then Tester
rechecks affected paths and Reviewer closes round 1/3. No main integration yet.

## Builder correction in progress

Mobile Mermaid links and web object pills, Mermaid nodes, embedded sections and
linked-task embeds now use their containing editor's navigation guard. The web
structured editor has paired Source/Preview scroll handlers using its current
source-to-block map. These changes need bounded visual inspection and Tester
interaction checks; no closure or main integration is claimed yet. The D1
requirement-to-evidence ledger is still being assembled.

The [full C4/D1 ledger](./c4-d1-requirements-ledger.md) now maps the governing
rows to implementation and available test receipts, with uncovered checks left
explicit. Source/Preview scrolling was refined to use unwrapped source lines
and rendered block positions instead of a character-count fraction. Desktop
typecheck passed after the code change. The requested bounded visual check is
open: Visual Check lacks browser control, and Builder's internal browser is
blocked from the local preview by a saved site permission. Neither session
claimed screenshots or a rendered-layout pass. Tester/Reviewer closure remains
within round 1/3 after the final candidate is frozen.

Builder's focused guard regressions passed: desktop Mermaid 4/4 and web/mobile
embedded-section routing 2/2. Backend typecheck passed. These are development
checks on the working tree, not Tester's frozen-candidate qualification.
Web and mobile linked-task actions also now have caller-level guard assertions;
the focused 2/2 run and backend typecheck passed on the next working candidate.

The desktop editor now uses its available content width to choose a two-pane
layout or a compact Preview/Source switch. Preview clicks open the matching
source line; source-caret navigation scrolls within the preview instead of
moving the whole page. The inactive narrow pane retains its scroll geometry.
This is a code-based correction, not a visual pass: browser permission and
Visual Check tool availability still block actual rendered inspection.

A combined format-2 import/edit/Markdown-and-HTML-export fixture now covers a
nested task list, table, image and Mermaid fence in one draft. The focused
export suite passed 6/6. Tester must qualify the frozen candidate; Reviewer
must still close round 1/3 before main integration.

## Tester execution — `ccae5a60`

Tester qualified exact candidate
`ccae5a609ad79218cfd94069802ab42ea1cbee6c` on
`codex/c4-docs-parity`. Workspace typecheck passed; the focused navigation,
source-map, renderer, and export command passed **62/62**. This includes web and
mobile caller assertions for linked tasks, embedded sections, and Mermaid
links, plus the combined format-2 Markdown import/edit/export fixture. No
database tests or application writes were run.

**Disposition: HOLD.** Browser interaction for invalid-Source guarded handoff,
desktop bidirectional Source/Preview scrolling, and responsive pane behavior
could not be performed because the saved browser-use Block applies to the local
preview. No alternate browser or origin was used. Source inspection and unit
tests do not establish those interaction or visual gates. Round 1/3 and the full
C4/D1 checkpoint remain open. Exact commands and limits are recorded in
[`c4-d1-tester-ccae5a60.md`](./c4-d1-tester-ccae5a60.md).

## Reviewer correction and rendered-export evidence

The [round-1 continuation review](./c4-d1-review-r1-ccae5a60.md) accepted the
rich-link guard wiring at source level, but found nested quote/list wrappers
shadowing mapped leaves in Preview-to-Source scrolling. Builder now selects
only editor leaf elements in both scroll directions. A focused DOM-geometry
regression exercises nested quote/list order and suppression of a synthetic
reverse scroll; the source-map pair passed 8/8. Backend and desktop typechecks
passed. These are Builder checks pending a new frozen Tester pass.

For the non-visual D1 ledger, the scoped diagram/privacy/image/math unit run
passed 43/43 after the two real-loopback image tests were rerun with local HTTP
permission. The first sandbox attempt passed 41/43 and failed those two at
`listen EPERM`; no assertion failed. On the disposable marked test database,
`export.test.ts` and `publication-renderer.test.ts` passed 33/33, including
actual rendered PDF/HTML ten-family Mermaid and math cases plus revision and
authorization fences. These receipts do not establish application UI rendering
or interactions while browser access is blocked.

## Tester retest — `8a449bce`

Tester qualified exact candidate
`8a449bce17341fbc0fb2be19d665b4d6b0e734c9` on
`codex/c4-docs-parity`. Workspace typecheck passed. The focused scroll, source
map, diagram/privacy/image/math/Mermaid, container-export and revision-client
run passed **67/67**, including the four scoped media-security suites at
**43/43**. `export.test.ts` plus `publication-renderer.test.ts` passed **33/33**
after a preflight verified the dedicated database `orbyn_test` and
`orbyn.environment=test`. These tests cover rendered ten-family PDF/HTML,
authorization and revision fences, and publication access changes.

**Disposition: HOLD.** The nested quote/list scroll-selection defect passes the
focused exact-candidate DOM-geometry and feedback-suppression regression. Real
browser verification of bidirectional scrolling, responsive panes, rich-link
draft handoff, and narrow overflow remains blocked by the saved local-preview
Block; no alternate port or capture path was used. Full C4/D1 acceptance and
round 1/3 remain open. Exact commands and evidence limits are in
[`c4-d1-tester-8a449bce.md`](./c4-d1-tester-8a449bce.md).

## Non-visual ledger reconciliation after review

The [8a449bce Reviewer continuation](./c4-d1-review-r1-8a449bce.md)
identified no new code defect and closed the nested-wrapper finding at
source/regression level. It retained the browser interactions and two ledger
questions. For task/collaboration domain behavior, the Docs backend/core and
relevant task/comment/CRDT tests are unchanged from Tester's 45a80ca
qualification through 8a449bce (`git diff --name-only 45a80ca..8a449bce`
returned no matching paths). Current linked-task callers passed the 8a449bce
focused test. This is source equivalence, not a live multi-client pass.

Builder added one format-2 import/edit/export fixture for frontmatter, folded
callout, highlight, references, footnote, heading navigation and unsupported
raw source. Its first run failed because the serializer canonically moves the
callout title onto the next quote line; the assertion was corrected to check
that retained canonical form. The export suite then passed 7/7. Tester must
qualify the next frozen revision. The disposable test Postgres container was
removed after the rendered-export retest. Browser interaction remains the
checkpoint's open external gate.
