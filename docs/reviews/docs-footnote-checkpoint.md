# Footnote continuation and Word import — 6 October 2026

Status: implementation candidate; not merged or visually accepted.
Based on Word/privacy integration500ace6c. The repaired export-route test fixture
ad83a3d8 must be integrated before combined qualification.

## Changes

Shared Markdown parsing and serialization preserve multiline footnotes, explicit
hard breaks, source ranges and stored block IDs. The existing4000-character stored
limit is shared with validation; continuation grouping cannot create an oversized
stored block. Both clients consume the shared contract.

Word imports retain reference markers and normal footnotes, including empty notes,
formatted text, hyperlinks, titles and explicit hard breaks. IDs use signed32-bit
integer semantics and match normalized references; separators are identified by
type. Normal ID0 is valid. See Microsoft's [footnote ID contract](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.footnoteendnoteseparatorreferencetype.id?view=openxml-3.0.1)
and [separator contract](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.separatormark?view=openxml-3.0.1).

Only the uploaded document's explicit archive-local footnote part is read. Its
links use that part's own relationships and the existing safe-protocol policy.
Remote parts, traversal out of word/, ambiguous parts, invalid/duplicate IDs,
invalid reference IDs and oversized notes fail explicitly. Count is bounded2000.
No network or filesystem target is fetched from a Word relationship.

## Evidence and limits

Parser/source/HTML/Word cohort88/88 passes, zero failures/skips:
`/tmp/orbyn-doc-footnote-source-final-repaired.log`. Earlier failures remain in
`/tmp/orbyn-doc-footnote-focused.log`,
`/tmp/orbyn-doc-footnote-source-focused-current.log`, and
`/tmp/orbyn-doc-footnote-source-final.log`. Repairs address trailing hard-break
spaces, remote relationship origins, self-closing empty notes and a mistaken
decoder name; original assertions remain.

Final workspace types, backend/web builds and full formatting pass; evidence is
in `/tmp/orbyn-doc-footnote-*-final-repaired.log`. Mounted import regression backend
types pass (`/tmp/orbyn-doc-footnote-mounted-types.log`); its database execution
awaits the ongoing immutable PR213 full run. The test exercises upload, conversion,
stored markers/notes, source export, cross-owner refusal and file cleanup.
Full combined database qualification, mounted import acceptance, main integration
and browser/native interaction remain required. Complex nested block content in
footnotes, endnotes, bookmarks and arbitrary Word media are not completed here.
The full C1-C6/M1/D1/U1 ADR goal remains open. No deployment or cleanup occurred.
