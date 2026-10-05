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

## Structured container candidate — 6 October 2026

Local branch `codex/docs-structured-containers`, based on tested PR215 source
`5f5a1833`, implements an experimental shared parser, serializer, traversal,
whole-page privacy projection and HTML renderer. This is not connected to stored
pages or either editor and is not a delivered D1 feature.

The candidate preserves quote/list ownership of paragraphs, headings, fenced and
indented code, tables, math, nested quotes/lists, callouts and ordered/unordered
tasks. Marker-relative indentation, explicit start numbers, tight/loose lists,
literal task/callout prefixes, parent/child anchors and physical source ranges
have focused coverage. Page-wide reference and footnote context is retained.
Depth is bounded at12, source at2,000,000 characters and aggregate nodes/items
at2000. Invalid/cyclic input and duplicate IDs fail explicitly. Existing typed
leaf limits are reused. The existing page-library `doc-tree.ts` is unchanged.

Container ownership and marker rules are guided by the primary
[CommonMark container specification](https://spec.commonmark.org/0.31.2/#container-blocks),
[block quote rules](https://spec.commonmark.org/0.31.2/#block-quotes) and
[list item rules](https://spec.commonmark.org/0.31.2/#list-items).
This candidate does not claim complete CommonMark conformance.

Rendering requires both whole-page label/hint projection and the existing
visibility-aware `linkUrl` authorizer. Generic `redactValue` deliberately retains
internal destinations; it cannot authorize links by itself. Tests retain the
private-ID refusal assertion while passing the actual authorizer boundary, and
verify that visible authorized links keep labels and titles.

### Qualification

- Current parser/source/dialect/inline/layout cohort:94/94, zero failures/skips,
  `/tmp/orbyn-container-combined-focused.log`.
- Existing mounted page-library hierarchy:11/11 on fresh marked DB40, terminal0,
  `/tmp/orbyn-channel-container-hierarchy.log`.
- Packages build, all three workspace typechecks and backend/web builds pass,
  `/tmp/orbyn-container-final-*.log`.
- Earlier HTML tests failed on an incorrect footnote class expectation and a
  missing link authorizer; retained `/tmp/orbyn-doc-containers-html-focused.log`.
  Literal-prefix test initially retained an undefined parent ID in expected data;
  the expectation now removes absent IDs without changing text/identity checks.

### Required integration gates

| Order | Implementation                                                         | Acceptance                                                                                    |
| ----- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1     | Define stored/API content version and client capability contract       | Older clients cannot flatten or overwrite unsupported structure; existing pages round-trip    |
| 2     | Extend validation, privacy/search/backlinks, AI/import/export adapters | Whole-page reference visibility and source ownership remain enforced; no child is omitted     |
| 3     | Extend block identity and CRDT operations                              | Stable child selection/comments; concurrent insert/move/delete and undo preserve ownership    |
| 4     | Update web/desktop and native editor/renderers together                | Typing, paste, source switching, nesting, keyboard and accessible interaction on both clients |
| 5     | Integrate HTML/PDF/Word import/export                                  | Nested container matrices preserve content and numbering with private destination checks      |
| 6     | Qualify combined source and merge                                      | Focused/mounted/full suites, types/build/format and honest visual/native acceptance           |

Before integration, define normalization or explicit refusal for constructed
structures that Markdown cannot distinguish, including adjacent compatible lists
and adjacent paragraph children in a tight list. Empty callouts, blank-line and
lazy-continuation edge cases require further fixtures. Source-only parsing is
not proof of storage, editing, CRDT or PDF/Word container delivery. No deployment,
cleanup or full-goal completion is claimed.

## Versioned content and source-switch contract candidate

`codex/docs-container-storage-contract` extends the experimental tree foundation
with explicit content formats. Format1 carries existing typed blocks; format2
carries typed container nodes. This number is distinct from the page's optimistic
revision. Decoding validates bounded/cyclic traversal, global identity and typed
leaf limits; unknown envelope/node/item/callout/leaf fields fail instead of being
stripped. Returned objects are detached from caller-owned state.

Existing leaves upgrade without reparsing text or inventing ownership/IDs. A
format2 page downgrades only when it actually contains root leaves exclusively;
even an empty quote refuses conversion. An explicit capability check rejects a
client without the required supported format. These helpers are not yet mounted
in the Docs API or editors: they do not prove that older deployed clients are
currently protected against future format2 pages. No format2 page is created by
this checkpoint's runtime.

Source switching parses in the declared format with anchors and compares the
complete reconstructed typed content before exposing a writable source view.
Adjacent compatible lists and tight adjacent paragraphs cannot silently merge.
Metadata with no exact source representation refuses switching. Existing positive
math check flags do round-trip through anchored `% check` syntax. The first test
incorrectly expected that flag to disappear; the repaired fixture checks positive
preservation and explicit-false refusal separately. Original failure is retained
at `/tmp/orbyn-container-storage-source-focused.log`.

Current shared format/source/dialect/inline/layout cohort passes108/108, no
failures/skips: `/tmp/orbyn-container-storage-qualified-focused.log`.
This is contract-level evidence. Required next implementation remains migration,
read/write capability fences, document revisions and history, privacy/search/task
adapters, CRDT identity/selection, both editors and all exports. Source equality
refusal needs clear client feedback and normalization rules before UI adoption.
Full combined qualification and actual client acceptance remain open.

The storage/source contract's packages build, backend/desktop/mobile typechecks,
backend/web builds and whole formatting pass, recorded under
`/tmp/orbyn-container-storage-*.log`. No database suite was run concurrently with
foundation20752130's immutable full DB41. A fresh Simulator selection again
returned Computer Use timeout -10005; no native screenshot or interaction proof
is available. The contract is not yet a runtime storage migration or editor feature.

## Backend storage adoption candidate

The follow-up now includes migration252 and an internal transaction adapter.
`docs` and `doc_versions` keep `content_format` and `content_nodes`; existing
flat `content` remains the exact leaf projection used by search, file ACL/link
triggers and Study. Default format1 leaves all existing pages unchanged. The
shared decoder validates typed leaves, fields, budgets and format2 identities.
Legacy format1 preserves IDs permitted by the existing API, including empty or
duplicate IDs, without silent repair; upgrading such content requires explicit
identity repair before it can satisfy format2. The earlier contract rejected
those valid legacy arrays and has been corrected with preservation/refusal tests.

The SQL guard refuses changes to structured content from legacy writers and
rejects a projection that disagrees with its tree. Structured writes require a
transaction-local writer capability. The bounded SQL projection matches shared
leaf traversal in tests. Snapshot history carries both formats and nodes.
Ordinary REST content saves and legacy collaboration updates return409 for a
format2 page. This protects data; it does not complete a nested CRDT editor.

The internal structured writer locks current ownership/permissions and revision,
checks both current and submitted client capabilities, refuses nested downgrade,
restores private labels from existing content, applies existing linked-task/file
ACL checks, follows comments/suggestions, snapshots and saves atomically.
Reads apply current page visibility, task state and whole-page link privacy before
redistributing leaves. An unreadable copied file ID remains unlinked under the
existing contract; saving it cannot grant file access. The file still returns404.

Document relations are prelocked in fixed docs/history order before a migration
batch can hold weaker locks and upgrade them during DDL. The real concurrent-save
regression verifies that an existing save completes, then migration holds both
AccessExclusiveLock relations. Existing worker/deadlock rollback tests pass.

Current pure core/format/migration cohort:54/54.
Current mounted storage, Docs/editing and real deadlock cohort:86/86, zero
failures/skips, fresh marked DB48, terminal0:
`/tmp/orbyn-channel-structured-storage-current.log`.
Packages, backend/desktop/mobile types and backend/web builds pass. No source
module is mounted as a public structured editing API yet; normal runtimes do not
create format2 pages. UI, capability headers, task-item mapping, CRDT, import/export
and full combined qualification remain required before feature enablement.

Earlier logs are retained: DB42 exposed a fixture importing app configuration
before async test setup; DB43 expected200 instead of the signup contract201
(disposable token values were redacted from the failed log). DB45 expected400 for
schema validation, which correctly returns422; malformed JSON independently
returns400. DB46 expected an unreadable copied file ID to refuse saving, although
the existing ACL contract accepts it without granting access. Current tests assert
no grant, unchanged original ownership and404 download, rather than claiming a
refusal the API never promised. These repairs preserve the intended security
boundaries and record their actual behavior.
