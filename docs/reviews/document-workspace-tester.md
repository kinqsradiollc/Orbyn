# ADR 005 Document Workspace — Tester Qualification

**Initial candidate:** `f39aad8ee2d6a6eea555c8017c92bb5c77c55cab`
**Latest corrected candidate:** `a844c8b9c595f879e697c086fa2037cca9c80a10`
**Parent / baseline:** `9d604df6dfe02e66a7c2492f67d9fab9aa3da9a2`
**Checkout:** `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
**Branch:** `codex/docs-writing-redesign`
**Phase:** corrected command retest complete; Reviewer closure and Visual acceptance pending
**Review counter:** ADR 005 remains in round 1/3 for same-round correction closure. ADR 004's historical 2/3 decision remains separate and unchanged.

The first-pass checks below qualify `f39aad8e`; the final section records the independent retest on `a844c8b9`. The three source findings from round 1 were corrected and the affected tests plus the exact Docker target now pass. Overall acceptance still awaits the Reviewer's same-round closure and the separate Visual Check gate. Tester made no product or test-source edits.

## Initial formal test batch — f39aad8e

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

## Initial builds, types and generated-runtime provenance — f39aad8e

- `npm run build:packages` passed for `@orbyn/core` and `@orbyn/api-client`. Log: [`package builds`](/private/tmp/orbyn-document-workspace-packages-f39aad8e.log).
- `npm run build:pdf-renderer` passed. `npm run build:diagrams -w mobile` also passed and prepared Mermaid, HTML-preview and PDF-preview assets. Logs: [`Mermaid renderer build`](/private/tmp/orbyn-document-workspace-mermaid-assets-f39aad8e.log) and [`mobile asset preparation`](/private/tmp/orbyn-document-workspace-mobile-assets-f39aad8e.log).
- `npm run check:latex-html` passed the HTML runtime provenance and web/mobile parity check. `npm run check:diagrams -w mobile` passed all ten strict Mermaid fixtures.
- The generated PDF-preview assets on desktop and mobile had the expected source digest and identical HTML. The backend and mobile Mermaid assets had the expected source digest and identical HTML. Both checks passed. Logs: [`HTML runtime check`](/private/tmp/orbyn-document-workspace-html-provenance-f39aad8e.log) and [`PDF/Mermaid digest and parity checks`](/private/tmp/orbyn-document-workspace-pdf-mermaid-provenance-f39aad8e.log).
- `npm run typecheck -w desktop` and `npm run typecheck -w mobile` passed. Logs: [`desktop typecheck`](/private/tmp/orbyn-document-workspace-desktop-types-f39aad8e.log) and [`mobile typecheck`](/private/tmp/orbyn-document-workspace-mobile-types-f39aad8e.log).
- `npm run build -w desktop` passed, including its HTML/PDF runtime prebuild, TypeScript, Vite and homepage prerender. Vite printed its existing warning for minified chunks larger than 500 kB; the build completed. Log: [`desktop production build`](/private/tmp/orbyn-document-workspace-desktop-build-f39aad8e.log).

Generated assets were prepared as required by these commands; final Git status showed no generated or product-source changes. The only pre-existing tracked edit remains `docs/reviews/c6-production-visual-2026-10-11.md`; this report and the separate untracked Reviewer report were left outside the formal test-source diff.

## Initial findings and gates — f39aad8e

The Reviewer round-1 report, [`document-workspace-review.md`](document-workspace-review.md), recorded these source-level findings on `f39aad8e`. Their affected regressions were added to the corrected candidate and exercised in the retest below; the Reviewer still owns formal same-round closure:

- **W1, P2 — undo can expose a stale render.** A→B→A before the delayed parse finishes can allow B to replace A's last-good output. Invalid B→A can also leave stale diagnostics. Add bundled-runtime regressions for both paths.
- **W2, P2 — desktop Docker build is missing the HTML generator/dependency.** The Docker context copies the PDF generator/runtime only, while desktop prebuild now runs the HTML generator and the selected-workspace install excludes the root `latex.js` dependency. The exact Docker target was not run on this known-incomplete freeze; rerun it after correction. The host desktop build above does not qualify that container path.
- **W3, P2 — preview ownership is not scoped to the selected TeX source.** Last-good output from one source can remain visible after selecting another source. Add selected-block ownership to both clients and test source switching plus same-owner last-good retention.

Visual acceptance remains with the Visual owner; this Tester did not interact with the shared browser fixture. On the initial `f39aad8e` pass, no database-backed tests, Docker build, native build, external-provider test, production action or Security scan was run. Browser rendering, PDF download/compiler behavior and native behavior remain unverified by this report.

The Builder's development run history is preserved separately: an earlier run reported 77/78 after the type-scale assertion failed, then the type scale was corrected to 24 px and a later development run passed 78/78. The independent formal batch on `f39aad8e` also passed 78/78; it does not erase that earlier failure.

## Round 1 correction retest — a844c8b9

The corrected frozen product source is
`a844c8b9c595f879e697c086fa2037cca9c80a10`, parent
`8739ab94db5a493f3d6ec81f77f1b91da82d23c4`, on the same checkout and branch.
This is the retest and closure evidence for ADR 005 review round 1/3; it does
not start a new full review round. The initial `f39aad8e` results and the earlier
77/78 Builder development failure above remain preserved.

The exact same 12-file formal command above passed **81/81**, 0 failed, 0
cancelled and 0 skipped (29.18 seconds). This corrected test batch includes
undo/in-flight-render recovery, selected-source ownership and workspace layout
regressions. Mode-0600 TAP log: [`a844c8b9 formal test batch`](/private/tmp/orbyn-document-workspace-formal-a844c8b9.tap).

`npm run build:packages`, `npm run typecheck -w desktop` and
`npm run typecheck -w mobile` passed. Their logs are [`package builds`](/private/tmp/orbyn-document-workspace-packages-a844c8b9.log), [`desktop typecheck`](/private/tmp/orbyn-document-workspace-desktop-types-a844c8b9.log) and [`mobile typecheck`](/private/tmp/orbyn-document-workspace-mobile-types-a844c8b9.log).

`npm run build:pdf-renderer`, `npm run build:diagrams -w mobile` and
`npm run check:diagrams -w mobile` passed; all ten Mermaid fixtures parsed under
the strict policy. The mobile command prepared Mermaid, HTML-preview and
PDF-preview assets. The final post-desktop-build `npm run check:latex-html`
passed, as did the final PDF and Mermaid source-digest and desktop/mobile HTML
parity checks. Logs: [`Mermaid renderer build`](/private/tmp/orbyn-document-workspace-mermaid-assets-a844c8b9.log), [`mobile asset preparation`](/private/tmp/orbyn-document-workspace-mobile-assets-a844c8b9.log), [`Mermaid fixture check`](/private/tmp/orbyn-document-workspace-mermaid-fixtures-a844c8b9.log), [`final HTML runtime check`](/private/tmp/orbyn-document-workspace-html-provenance-final-a844c8b9.log) and [`final PDF/Mermaid provenance checks`](/private/tmp/orbyn-document-workspace-pdf-mermaid-provenance-final-a844c8b9.log).

`npm run build -w desktop` passed its runtime prebuild, TypeScript, Vite and
homepage prerender. The exact requested production container target also passed:

```sh
docker build -f desktop/Dockerfile \
  -t orbyn-adr005-web:a844c8b9 \
  --build-arg GIT_SHA=a844c8b9 .
```

Docker completed the selected-workspace `npm ci`, copied the HTML and PDF
runtime generators, ran both generators inside the build image, built the
production bundle, prerendered the homepage, and exported the nginx image.
Result: exit 0; image `orbyn-adr005-web:a844c8b9`, image ID
`sha256:7ec3ebd304f4754b52d52e49fd407bdf8ca91c939e099b12d37cbc9de85601e6`
(`linux/arm64`). The host build log is [`desktop production build`](/private/tmp/orbyn-document-workspace-desktop-build-a844c8b9.log); the full container log is [`production Docker build`](/private/tmp/orbyn-document-workspace-docker-build-a844c8b9.log). Both Vite builds completed with the existing warning about minified chunks larger than 500 kB; Docker's `npm ci` also printed upstream deprecation notices.

After host builds, runtime provenance and desktop/mobile parity passed again.
No generated asset, product-source or test-source changes were left in Git.
Tester did not access the browser fixture; actual corrected-design review and the
unperformed Visual cases in [`document-workspace-visual.md`](document-workspace-visual.md)
remain with the Visual owner. Native, database-backed, provider, production and
Security-scan checks remain outside this retest. The unrelated C6 edit and the
untracked Reviewer report remain untouched.
