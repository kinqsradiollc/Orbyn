# ADR 005 Document Workspace — Tester Qualification

**Candidate:** `f39aad8ee2d6a6eea555c8017c92bb5c77c55cab`
**Parent / baseline:** `9d604df6dfe02e66a7c2492f67d9fab9aa3da9a2`
**Checkout:** `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
**Branch:** `codex/docs-writing-redesign`
**Phase:** command qualification complete; overall acceptance pending corrections
**Review counter:** ADR 005 round 1/3 is changes-required. ADR 004's historical 2/3 decision remains separate and unchanged.

The command checks below were run against the frozen product source. They passed. The candidate is **not accepted overall**: the independent round-1 review records three unresolved P2 findings, and rendered visual acceptance remains a separate Visual Check gate. Tester made no product or test-source edits.

## Focused formal test batch

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/document-workspace.unit.test.ts \
  backend/tests/latex-html-runtime.unit.test.ts \
  backend/tests/latex-html-host.unit.test.ts \
  backend/tests/document-export.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/doc-writing-experience.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/editor-input-ownership.unit.test.ts \
  backend/tests/neatness.unit.test.ts \
  backend/tests/button-fallback.unit.test.ts
```

**Result:** exit 0; 78/78 passed, 0 failed, 0 cancelled, 0 skipped (15.42 seconds). Mode-0600 TAP log: [`formal test batch`](/private/tmp/orbyn-document-workspace-formal-f39aad8e.tap).

## Builds, types and generated-runtime provenance

- `npm run build:packages` passed for `@orbyn/core` and `@orbyn/api-client`. Log: [`package builds`](/private/tmp/orbyn-document-workspace-packages-f39aad8e.log).
- `npm run build:pdf-renderer` passed. `npm run build:diagrams -w mobile` also passed and prepared Mermaid, HTML-preview and PDF-preview assets. Logs: [`Mermaid renderer build`](/private/tmp/orbyn-document-workspace-mermaid-assets-f39aad8e.log) and [`mobile asset preparation`](/private/tmp/orbyn-document-workspace-mobile-assets-f39aad8e.log).
- `npm run check:latex-html` passed the HTML runtime provenance and web/mobile parity check. `npm run check:diagrams -w mobile` passed all ten strict Mermaid fixtures.
- The generated PDF-preview assets on desktop and mobile had the expected source digest and identical HTML. The backend and mobile Mermaid assets had the expected source digest and identical HTML. Both checks passed. Logs: [`HTML runtime check`](/private/tmp/orbyn-document-workspace-html-provenance-f39aad8e.log) and [`PDF/Mermaid digest and parity checks`](/private/tmp/orbyn-document-workspace-pdf-mermaid-provenance-f39aad8e.log).
- `npm run typecheck -w desktop` and `npm run typecheck -w mobile` passed. Logs: [`desktop typecheck`](/private/tmp/orbyn-document-workspace-desktop-types-f39aad8e.log) and [`mobile typecheck`](/private/tmp/orbyn-document-workspace-mobile-types-f39aad8e.log).
- `npm run build -w desktop` passed, including its HTML/PDF runtime prebuild, TypeScript, Vite and homepage prerender. Vite printed its existing warning for minified chunks larger than 500 kB; the build completed. Log: [`desktop production build`](/private/tmp/orbyn-document-workspace-desktop-build-f39aad8e.log).

Generated assets were prepared as required by these commands; final Git status showed no generated or product-source changes. The only pre-existing tracked edit remains `docs/reviews/c6-production-visual-2026-10-11.md`; this report and the separate untracked Reviewer report were left outside the formal test-source diff.

## Open findings and gates

The Reviewer round-1 report, [`document-workspace-review.md`](document-workspace-review.md), records these source-level findings. They are not runtime-reproduced by this Tester pass and remain open for Builder correction and retest:

- **W1, P2 — undo can expose a stale render.** A→B→A before the delayed parse finishes can allow B to replace A's last-good output. Invalid B→A can also leave stale diagnostics. Add bundled-runtime regressions for both paths.
- **W2, P2 — desktop Docker build is missing the HTML generator/dependency.** The Docker context copies the PDF generator/runtime only, while desktop prebuild now runs the HTML generator and the selected-workspace install excludes the root `latex.js` dependency. The exact Docker target was not run on this known-incomplete freeze; rerun it after correction. The host desktop build above does not qualify that container path.
- **W3, P2 — preview ownership is not scoped to the selected TeX source.** Last-good output from one source can remain visible after selecting another source. Add selected-block ownership to both clients and test source switching plus same-owner last-good retention.

Visual acceptance remains with the Visual owner; this Tester did not interact with the shared browser fixture. No database-backed tests, Docker build, native build, external-provider test, production action or Security scan was run. Browser rendering, PDF download/compiler behavior and native behavior remain unverified by this report.

The Builder's development run history is preserved separately: an earlier run reported 77/78 after the type-scale assertion failed, then the type scale was corrected to 24 px and a later development run passed 78/78. This independent formal batch also passed 78/78; it does not erase that earlier failure.
