# D1 quote, list and image audit — 6 October 2026

Source baseline: main cc77be51; executable parse/serialize probes used the actual
shared core source. The [saved probe output](evidence/docs-container-audit.json)
contains the exact inputs, blocks and serialized result. These results describe
parser behavior, not browser acceptance.

| Input                  | Confirmed behavior on main                                        | Required implementation                                                     |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Adjacent quote lines   | Separate quote blocks; export inserts blank lines between them    | Preserve one multiline quote paragraph, breaks, anchors and source ranges   |
| Nested quote           | Inner marker retained as text; no nested quote rendering          | Bounded container structure shared by source/editor/renderers/exporters     |
| Quote with fenced code | Three quote text blocks; fence not a code block                   | Parse/render child blocks inside quotes; keep source literal and safe       |
| List continuation      | Continuation becomes a page paragraph; indentation lost on export | Preserve item-owned paragraphs and explicit continuation indentation        |
| List with fenced code  | Code becomes a top-level block; export loses list ownership       | Preserve child code/container association across both clients and exports   |
| External inline image  | Original Markdown remains a paragraph                             | Decide/render safe authorized media without implicit remote fetch or upload |
| Reference image        | Definition/source retained; image is unresolved text              | Shared reference-image resolution and authorized file/media rendering       |

## Current quote continuation candidate

The next candidate preserves consecutive ordinary quote lines in one block, carries
hard/soft breaks through the shared inline contract, prefixes every serialized quote
line, and uses a standalone anchor for multiline quotes. Existing inline anchors
remain separate; literal callout markers are escaped on every line. Source range
mapping follows the complete merged paragraph. It does not claim nested container,
list continuation, code-in-quote or remote image rendering completion.

## Remaining implementation order

1. Qualify/promote Word/reference-preview privacy and available-width rails.
2. Qualify quote continuation across parser, source mapping, anchored round trips,
   both client Inline functions and HTML/Word output.
3. Extend the shared structured container contract for quote/list child blocks.
   Define bounded depth, compatible stored pages, CRDT/edit/selection behavior,
   source anchors and privacy projections before changing renderers.
4. Add all container import/edit/render/export fixtures, including nested tasks,
   explicit numbering, blank paragraphs, fences/tables/math and source restoration.
5. Finish authorized media/reference images, bookmarks/footnote import, math/code
   and remaining Mermaid family/native interaction matrices.

Keep all C1-C6/M1/D1/U1 requirements and whole-app layout review in scope. Real
account/tenant/host, native/browser, production deployment and cleanup remain open.

## Quote candidate verification

Current parser/source/HTML/Word cohort:87 passed,0 failed/skipped, terminal0
(`/tmp/orbyn-doc-quote-source-focused-final.log`). Packages build and all three
workspace typechecks pass; full formatting passes. Full integration/CI and visual
acceptance remain pending. Earlier failures are retained: hard-break grouping
initially doubled spaces, the boundary fixture exposed the existing4,000-character
quote limit, and the Word fixture initially assumed contiguous XML text. The source
now respects the unchanged quote limit and Word output is checked by its actual
text runs/breaks. Assertions for source, visible text and formatting remain exact.

Word quote import also used a single leading marker for a multiline paragraph, so
hard-broken continuation text escaped the quote on import. It now delegates to the
shared quote serializer, which prefixes every line and escapes literal callout
markers. The current expanded source/export/import cohort passes88/88 in1516ms,
zero failures/skips (`/tmp/orbyn-doc-quote-word-focused.log`). This repairs Word
quote ownership; nested container and complete Word import parity remain open.

## Literal quote anchors — 6 October continuation

Multiline quotes now escape literal caret words on every serialized line when
source anchors are requested. The original block IDs and single-line legacy
anchors are preserved. Word import prefixes each hard-broken quote line and
keeps literal callout markers as quote text.

The current pure parser/source/HTML/Word continuation cohort passes58/58, zero
failures/skips (`/tmp/orbyn-doc-quote-anchor-focused.log`). All workspace types
and formatting pass (`/tmp/orbyn-doc-quote-anchor-*-types.log`,
`/tmp/orbyn-doc-quote-anchor-format.log`). Previous Word-import cohort88/88 is
retained. Actual Word/privacy checkpoint integration, full combined qualification
and visual/native acceptance remain required before promotion. This does not
complete nested quote/list containers, media or the full D1 goal.
