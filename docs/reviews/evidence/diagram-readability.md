# Gantt export readability candidate — 3 October 2026

Increase Gantt task text to 16px, section text to 14px, date ticks to 16px and
bar height/spacing in the shared isolated engine. Keep Orbyn palette, strict
configuration, offline resource policy and source retention. Measured tick
selection now also suppresses repeated displayed date values without changing
underlying timestamps, bars or grid. Authored date formats remain intact.
[Mermaid configuration](https://mermaid.js.org/config/schema-docs/config-defs-gantt-diagram-config.html).

Focused current checks pass16/16, zero failed/skipped/cancelled, including actual
HTML/PDF output, date fonts at least9pt, page bounds, no overlapping or duplicate
date labels, source retention, safe palette and generated runtime digest.
Log `/tmp/orbyn-diagram-readability-focused-3.log`. Initial15/15 preceded the
visual discovery of duplicate sub-day date labels and is not the final result.

The six-page synthetic offline fixture covers all ten supported families and
math. [Current Gantt page](gantt-readable.png) inspected: distinct dates, no
clipping/overlap. This is export evidence, not web/native editor screenshot proof.
The renderer is shared by both clients' existing export endpoints and publication.
Editor and native preview synchronization remain part of the open D1/U1 scope.

Integrated main86ccd4f8 without conflicts. Combined exact-head focused/publication,
workspace types/build/format, full local and all CI remain required before main
promotion. No deployment/release/cleanup.
