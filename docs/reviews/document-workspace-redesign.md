# Document workspace redesign

Decision: [ADR 005](../adr/005-document-workspace.md).
Baseline: `9d604df6`. Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Branch: `codex/docs-writing-redesign`. Phase: frozen for qualification. Review counter: 0/3.
Goal: complete viewport-owned Note/Markdown/LaTeX workspace and direct HTML preview,
with actual design acceptance on web and Expo after all code is complete.

## Required scope and completion evidence

| Requirement                                       | Evidence needed                                                   | Current disposition |
| ------------------------------------------------- | ----------------------------------------------------------------- | ------------------- |
| Persistent toolbar and readable Note              | Actual writing/scroll and design review                           | In progress         |
| Dedicated source-left/result-right workspace      | Actual complete-document mode, no nested duplicate editors        | In progress         |
| Resizable independently scrolling panes           | Pointer + keyboard resize and real long content                   | In progress         |
| Collapsible compact library and useful viewport   | Wide, split app pane and narrow task-space review                 | In progress         |
| Phone Source/Preview navigation                   | Expo actual transition/draft preservation                         | In progress         |
| Direct HTML LaTeX preview                         | Full starter, headings/prose/math/lists and continuous typing     | In progress         |
| Stable last-success rendering                     | Incomplete/unsupported source, repair, same host, no PDF flashing | In progress         |
| Explicit PDF export                               | Revision/access fences; failure leaves editor and preview intact  | In progress         |
| Storage, comments, assistant and source ownership | Affected formal tests and UI entry/recovery                       | In progress         |
| Formal Test → Review                              | Exact frozen candidate and bounded counter                        | Pending             |
| Visual actual design assessment web + Expo        | Whole completed code before requested design batch                | Pending             |
| Main delivery                                     | Accepted source, verified remote ref                              | Pending             |

## Initial evidence and architecture

The owner screenshot shows two sidebars, excess margins, a split embedded inside a
block, scattered controls and tiny full-page PDF content. Earlier functional
acceptance is not evidence that this design met the owner's task. No prior visual
pass qualifies the new workspace. A bundled HTML renderer will remove routine PDF
compilation/remounting from editing. PDF export retains the existing compiler.
The parser has documented unsupported TeX/package/layout semantics; source remains
unchanged, diagnostics stay local, last-good output stays readable during errors.
No new backend/environment variables or database migrations are planned.

Initial renderer build failed because LaTeX.js distribution glob imports include
`.keep` files; the explicit empty loader handles those non-code placeholders.
Node parser exploration needed a standards-mode DOM for KaTeX. These are setup
attempts, not formal qualification or browser acceptance.
Preserve unrelated `c6-production-visual-2026-10-11.md` working changes.

## Implementation and development checks

- Both editor formats now own the viewport, with a persistent toolbar, measured
  compact layout, independent source/result scrolling and adjustable divider.
- Source selection addresses the chosen marked LaTeX document while preserving
  other source blocks, nested paths and IDs. Note retains ordinary prose editing.
- Bundled LaTeX.js 0.12.6 renders into a fixed isolated host. Debounced messages
  update its content atomically. No automatic compile request or PDF viewer is
  mounted during editing. Unsupported/partial input retains the last good output.
- PDF export captures the source and keeps readiness, cancellation and account
  guards. Existing private compiler configuration is unchanged. No env migration.
- Web and Expo share generated runtime provenance. Build with root
  `npm run build:latex-html`; `npm run check:latex-html` checks source digest/parity.
  Desktop predev/prebuild and mobile build:diagrams prepare the bundled asset.
- Changed source includes core source selection, both editor/provider/source
  components, desktop workspace CSS/library, mobile Sheet/divider/workspace,
  isolated runtime/build scripts, tests, design guidance, setup and ADR docs.
- Desktop/mobile typechecks and desktop production build passed in development.
  Existing Vite large-chunk warning remains; it is not a rendered-design pass.
- First combined development run passed77/78: the new compact title used22px
  outside the shared type scale. An initial20px correction also failed the scale check; corrected to24px from the shared TYPE_SCALE. Rerun recorded separately.
- Earlier mounted harness attempts lacked browser globals/AbortController or used
  a cross-realm Error; corrected the harness and retained behavioral assertions.
  Runtime/host/export tests exercise actual bundled parser and mounted iframe,
  including same-host retention and explicit-only export.

These are Builder development checks, not formal Test/Review or visual acceptance.
No Security scan, native build, production data or external-provider call was used.

Final Builder development suite:78/78 passed (`/private/tmp/orbyn-workspace-full-dev3.tap`).
Desktop and mobile typechecks passed. Desktop production build and both generated
asset preparations passed. HTML runtime provenance/parity passed. Generated Mermaid
and PDF runtime metadata changed because the root dependency lock changed; their
existing renderer content is retained. Formal Tester must qualify the frozen commit.
