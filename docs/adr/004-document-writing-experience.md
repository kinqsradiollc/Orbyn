# ADR 004 — Document writing experience

Status: accepted, agreed web and Expo web scope. Accepted 16 October 2026.
Owner direction: 15 October 2026.

## Context

After ADR 003 delivery, the owner rejected the document editing experience.
The structured editor displayed repeated Edit/Comment rows, a form-like title,
competing toolbars and a bounded preview even when simply writing a note.
Passing control-size checks did not establish an acceptable writing experience.
This decision supersedes that document presentation, preserving ADR 003's other
accepted work and its historical evidence.

## Decision

- Default to Note: one readable writing column, an unboxed title and natural page
  scrolling on web. The document is the main surface.
- Edit rendered text in place. An active text field replaces its rendered block;
  do not display the source underneath a duplicate of that paragraph.
- Keep block actions contextual. Web uses a margin control revealed by pointer
  or keyboard focus; touch keeps the control reachable. Mobile uses its existing
  action sheet. Preserve comments and assistant approval flows.
- Keep Note, Markdown and LaTeX discoverable in one quiet format selector.
  Source remains optional beside the same live Note/PDF. A phone shows one pane;
  hiding source returns to the writing surface without losing its draft.
- Show one save state. Show an explicit save action only for a dirty draft or
  recovery; preserve invalid-source, conflict and departure fences.
- Put history, page details and link-copy actions in the page menu. Preserve
  viewing/suggesting modes in a compact, named control.
- New text must be possible directly from Note without opening Markdown.

No storage migration, renderer replacement, provider call, environment variable
or new service is needed. Keep structured containers, block IDs, permissions,
optimistic concurrency, offline behavior, proposals and PDF ownership unchanged.

## Delivery and acceptance

Implement the complete document batch before formal qualification. Apply the
existing Builder → Tester → Reviewer workflow; this follow-up has its own
bounded review counter, completed at 1/3. Retain prior failures and distinguish
new evidence from reused unchanged contracts.

The final bounded visual check covers legacy and structured Note on web and
Expo web, wide and 320px layouts, both themes, title wrapping, text editing,
context actions, comments and optional source/Note/PDF transitions. Exercise save
recovery and permission state through affected tests; no unrelated screen sweep,
native build or external provider calls. Review the writing experience itself,
not only box dimensions. Delivery state belongs in the
[document redesign record](../reviews/document-writing-redesign.md).

## Acceptance

Accepted product: `d44c4cdf`. Tester `94188184` passed69/69 affected checks,
desktop/mobile types and desktop production build. Visual `05590f58` closes
all four writing findings with actual interactions, retaining the earlier
actual source/PDF/save results. Read-only Reviewer accepted the combined source,
qualification and writing experience in round1/3. Native builds, external
provider execution and production deployment remain outside this scoped receipt.
A nonblocking closed-comment-panel Keep editing observation remains documented
in the Visual report; the draft guard retains content. Integration status is
recorded in the delivery ledger.
