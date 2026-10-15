# Document writing redesign

Decision: [ADR 004](../adr/004-document-writing-experience.md).
Baseline: `b11b1429`. Branch: `codex/docs-writing-redesign`.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Phase: owner refinement qualification. Review counter: 2/3.
Current product freeze: `09d17c2c`.

The owner rejected the delivered document experience. ADR 003's acceptance and
button-size results remain historical evidence; they do not qualify this redesign.

## Scope

| Surface | Change | Required evidence |
| --- | --- | --- |
| Structured web Note | Writing column, unboxed title, inline replacement editing, contextual block tools, Add text | Actual typing, keyboard/touch menu, save and source-return behavior |
| Legacy web Note | Plain canvas, compact format/mode tools, consolidated secondary actions | Existing note editing and page-menu reachability |
| Structured mobile Note | Inline replacement editing, action sheet, one status, Add text | Expo narrow editing, context actions and source transitions |
| Shared format controls | Quiet and consistent across both document formats and clients | Wide/narrow and light/dark layout |
| Storage and authority | Existing operation/store/permission/approval contracts retained | Affected formal regressions and read-only review |

Current qualification, acceptance and main integration are complete.
No production or native result is claimed. Preserve the unrelated Visual-owned
`c6-production-visual-2026-10-11.md` edit.

## Implementation and development evidence

Structured Note now uses an unboxed, wrapping title, a bounded reading column and
natural web page scrolling. An active field replaces its block in place; keyboard
Enter starts editing and Escape returns focus to the block. Links and real text
selection retain their behavior. Context tools use the existing Popover on web
and action sheet on mobile, with direct mobile text activation through DocBody.
Both clients append a structured paragraph directly from Add text, preserving
container ownership and generating a stable ID. Save remains explicit for dirty
or failed drafts; normal status is singular. Legacy web consolidates history,
link-copy and details into More, and uses one named mode picker. All parents keep
the same optional source/Note/PDF mechanisms.

Initial development batch passed21/22: the format-control harness lacked the new
owned CSS import stub. Added that stub without changing the product to suit the
harness. The corrected affected batch passed56/56, including mounted in-place
editing/input/Escape, selection/link/read-only/source boundaries, format choices,
PDF ownership, store recovery and pane/dialog input ownership. Both workspace
typechecks passed during development. These precede final formal qualification;
later title wrapping and final presentation adjustments remain in the freeze.
Private logs: `/private/tmp/orbyn-doc-writing-dev.tap`,
`/private/tmp/orbyn-doc-writing-final-dev.tap`, and the
`orbyn-doc-writing-*-types-final.log` files. No backend, environment or service
configuration changed. Local previews still use the existing disposable QA API.

## Round 1 — retained code viewers

Tester `33fd1626` qualified the complete batch at `a0ac3ba0`:66/66 focused
checks at its source-equivalent parent,4/4 CSS-sensitive checks on the successor,
desktop/mobile types and desktop production build. Counts overlap.

Read-only Reviewer found one P2, also identified in Builder's source audit:
replacing every rendered text block with its field would unmount canonical
LaTeX PDF/code renderers during inline editing. The initial browser observations
passed ordinary writing, keyboard activation, Add text and source toggles, but
did not exercise that canonical inline edit; no browser reproduction of the
reset is claimed. Visual Check paused and returned the fixture before correction.

Both writing wrappers now keep code renderers mounted, hidden and noninteractive
while the inline field is visible. Ordinary prose still has a single visible
representation. Mounted web and mobile-wrapper regressions exercise editing,
actual input, Done and identical iframe identity/mount count; hidden web content
is inert and hidden mobile content excludes pointer/accessibility interaction.
The parent bindings explicitly opt code blocks into retention. Development4/4
and desktop/mobile types pass. This wrapper fixture is not the PDF engine or
actual mobile parent; the affected real viewer page/zoom check remains required.
Formal correction qualification, complete bounded visual review and Reviewer
closure remain open in this same1/3 round.

### Correction qualification and source closure — 16 October

Tester `62865551` records51/51 on the exact correction freeze, desktop/mobile
types and desktop production build, all exit0. Read-only Reviewer closed the P2
source finding at `c58c91b8`, with no other actionable correction. The whole
visual review remains pending. The final batch resumed after all host build
writes ended; it includes the previously unperformed actual inline-code edit
and PDF page/zoom check. No new provider/API/native/compiler qualification is
claimed. See [Tester receipt](document-writing-tester.md) and
[Visual report](document-writing-visual.md).

## Visual correction batch — round 1 continued

