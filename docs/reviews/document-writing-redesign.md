# Document writing redesign

Decision: [ADR 004](../adr/004-document-writing-experience.md).
Baseline: `b11b1429`. Branch: `codex/docs-writing-redesign`.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Phase: implementation. Review counter: 0/3.

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
