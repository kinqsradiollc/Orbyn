# PDF checkpoint handoff — 3 October 2026

Main-based branch: `codex/docs-pdf-main` in assistant-work-ownership. Candidate
contains only PDF runtime, required core helpers, first-party backend asset,
deployment wiring, actual export regressions and documentation. Based on
mainbdc4035b; broader source/UI/reflection/collaboration scope remains retained.

Evidence: [doc-pdf-main](evidence/doc-pdf-main.md). Before commit,55 unit checks,
38 real API checks, all workspace types/build/full formatting pass. Offline11-page
PDF visually inspected. Commit and freeze this runtime, run its own marked-DB
full local suite and exact-head CI, then promote only after full qualification.

Combined candidatea039f271 in assistant-runtime-integration passed2,488/2,488
locally, exit0, session32946 terminal, `/tmp/orbyn-pdf-a039f271-full-tests.log`.
CI37057124805 still has backend/web running; Docker/mobile/mail succeeded.
PR160 remains draft and stacked on the broad Docs source candidate; do not merge
it wholesale to main. Preserve prior branches/histories and primary user changes.

Next after this checkpoint: continue real native export/sharing and D1 publication/
embedded images, then remaining C1–C6/M1/U1/runtime acceptance. Full goal ACTIVE;
no deployment/release/cleanup. Do not accept native Terms or bypass denied app UI access.

## Qualification correction — 3 October 2026

- Main21c6c076 full local suite is terminal:2,245/2,246, one old clipboard expectation for `<h2>Plan</h2>` after authored level1 correctly becameh1. Updated that expectation and added exact all-six-level HTML/clipboard regressions; no h7. h4–h6 print at readable body size. [Heading fixture](pdf-heading-levels.png) inspected with no overlap or clipping.
- Combineda039f271 CI37057124805 failed one all-family PDF text assertion despite local2,488/2,488. Reproduced in a hardened offline Linux renderer: “flowchart” prints correctly but pdf.js returns adjacent `fl`/`owchart` font runs. The test inserted a false space. Position-based line reconstruction and normalization now recover all ten exact headings and all six required SVG labels from the Linux file. A regression covers split font runs and ligatures; expected headings are exact line checks.
  -Current57 browser/helper/service/primary/deployment units and63 actual export/rich-page/heading/text checks pass. All workspace types/build/full formatting pass after the fix. Linux diagnostic artifact is `/tmp/orbyn-pdf-linux-api-batch.pdf`; its older image isolates printing/font behavior and is not current-head image qualification.
  -New full exact-head local and CI qualification required after committing this correction. Previous main/combined CI failures are not passing evidence. PR161 stays draft until corrected full local/all CI pass; no main merge/deploy/release/cleanup.

## Qualified main promotion — 3 October 2026

PR161 is merged as e06c448450495d4948794485469926fe87ceb897. Exact tested head f875f517 passed **2,248/2,248** full local tests with zero failures/skips/cancellations, exit0, 531773ms. All four jobs in exact CI37060861021 pass. Primary main fast-forwarded with user mobile/app.json and unrelated untracked files preserved. No deployment/release/cleanup.

Image export implementation continues on codex/docs-export-images in the character checkout, based on this main merge. New export-images helper deduplicates and checks primary file visibility/readiness, validates raster MIME/signatures, limits32 images/4MiB each/8MiB combined, fetches signed first-party paths sequentially with a15s aggregate deadline, rejects redirects/traversal, embeds inert data URIs and rechecks file visibility/metadata. It is not yet wired into the export route.12 focused unit tests and backend typecheck pass after rebuilding current packages; initial typecheck used stale broad-source package output and failed on the old reflection union, not this helper.

Next: wire PDF/HTML image snapshots with request-disconnect cancellation, revalidate page and file authorization immediately before delivery, add actual API/raster PDF evidence, then qualify the entire new branch. Rendered HTML diagram parity/publication, native sharing and all remaining full ADR gates remain open. Preserve broad source histories, permission boundaries and primary user changes.
