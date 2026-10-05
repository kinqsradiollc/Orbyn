# D1 paragraph and line-break audit — 6 October 2026

Status: reproduced behavior gaps; implementation and acceptance remain open.
This document supplements ADR001 without narrowing D1 or U1.

## Observed behavior

Read and exercised the actual TypeScript source on main `49a5d844`, using
`node --import tsx` in the independent `codex/docs-break-completion` checkout.
No database, external provider or browser was involved.

| Path                          | Current behavior                                                                                                                        | Required implementation                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Markdown paragraph            | `First line  \nSecond line` becomes two paragraph blocks. The trailing spaces disappear.                                                | Keep ordinary paragraph continuation lines in one block; distinguish soft breaks from two-space/backslash hard breaks. |
| Multiline anchored round trip | A paragraph with `text: "First\nSecond", id: "p1"` serializes with an escape, then reparses as two blocks. Only the second gets the ID. | Preserve one paragraph and its ID, without merging separately anchored blocks.                                         |
| HTML paste                    | `<p>First<br>Second</p>` becomes two blocks.                                                                                            | Preserve the paragraph boundary and represent its hard break in Markdown.                                              |
| Shared inline reader          | `First  \nSecond` remains one untyped text run.                                                                                         | Produce source-aware break runs without interpreting breaks inside literal code or math.                               |
| Web and HTML export           | Plain inline text has no explicit hard-break rendering. Browser whitespace does not preserve a Markdown hard break.                     | Render hard breaks as `<br>` and soft breaks consistently; preserve selection/comment coordinates.                     |
| Mobile                        | Native text preserves raw newlines, giving different behavior from HTML.                                                                | Consume the shared break representation and match web semantics.                                                       |
| Word export/import            | Export writes inline newlines as text; import maps `w:br` and `w:cr` to spaces and then collapses whitespace.                           | Export actual Word breaks and preserve them on import, while keeping tabs and ordinary spaces separate.                |

Relevant source: `packages/core/src/docs.ts` (`parseDoc`, `DocInline`,
`paragraphNeedsEscape`, `docLines`), `packages/core/src/paste.ts`
(`htmlToBlocks`), `packages/core/src/export.ts` (`inlineHtml`),
`desktop/src/features/docs/DocBlocks.tsx`,
`mobile/src/screens/docs/Inline.tsx`, and
`backend/src/modules/{docs,imports}/docx.ts`.

`serializeDoc` already separates blocks with blank lines. That supports genuine
paragraph boundaries, but does not itself preserve a multiline paragraph.

## Implementation sequence and acceptance

1. Define the shared paragraph/break representation. Keep source positions into
   the stored Markdown, including two-space and backslash markers. Code/math,
   unsupported inert syntax and escaped punctuation must retain their contracts.
2. Group continuation lines while respecting headings, fences, lists, quotes,
   tables, references, Orbyn extensions and explicit anchors. Preserve source
   ranges and empty anchored paragraphs. Do not silently merge separately
   identified blocks or invalidate comments.
3. Wire web/mobile rendering, HTML paste, HTML/PDF export and Word import/export.
   A parser-only or unused optional setting is not completion.
4. Add focused cases for soft/hard breaks, CRLF, escaped backslashes, styled/link
   labels, literal code/math, consecutive paragraphs, structural interruption,
   IDs, source maps and comments. Exercise real web rendering and Word archives.
5. Qualify immutable source with the serial database regression cohort and full
   local/CI checks. Preserve existing renderer deadlines and assertions.
6. Verify typing, source editing, paste, save/reopen and selections on web/desktop
   and native mobile. Browser5174 permission and Simulator timeout limitations
   currently prevent claiming this visual/native acceptance.

No fix or whole-CommonMark claim follows from this audit. Reference titles,
authorized inline images, container edge cases, diagram families and the rest
of the import/editor/export matrix remain part of D1.
