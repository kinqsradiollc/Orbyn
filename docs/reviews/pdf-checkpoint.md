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
