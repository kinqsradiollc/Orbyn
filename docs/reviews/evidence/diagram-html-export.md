# Whole-page HTML diagram export evidence

3 October 2026. Candidate checkpoint, not full D1 acceptance.

## Checked-in automated checks

- Diagram export, hook lifecycle, engine and Mermaid bounds cohort: **37/37**, no skips or cancellations.
- Export API cohort: **17/17**, including authentication, bad formats, authorization, rate-limit handling, escaped sources and cross-user denial.
- Actual strict Mermaid syntax parser: all ten named families.
- All workspace typechecks and desktop production build/prerender pass.
- Both clients embed the same first-party isolated engine. Desktop loads it lazily. Renderer policy denies network access; DOM engine test records zero resource requests.
- Hook tests cover scope-change/unmount cancellation, queued work, stale replies, opaque-frame source checks and keeping the engine mounted within a batch.

The DOM engine test uses fixed geometry and Canvas stand-ins. It validates the real bundled engine and sanitized export pipeline, **not visual layout or native behavior**. Initial mindmap harness failures came from missing zero-valued padding/border geometry in the DOM emulator; corrected the harness without changing Mermaid behavior.

## Offline actual Chrome engine fixture

Ran the trusted bundled renderer against synthetic fixtures in a separate temporary headless Chrome profile using a local file. The runtime CSP remained intact. This did not access the denied local app preview or authenticated data, and is not app screenshot evidence.

| Family    | Serialized SVG bytes | Result                          |
| --------- | -------------------: | ------------------------------- |
| flowchart |                11452 | Rendered; inert SVG checks pass |
| sequence  |                23178 | Rendered; inert SVG checks pass |
| state     |                27542 | Rendered; inert SVG checks pass |
| class     |                18257 | Rendered; inert SVG checks pass |
| er        |                14536 | Rendered; inert SVG checks pass |
| gantt     |                10425 | Rendered; inert SVG checks pass |
| pie       |                 4095 | Rendered; inert SVG checks pass |
| journey   |                 7516 | Rendered; inert SVG checks pass |
| mindmap   |                26349 | Rendered; inert SVG checks pass |
| timeline  |                15788 | Rendered; inert SVG checks pass |

Every resulting SVG was parsed and checked for executable elements, embedded/external images, event attributes and non-fragment links. HTML embeds SVGs as inert image data URIs and retains escaped source in details. Engine errors preserve source with a generic failure caption. Closing/changing the editor aborts the file rather than downloading partial cancelled output.

Asset SHA-256: `432e5586898a0b50f000b610517cb2d4cc6d57616bbc35351b5f3eb3ee410fcf`.

## Remaining acceptance

- Native share/download interaction and screenshots; web visual validation belongs to the user's test-server review for this increment.
- PDF and server-direct/publication rendered diagram parity.
- Export of the latest unsaved editor revision and concurrent-save failure handling.
- Full D1 and U1 matrices. No full-goal completion is claimed.
