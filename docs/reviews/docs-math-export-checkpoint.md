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

Main-source validation, a full suite and a rebuilt backend image are required
before push. This checkpoint does not prove browser rendering or math visual
fidelity on native mobile, PDF or Word. Mermaid diagrams in HTML/PDF exports and
the broader Markdown/UI ADR remain separate incomplete requirements.
