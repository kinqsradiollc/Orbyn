# D1 reference titles checkpoint — 6 October 2026

Status: local implementation; full immutable-head qualification and main
integration remain open. Original D1/U1 and agent/provider scope is retained.

## Implementation

Reference definitions use the balanced inline destination/title scanner. Escaped
punctuation and escaped title delimiters are decoded consistently; malformed
destinations cannot authorize a truncated link. Empty titles remain distinguishable
from missing titles. Definitions remain editable source, and the first definition
keeps precedence, including an unsafe first definition.

The reference map carries an optional non-enumerable title lookup tied to the
original destination. Ordinary caller maps remain supported. Changing a map's
destination cannot reuse its old title. A portable entry is `[label, href, title?]`;
both old two-field entries and titled entries reconstruct through the shared helper.

The section API sends titles only after projecting readable source content and
filtering destinations through current link privacy. Both clients reconstruct
the complete context, including authorized definitions outside the embedded
section. Web tooltips and HTML export escape titles; mobile exposes accessibility
hints. HTML export omits the link title when its authorizer omits the destination.
Object-link pills show authored hints only after their target resolves in the
current accessible state; missing and unresolved targets suppress them.

## Evidence

- `/tmp/orbyn-doc-reference-titles-render-final.log`:206 pure parser, emphasis,
  definition, actual web/mobile Inline and object-pill function cases passed,
  zero failures/skips. Mobile primitives are mocked; this is not native UI evidence.
- `/tmp/orbyn-channel-docs-reference-titles-integrated.log`:308 serial API,
  editing, page/tag, privacy and component cases passed, zero failures/skips
  in24784ms in fresh marked DB23. Existing auth, authority, invalid-section and
  private-source assertions remain in place.
- All three workspace types, owned shared packages and backend/web builds,
  and full formatting passed. Logs:
  `/tmp/orbyn-doc-reference-titles-{backend,desktop,mobile}-types-final.log`,
  `/tmp/orbyn-doc-reference-titles-{backend,desktop}-build.log`,
  `/tmp/orbyn-doc-reference-titles-packages-current.log`,
  `/tmp/orbyn-doc-reference-titles-format.log`.
- The escaped-title case caught raw scanner handling after correcting an
  overescaped fixture. Scanner handling was repaired; the decoded-title assertion
  remains. Earlier failure logs are retained.

## Remaining acceptance

Full local/CI qualification, browser/native interaction and appearance remain
open. Multiline reference definitions, further container syntax, authorized inline
images, the complete diagram-family/import/export matrix and whole-app layouts
remain required. Word's full interactive reference-link/tooltip contract also
needs its export matrix; this checkpoint does not claim it. MCP, private ChatGPT
and the separate plugin backend remain distinct. Deployment remains user-run.

Specification: [CommonMark reference definitions](https://spec.commonmark.org/0.31.2/#link-reference-definitions).
