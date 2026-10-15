# Document writing redesign

Decision: [ADR 004](../adr/004-document-writing-experience.md).
Baseline: `b11b1429`. Branch: `codex/docs-writing-redesign`.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Phase: round-1 correction qualification. Review counter: 1/3.

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

Formal qualification, final visual review, acceptance and integration remain open.
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
