# D1 Word hyperlink audit — 6 October 2026

Status: source and archive probe confirm a remaining implementation gap.
Reference-title PR211 does not close Word hyperlink parity.

| Surface                | Current evidence                                                                                                                             | Required implementation                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export inline links    | `docx.ts` writes link-colored runs, without `w:hyperlink`. Static document relationships contain styles/numbering/footnotes only.            | Emit validated hyperlink relationships, group consecutive runs with matching destination/title, and retain nested emphasis and breaks.                              |
| Export reference links | `runsFor` calls `parseDocInline` without the document reference map. Archive retains unresolved `[Guide][guide]`.                            | Resolve definitions after permission projection, with first-definition precedence and titles. Keep source definitions intact.                                       |
| Import Word links      | `runsText` scans runs/equations without interpreting hyperlink relationships or tooltips. Archive round trip loses inline destination/title. | Read local archive relationship metadata, validate external destination/protocol, preserve titles and styles as canonical Markdown. Never fetch targets.            |
| Authority              | Export route applies `readableLinks` and `blocksWithWebLinks` before formatting.                                                             | Preserve that ordering; private targets and title hints must stay absent from exported relationships and output. Add mounted privacy fixtures.                      |
| Acceptance             | Word archive probe and source inspection only.                                                                                               | Export/import round trips, malformed/unsafe relationships, escaped destinations/titles, duplicate references, footnotes/tables and actual Word/rendered acceptance. |

Probe on immutable reference-title candidate `e04f2c57`:
`/tmp/orbyn-doc-word-link-audit.log`. Input contains one inline and one reference
link with titles. Output has no `w:hyperlink`; document relationships exist but
contain no hyperlink entries. Import yields plain `Inline` and unresolved
`[Guide][guide]`, while preserving the reference definition as editable text.
This identifies a real gap without claiming an export security leak or a fix.

Next implementation should carry an export-local context for reference and
relationship metadata, preserve break/formatting behavior already qualified in
PR210, and validate relationships before import serialization. Keep the full D1,
U1, agent/provider and user/character integration scope open.
