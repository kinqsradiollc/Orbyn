# D1 paragraph and break checkpoint — 6 October 2026

Status: local implementation; source qualification and native/browser acceptance
remain open. This continues the ADR-linked paragraph audit without claiming D1
or whole-app U1 complete.

## Implemented

- Consecutive ordinary Markdown lines form one paragraph. Blank lines,
  structural blocks, separately anchored blocks, reference definitions and
  Orbyn study-card lines remain boundaries. Source-range callbacks use the
  merged paragraph's original line range.
- Multiline paragraph anchors occupy their own line. Serialization escapes
  literal block syntax and anchor-like text on each continuation line, preserving
  the paragraph's identity and contents through source editing.
- Shared inline runs distinguish soft breaks from two-space/backslash hard
  breaks and retain the complete marker range for source offsets. Escaped
  backslashes, code and inert rejected link/image source keep their contracts.
- Real web/mobile Inline components consume the shared representation. HTML/PDF
  renders hard breaks with `br`; soft breaks are spaces. Plain-text previews and
  search match those semantics.
- HTML paste preserves `br` inside ordinary paragraphs. Word exports actual
  `w:br` and imports it as a Markdown hard break; tabs remain spaces.
- Continuation grouping keeps the existing 10,000-character stored paragraph
  limit. Long imported groups split at line boundaries rather than producing
  newly unsavable blocks. The validation limit is unchanged.

## Evidence so far

- Actual TypeScript reproductions are recorded in `docs-paragraph-break-audit.md`.
- Initial 360-case cohort caught definition grouping and the old HTML `br`
  expectation. Definition behavior was repaired with assertions unchanged; the
  paste expectation now asserts one paragraph with an explicit hard break.
  Retained log: `/tmp/orbyn-channel-docs-breaks-integrated.log`.
- Corrected 361-case cohort passed; expanded editing/source/reference/Study
  cohort passed378/378, zero failures/skips in21592ms, before the final whitespace
  scan and paragraph-limit guard.
  `/tmp/orbyn-channel-docs-breaks-expanded.log`.
- Actual web rendering and the actual mobile Inline function with mocked Text
  primitives are exercised, as are real Word archive/export/import paths.
  The mobile component test does not establish native interaction or appearance.
- Final source:379/379 editing/source/reference/Study/component/export cases
  pass, zero failures/skips in24920ms. Log:
  `/tmp/orbyn-channel-docs-breaks-final.log`.
- All three workspace typechecks, shared packages, backend/web production builds
  and full formatting pass. Logs:
  `/tmp/orbyn-docs-breaks-{backend,desktop,mobile}-types-qualified.log`,
  `/tmp/orbyn-docs-breaks-{backend,desktop}-build.log`,
  `/tmp/orbyn-docs-breaks-packages-qualified.log`,
  `/tmp/orbyn-docs-breaks-format.log`.
- Frozen-head full local suite and CI remain required before main integration.

## Remaining D1 work

Nested list/quote/heading continuation syntax and multiline Setext headings need
their own import/edit/export matrix. Non-paragraph HTML paste containers retain
their previous splitting behavior until that round trip is supported. This is
not full CommonMark/GFM acceptance. Reference-definition titles, authorized
inline images, all diagram families and the rest of the import/editor/export
matrix remain open. Browser5174 and Simulator inspection limitations remain
recorded; no visual/native acceptance or production deployment is claimed.
