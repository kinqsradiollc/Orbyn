# D1 Word hyperlink implementation — 6 October 2026

Status: implemented candidate; mounted/full/CI and native Word acceptance remain open.

## Changes

Word export resolves references with the readable document's reference map, groups
one link's styled runs under `w:hyperlink`, and writes destination relationships
for the document and footnote parts. Destinations are deduplicated per export.
Footnote state and relationships are export-local. Tables retain links and styles.
Reference definitions remain canonical Markdown source; they are not printed as
raw metadata paragraphs in the rendered Word document.

The export endpoint retains current target privacy before formatting. It maps
readable Orbyn links to web URLs, resolves root-relative app URLs, and omits hidden
destinations and hints from clickable relationships. Omitted links render as
ordinary text. Only HTTP(S) and mailto can become external Word relationships;
unsafe/unresolved/fragment-only targets do not become filesystem links.

Word import reads only archive metadata, never remote targets. Missing, duplicate,
wrong-type, internal-mode, unsafe and filesystem-like relationship targets are
ignored while their label text is preserved. Valid links preserve authored hints,
formatted labels and hard breaks. Typed Markdown punctuation is escaped before
adding formatting; generated inline OMML math is retained as math. Table imports
preserve formatting and asterisks in link destinations/titles.

Word tooltip strings follow the native260-character boundary; complete authored
titles remain in Markdown source. The documented tooltip/relationship contract is
[Microsoft's WordprocessingML hyperlink specification](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/df06e423-11a6-4a36-bfb3-82139e531781).

## Evidence

- `/tmp/orbyn-doc-word-links-pure-literals.log`:45 parser/archive/import cases
  passed,0 failures/skips in1013ms. Includes real ZIP bytes, relationship metadata,
  nested emphasis, references, table/footnote links, privacy authorizer omission,
  malformed/unsafe relationships, literal punctuation, inline OMML and previous
  paragraph/break/heading behavior.
- Owned packages, backend types/build and full formatting pass:
  `/tmp/orbyn-doc-word-links-current-packages.log`,
  `/tmp/orbyn-doc-word-links-types-final.log`,
  `/tmp/orbyn-doc-word-links-build-final.log`,
  `/tmp/orbyn-doc-word-links-format-final.log`.
- Mounted API privacy/auth/owner/viewer fixtures are implemented but not yet run;
  database suites remain serial behind the reference-title/privacy full suite.
- Earlier unit failures are retained. An invalid1970 ZIP fixture timestamp was
  corrected to2026; escaped bracket runs are checked by combined text/formatting
  rather than an unsupported single-run assumption. No expected visible text or
  target privacy assertion was weakened.

## Remaining scope

Integrate actual main after PR211 qualification, then qualify mounted/full/CI
against the final combined source. Word UI/native appearance, same-document
bookmark round trips, footnote import, complete math/code/image/container matrices
and all D1/U1/agent/provider gates remain open. This is not full Markdown or Word
parity. User deploys manually; preserve character/user files and final cleanup.
