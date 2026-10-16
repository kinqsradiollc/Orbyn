# ADR 005 — Document workspace and direct LaTeX preview

Status: implementation in progress. Owner direction: 16 October 2026.
Supersedes ADR 004's document presentation and automatic PDF preview.

## Why this is a separate delivery unit

ADR 004's two review rounds qualified block editing and source/PDF state, but
its accepted layout was rejected by the owner. Those receipts remain historical;
they do not establish the quality of this workspace. This decision changes the
rendering architecture and the whole document workspace, rather than extending
the block-level split. Its new qualification counter starts at 0/3 for that changed
unit; ADR 004's 2/3 history is preserved and must not be reset or relabelled.

## Decision

- A persistent document toolbar owns format, save state and page actions.
- Note is a clean writing canvas; no automatic PDF pages in its body.
- Markdown and LaTeX use a dedicated source/preview workspace with independent
  scrolling and a resizable divider. One source editor owns the draft.
- Library navigation is compact and collapsible. The document uses the remaining
  viewport instead of a narrow column inside a second card.
- Phones switch Source/Preview in the same document mode. Avoid nested tiny splits.
- LaTeX previews directly to HTML using bundled LaTeX.js and local math fonts.
  It is a readable web preview, not TeX pagination or arbitrary package execution.
  Unsupported/incomplete source keeps the last successful render and exact draft.
- PDF is an explicit export through the existing authorized compiler. Export
  progress/errors must not clear, replace or reload the working HTML preview.
- Preserve structured containers, canonical/secondary source ownership, comments,
  assistant approvals, version/save/conflict/departure/account guards and source.

Official renderer references: [usage](https://latex.js.org/usage.html),
[limitations](https://latex.js.org/limitations.html). Source is never sent to a CDN.
Generated markup runs in a fixed isolated host with no network/resource authority.

## Acceptance

After complete code: formal affected tests, types/builds and read-only review,
then Visual Check evaluates the actual design on web5174 and Expo web8083.
Assess real writing, library width, pane resizing, persistent controls, long source,
continuous edits, readable math/prose, invalid/unsupported input recovery, export,
format changes, themes, narrow widths and document ownership. Screenshot dimensions
and happy-path buttons alone are insufficient. Native builds, external-provider
execution and production deployment are separate from browser acceptance.

Current scope, exact commits, failures and delivery:
[workspace delivery record](../reviews/document-workspace-redesign.md).
