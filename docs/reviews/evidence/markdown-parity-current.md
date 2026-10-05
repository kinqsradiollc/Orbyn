# Docs parity verification — 5 October 2026

Source: main checkpoint31f11d2f. This verifies the named automated contracts,
not rendered appearance or full D1 acceptance.

The serial pure cohort passed108/108, with no failures or skips, in
`/tmp/orbyn-d1-current-pure.log`:

| Contract                                         | Exercised suite                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Canonical Markdown dialect and retained syntax   | `markdown-dialect.unit.test.ts`                                   |
| Inline formatting and link/reference handling    | `doc-inline-markdown.unit.test.ts`, `doc-references.unit.test.ts` |
| Source serialization, editing and revision guard | `doc-source.unit.test.ts`, `doc-source-edit.unit.test.ts`         |
| Frontmatter preservation                         | `doc-frontmatter.unit.test.ts`                                    |
| Web/native source-view component interactions    | `doc-source-view.unit.test.ts`                                    |
| Mermaid strict parsing and runtime security      | `mermaid.unit.test.ts`, `mermaid-runtime.unit.test.ts`            |
| Web and mobile Mermaid source contracts          | `mermaid-web.unit.test.ts`, `mermaid-mobile.unit.test.ts`         |

Remaining acceptance includes real web/mobile diagrams, zoom/scroll/export,
source/rendered synchronization, PDF/Word/import round trips, accessible maths,
and the complete required Markdown matrix. Tests of source and component
harnesses do not establish native device behavior. Browser Use still reports a
saved Block for5174; Simulator Computer Use still times out -10005. Those are
open acceptance gaps, not passing results. No production deployment is claimed.
