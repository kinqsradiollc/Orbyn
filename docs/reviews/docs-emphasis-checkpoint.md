# D1 emphasis and autolinks checkpoint — 6 October 2026

Status: merged in PR208 as `49a5d844`, exact candidate `4c9edf00`.
All four CI37346372738 jobs passed and fresh local full suite3383/0/1 passed.
The merge and candidate have identical tree `b7e56186bf9d5e478800def4b143b808f3da7ccb`.

## Implementation

The shared parser uses delimiter flanking, underscore intraword restrictions and
the rule of three for emphasis/strong emphasis. Matching uses source coordinates,
excludes masked literal code/escapes and link destinations, and applies styles
around existing inline objects. Interval changes are swept once, avoiding a
repeated scan of every styled range for large repeated input.

HTTP/HTTPS and email autolinks use the existing safe-link policy. Unsupported
schemes stay inert. Raw HTML tags/comments remain literal escaped source;
delimiters inside attributes cannot accidentally format neighboring text.
No HTML executes and no remote dependency is introduced.

The parser feeds both clients and HTML/Word exporters. This checkpoint builds
on the combined-style reader/export correction in PR208; it is not independent
proof of native interaction or the whole Markdown contract.

## Evidence and scope

- `/tmp/orbyn-docs-emphasis-spec-focused.log`:198 pass, zero failures/skips.
- The 132 CommonMark0.31.2 emphasis examples compare visible character styling.
  Three raw-HTML cases instead explicitly verify Orbyn's inert-HTML requirement;
  original examples/HTML and their CC BY-SA4.0 attribution are checked in.
- Fixtures include mixed nested styles, Unicode punctuation, intraword and
  unmatched delimiters, rule-of-three ambiguity, URL/code literal delimiters,
  dangerous schemes, exact source offsets and 10,000 repeated/unmatched groups.
- `/tmp/orbyn-docs-emphasis-focused.log` retains the first implementation failure:
  an opener capable of closing was excluded by an incorrect failed-search floor.
  The floor now stops at the previous opener, allowing the current delimiter to
  become a later opener. `/tmp/orbyn-docs-emphasis-focused-repaired.log` passes.
- The first external audit reported126/132: three HTML policy differences, two
  missing autolinks and one audit treatment of multiple paragraphs. Autolinks
  were implemented, paragraph expectations split independently, and policy
  differences explicitly tested. This is not132/132 complete CommonMark.

Remaining D1 work includes paragraph/break behavior, balanced/title link syntax,
full import/export/source-preview and diagram family acceptance. Whole-app U1,
real provider/tenant acceptance and native/browser visuals remain open.

References: [CommonMark0.31.2](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis),
[fixture attribution](../../backend/tests/fixtures/commonmark-emphasis-LICENSE.md).

## Editing and export qualification follow-up

Nested toggles and tint changes now use exact delimiter ranges emitted during
parsing. They remove/change only the original markers, preserve inner formatting
and links, and translate selections without rebuilding source from visible runs.
Different text styles can be added inside existing text styling; selections that
cross delimiter gaps and atomic objects remain guarded.

- `/tmp/orbyn-channel-docs-emphasis-editing-cohort.log`:268 pass, zero failures,
  fresh marked database, serial actual editing/richer-page/tag integration plus
  parser, actual web-renderer, Word and the attributed emphasis corpus.
- `/tmp/orbyn-docs-emphasis-editing-current.log`:200 focused pass.
- `/tmp/orbyn-docs-emphasis-diagram-readability.log`:four actual offline Chromium
  Gantt HTML/PDF readability checks pass, with unchanged deadlines/assertions.
- PR208 earlier exact `23c9cd30` local full passed3220/0/1; CI37343955791 failed
  one Gantt rendering timeout while the three other jobs passed. Failure log:
  `/tmp/orbyn-docs-nested-23c9cd30-ci-failed.log`. This is retained and no CI pass
  is claimed. The print pipe now reports only the timed-out protocol method,
  never source/parameters/session, to identify recurrence; deadlines stay fixed.

Current-source full/CI qualification remains necessary before merging.
