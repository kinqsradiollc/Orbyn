# D1 balanced links checkpoint — 6 October 2026

Status: merged as PR209, main `14415dcb`; exact candidate `4c3dffb4`.
All four CI37348529721 jobs passed; fresh local full suite3403 passes, zero
failures and one existing skip, terminal exit0 in 718822ms. Main application
source matches the tested candidate; the intervening change is documentation.
Logs: `/tmp/orbyn-channel-docs-links-4c3dffb4-full.log` and
`/tmp/orbyn-docs-links-4c3dffb4-ci.log`.

## Behavior

Inline link parsing matches balanced destination parentheses, escaped punctuation,
angle-bracket destinations and quoted/parenthesized titles. Nested bracket labels
preserve their source coordinates and supported inline formatting. Both clients
continue to use the shared protocol validation and navigation paths. Web exposes
titles as escaped attributes; mobile exposes titles as accessibility hints; HTML
exports escape titles and destinations.

Malformed syntax cannot authorize a truncated destination. Unsafe protocols,
unsupported inline images retain exact inert source. Nested links keep the outer
syntax as text and preserve only the validated inner action, with no nested anchor.
No remote image is fetched. Inline image presentation remains explicit work,
not claimed full CommonMark link/image parity.

Parsing uses a bracket map, bounded destination nesting and a scanning budget.
Opaque source is masked with one character sweep; literal code/escapes inside
rejected links are preserved instead of being normalized into misleading source.
Code-format callbacks inside those opaque ranges are not emitted.

## Qualification

- `/tmp/orbyn-channel-docs-links-focused-integrated.log`:288 focused cases
  passed, zero failures/skips; fresh marked database, serial actual editing,
  richer-page and tag integration plus parser/emphasis/actual web-renderer/Word
  and Markdown cases.
- `/tmp/orbyn-docs-links-nested-focused.log`:220 pure cases pass before the
  final parent opaque-range forwarding correction; the288-case integrated
  run is the current source result.
- `/tmp/orbyn-docs-links-current-{backend,desktop,mobile}-types.log`:all three
  typechecks pass. Owned shared-package and web production builds also pass.
- Tests cover balanced and escaped destinations; all three title delimiters;
  whitespace; nested label brackets, formatting and exact source offsets;
  malformed syntax; malicious protocols; safe literal fallbacks; export escaping;
  10,000 malformed openers, 5,000 rejected links and 30,000 nested brackets.
- Existing emphasis corpus and nested editing tests remain unchanged and passing.

Full source qualification passed. Browser/native interaction acceptance remains open.
Remaining link/image work includes reference-definition titles, supported inline
image presentation and the full original D1 import/export matrix. Paragraph/break
behavior and whole-app U1 are separate outstanding requirements.

Specification reference: [CommonMark links](https://spec.commonmark.org/0.31.2/#links).
