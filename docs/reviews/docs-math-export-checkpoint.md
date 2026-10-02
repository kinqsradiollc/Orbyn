# Docs math export checkpoint

## Source delivered

HTML downloads now use the same server MathML renderer as published pages.
Inline fractions and display equations keep mathematical markup, with LaTeX in
MathML annotations. The files need no remote scripts, stylesheets or fonts.
Malformed expressions remain escaped source/error text. Commands that can create
links, images, HTML styles or data attributes are disabled (`trust: false`).

The renderer limits source to 16,384 characters, generated markup to 512 KiB,
macro expansion to 200 and user sizes to 20 em per expression. Each document gets
its own 128 Ki-character source-work and 2 MiB output budgets. There is no shared
macro or budget state across expressions, documents or users. When a configured
renderer cannot draw an expression, HTML export keeps exact escaped LaTeX in a
labelled source fallback. Default plain-text exports retain their existing form.

The options follow the [KaTeX rendering contract](https://katex.org/docs/options.html)
and are exercised against the repository's installed renderer.

## Evidence

On the model/Docs worktree, 64 focused checks passed: real MathML rendering,
malformed/untrusted commands and macro isolation; explicit mocked output/work
budget fences; HTTP export (including 401, 403, 400, 404/422 and 429 guards);
publication and private-link visibility. Workspace typecheck passed. Logs:
`/tmp/orbyn-math-export-final-tests.log` and
`/tmp/orbyn-math-export-final-types.log`.

An earlier final attempt could not connect because the dedicated test container
was stopped. Only that loopback test container was started. Its former named
databases were absent, so fresh marked disposable databases were created. The
successful integration run migrated the fresh test schema. No production database
or production container was changed. Prior failures remain failures; unit success
from the disconnected attempt was not substituted for integration proof.

## Remaining gates

Main source `f23bab1` passed 99 focused checks and workspace typecheck. Its
production backend image `orbyn-docs-checkpoint:f23bab1` built successfully;
a compiled smoke check with networking disabled verified fraction/display
MathML and blocked image commands. Logs: `/tmp/orbyn-docs-main-focused-tests.log`,
`/tmp/orbyn-docs-main-types.log`, `/tmp/orbyn-docs-main-docker-build.log` and
`/tmp/orbyn-docs-main-docker-smoke.log`.

The existing mobile Download/Share menu includes HTML and uses the same server
endpoint. Main `5906fe5` makes its format list use the shared catalog, preserves
the selected MIME type when absent from a blob, revokes browser blob URLs after
failed downloads and reports unavailable binary sharing. Thirteen checks execute
the real mobile utility with mocked platform/filesystem/share interfaces on web,
iOS and Android, including exact preservation of actual MathML output. Workspace
typecheck passed. iOS/Android Metro exports passed on the corresponding model/Docs
worktree `2046685`. These are source/behavior and packaging checks, not touch or
visual proof. Logs: `/tmp/orbyn-mobile-download-main-tests.log`,
`/tmp/orbyn-mobile-download-main-types.log` and
`/tmp/orbyn-mobile-export-download-checkpoint.log`.

Frozen main `b6096c8` passed all 2,078 tests with no failures, skips or
cancellations. Log: `/tmp/orbyn-docs-mobile-main-full-tests.log`.
The preceding `f23bab1` full run failed one date-dependent exam fixture (2,064
passed, one failed): on Fridays its exam fell outside the seven-day selector
horizon. The corrected fixture passed 21/21 focused checks and the fresh full
suite. No production reminder behavior was changed for this fixture failure.

This checkpoint does not prove browser rendering or math visual
fidelity on native mobile, PDF or Word. Mermaid diagrams in HTML/PDF exports and
the broader Markdown/UI ADR remain separate incomplete requirements.
