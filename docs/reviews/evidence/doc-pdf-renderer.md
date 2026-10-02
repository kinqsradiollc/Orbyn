# Offline PDF renderer qualification — 3 October 2026

## Candidate behavior

A bounded printing helper renders an authorized HTML snapshot using a fresh
sandboxed Chromium process, a private DevTools pipe and about:blank targets.
It does not open the application, existing tabs, user profiles or debug TCP
ports. Environment inheritance excludes application credentials. All request
loads are blocked; print content has a restrictive CSP before content parsing.
The caller must still enforce source authorization and the expected revision.

The same first-party strict Mermaid engine is now generated from root scripts
into separate backend, desktop and mobile assets. The mobile build command
remains compatible. The backend image copies its own generated asset; Chromium
installation/configuration and the API call path are not implemented here.

Bounds:20 MiB UTF-8 input/final HTML,24 MiB PDF,30-second overall timeout,
64 MiB DevTools frame and16 pending commands. Shared HTML enrichment now bounds
its final encoded output, not only input and SVG sizes. Closing or cancellation
kills the owned process group and removes its temporary profile.

## Observed evidence

- 53/53 focused renderer/pipe/shared engine/web hook checks passed, zero failures,
  skips or cancellations; log `/tmp/orbyn-pdf-renderer-qualified-focused.log`.
- All workspace typechecks and production builds passed; logs
  `/tmp/orbyn-pdf-renderer-current-{types,build}.log`.
- Scoped formatting and git diff --check passed.
- Actual offline fixture printed with sandboxed Chrome154 on macOS. Output
  `/tmp/orbyn-pdf-renderer-qa/doc-export-renderer-qa.pdf`; snapshot retained in
  `/tmp/orbyn-pdf-renderer-qa/print-snapshot.html`.
- Poppler reports11 A4 pages, tagged PDF and no PDF JavaScript. All pages were
  rendered to PNG at a1000-pixel longest edge and visually inspected.
- Inline fraction/integral and display sum are typeset; Greek/CJK glyphs, emphasis,
  long code and unbroken table content are visible and contained.
- All ten Mermaid families render: flowchart, sequence, state, class, ER, Gantt,
  pie, journey, mindmap and timeline. Test-only page breaks isolate each family.

Inspection found and corrected two defects:

1. Intrinsic SVG dimensions were discarded, stretching narrow diagrams and
   splitting four headings onto near-empty pages. Shared images now retain
   bounded numeric viewBox dimensions; print height leaves room for introductory
   content. The fixture shrank from15 pages to11.
2. Journey task labels used white fill on white boxes. The shared theme now sets
   section and task text/tspans to the existing text token. A regenerated page9
   visibly includes “Review tasks” and “Plan work”. The fix applies to all three
   generated runtime assets.

## Remaining required work

- Integrate the renderer into the authorized, primary-read, revision-fenced export
  API and client flows. The current API still uses the older plain PDF writer.
- Qualify Chromium installation and sandbox behavior in the production container;
  do not solve a container failure by disabling the browser sandbox.
- Bound concurrent work, map unavailable/timeout errors, and cancel on client
  disconnection without sending a partial file.
- Update route integration checks to inspect rendered PDF text and all ten
  diagram families instead of implementation-specific plain-writer streams.
- Real native download/share and visual/interaction acceptance; publication
  rendering parity; full current-head local/CI qualification.

This is offline renderer evidence, not product delivery or full D1/U1 acceptance.
