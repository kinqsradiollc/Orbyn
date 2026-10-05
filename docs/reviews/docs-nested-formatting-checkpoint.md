# D1 nested inline formatting checkpoint — 6 October 2026

Status: implementation candidate; not yet merged or visually accepted.

| Surface       | Change / evidence                                                                                                                                                                                                                                 | Remaining acceptance                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Shared parser | Bounded recursion inside existing supported formatting and safe link labels; bold+italic triple asterisks; source coordinates and literal code masks preserved.                                                                                   | Complete CommonMark delimiter handling, underscore emphasis and the governing D1 matrix remain open. |
| Web / desktop | Compose formatting around the existing text, source/comment spans, code and link components instead of returning at the first style. Actual extracted component rendering fixture verifies styles, source coordinates and external-link behavior. | Browser screenshots, editing/selection interactions and full layout matrix.                          |
| Mobile        | Shared parser plus combined text styles; apply those styles to footnote/source labels and object-link labels too.                                                                                                                                 | Native visual/interaction acceptance; typeset mathematical glyph styling remains separate.           |
| HTML          | Compose semantic wrappers around escaped text, safe links and literal code.                                                                                                                                                                       | Full published/export/render acceptance matrix.                                                      |
| Word          | Existing exporter already composes run properties. Real archive fixture verifies combined properties and bold+italic import readability.                                                                                                          | Highlight/strike import and complete import/export round trips remain open.                          |

## Evidence

- `/tmp/orbyn-docs-nested-cohort.log`: 56 pure fixtures, 56 pass, zero failures; Markdown dialect, nested parser, actual web component, Word archive, headings and diagram-export checks.
- `/tmp/orbyn-docs-nested-build-current.log`: owned shared-package build.
- `/tmp/orbyn-docs-nested-backend-types-current.log`, `/tmp/orbyn-docs-nested-web-build.log`: backend typecheck and web production build.
- `/tmp/orbyn-docs-nested-web-types.log`, `/tmp/orbyn-docs-nested-mobile-types.log`: desktop/mobile typechecks.
- `/tmp/orbyn-docs-nested-render-initial.log`: retained initial fixture failure due to incorrect expected offsets and omission of the existing URL normalization trailing slash. Fixed expectations preserve exact source offsets and normalized destination checks.

This is one D1 correction. It does not establish complete Markdown compatibility,
whole-app U1 acceptance, native interaction, or production publication.