Visual report `745ab153` found four actionable issues after the functional flows
passed: Expo clipped the long structured title, Finish editing lost keyboard
focus, legacy Page info stayed hidden in Viewing, and narrow web headers used
orphan rows before the writing surface. Actual edit/Add text/save/reopen and
canonical TeX edit→Done retained page2 and exact same-layout PDF dimensions on
both web and Expo. No browser failure is claimed for the earlier source P2.

Correction `d44c4cdf` uses the existing mobile mirrored multiline title pattern,
returns Finish focus to the stable block, allows explicitly requested Page info
while retaining Viewing permissions, and groups narrow page controls. Expo Note
also uses a bounded760 writing column; optional sources still use their available
pane width. Development5/5 passes, including a mounted real Finish button focus
regression (Popover is stubbed, not menu interaction proof). The title and Info
checks assert parent wiring; actual rendered closure remains Visual Check's job.
Tester qualification, targeted visual closure and final Reviewer acceptance are
pending. No other product source/fixture writes will occur during that recheck.

### Correction qualification and source review

Tester `94188184` passed69/69 affected tests, desktop/mobile types and desktop
production build on product freeze `d44c4cdf`. The same-round read-only Reviewer
accepted this correction source with no additional actionable findings: the
mobile title mirror excludes duplicate accessibility content, Finish targets a
stable block, Info retains its reading permissions, and header rules adapt to
container width. No tests/builds/browser actions or writes were performed by
Reviewer. Final acceptance still awaits the actual targeted Visual closures.

### Actual visual closure

Visual report `05590f58` closes DW-V1–V4 on the exact `d44c4cdf` product source:
Expo320 long-title edit saved; Finish focused Block1; Info appeared immediately
while Viewing stayed selected; grouped narrow headers recovered meaningful
writing space. Expo Note measured760px at wide size while optional sources
retained their wider split workspace. Light web and dark Expo represent the
focused correction; prior actual PDF/source/save passes were retained, not
relabelled as new checks. Fixture drafts were cleared and viewports reset.

Builder personally inspected the final wide light Note and corrected320 web
captures returned by Visual. The toolbar is cohesive, the title/prose wrap, and
the optional PDF remains in the same canvas. Final proof paths and remaining
nonblocking comment-panel observation are in the Visual report. That observation
concerns reopening a closed unsent comment after Keep editing; the draft guard
retained its state and the owned synthetic draft was explicitly discarded.
Final read-only acceptance is pending; no production or native result is claimed.

## Final acceptance — 16 October 2026

Read-only Reviewer approved the agreed ADR004 scope in round1/3 on product
`d44c4cdf`, reconciled with Tester `94188184` and Visual `05590f58`. No actionable
source or visual finding remains. No further test run or sweep was required.
The comment-panel observation is a nonblocking follow-up: the draft remains
protected, but Keep editing does not reopen the already closed input. It is not
content loss or a permission bypass. Production deployment, native behavior and
external-provider execution are separate and were not claimed.

No environment/configuration/service/database changes are needed for delivery.
Existing API/5174web/8083Expo services are preserved for owner inspection.
Main integration is the remaining delivery step; preserve unrelated working files.

## Main delivery

Accepted work fast-forward pushed from `b11b1429` to `e575c06e` with
`git push origin HEAD:main`, exit0. `git ls-remote origin refs/heads/main`
confirmed `e575c06ed5c452f3bfe55f71144d90f734986a27`. Subsequent reconciliation
commits change documentation only. This is delivery to main; production is not
deployed by this task. The primary checkout and its unrelated work were not
reset, and the unrelated C6 Visual report edit remains outside this delivery.

## Owner refinement — visible paired editing, round2/3

The owner challenged the blank-looking Note preview and expected a side-by-side
editor. Capture-only Visual diagnosis showed a real rendered two-page synthetic
PDF with a short sentence, source to the right of the Note, and direct code Edit
hiding the PDF. It made no content mutations. The large white page was mostly
empty authored fixture content, not a compilation failure.

Product `09d17c2c` places wide structured source on the left and Note on the
right. Direct web/mobile code editing retains the mounted result visibly beside
the field when width allows, stacking on narrow screens; normal prose remains
single in-place editing. Mobile uses effective pane width including font scale.
No document content, compiler, environment or backend contract changes.
Development6/6 passes, including identical viewer identity through actual input
and Done with visible/non-inert result plus source/Note column binding assertions.
Actual rendered pairing, narrow recovery and page/zoom state remain visual gates.
Tester qualification and Reviewer acceptance are pending; this source is not yet
integrated to main. Earlier accepted delivery receipts remain historical above.
