# C4/D1 continuation — review round 1/3

**Decision: changes required.** Full C4/D1 remains unaccepted. There is one confirmed source defect in R4, separate from the blocked browser qualification and remaining ledger evidence. Blind design authorization permits source work; it does not supply interaction evidence or waive retained requirements.

Candidate: `ccae5a609ad79218cfd94069802ab42ea1cbee6c`, `codex/c4-docs-parity`, this managed checkout. Product source matched HEAD. Existing working changes were Tester's progress/ledger edits and report; preserved. Reviewed changes from `428c7b4d`, prior findings, `c4-d1-requirements-ledger.md`, and `c4-d1-tester-ccae5a60.md`. No tests/builds, browser actions, database access or product/test edits performed.

## R3 — source correction accepted; interaction qualification pending

Mobile Mermaid and desktop Mermaid, embedded sections, linked tasks and object-pill actions now pass the owning editor's navigation handler. Embedded contexts retain the parent handler. Desktop Mermaid uses a ref for the current handler, avoiding a stale closure in its SVG listener. No remaining defect identified in these corrected callers.

The new tests exercise actual caller handlers and assert that the supplied guard is forwarded. This is materially stronger than no-op navigation mocks. They do not themselves execute the complete dirty/invalid-editor-to-global-navigation path: for example, the diagram test captures the handler argument rather than calling the editor guard. Retain the requested bounded interaction verification when access permits. R1/R2 and earlier scoped closures remain unchanged.

## R4 — P2: Preview scroll selects wrapper paths absent from the source lookup

**Location:** `desktop/src/features/docs/StructuredDocEditor.tsx:232–243`; wrapper attributes in `DocContainerView.tsx:90,106`.

`sourceBlocks` contains only ranges whose kind is `block`. However, `syncSourceFromPreview` gathers every `[data-container-path]`, including quote/list wrappers. DOM order places a wrapper before its descendants. While its bottom remains below the preview's top, `find` selects that wrapper, then the block-only lookup has no matching path and the handler returns without moving Source.

For a long document inside one quote or list, Preview→Source synchronization therefore fails throughout that container. This follows directly from the selector, DOM structure and range filter; it is independent of the browser-access restriction. Source→Preview wiring and feedback suppression do not resolve this reverse-direction mismatch.

**Builder correction:** Select only mapped leaf elements, preferably scoped to this editor's own rendered leaves (for example its `data-leaf-index` wrappers), or filter candidates through the block-range map before choosing the visible target. Do not let nested embedded-document elements or owner wrappers shadow a valid leaf. Keep container semantics in the document; change the scroll-target selection rather than flattening content.

**Tester verification:** Add a focused caller/DOM-geometry regression with an enclosing quote and nested list preceding their leaf elements in DOM order. Scroll the preview within the wrapper and assert Source moves to the corresponding mapped line. Include unequal-height code/math/diagram leaves and the programmatic-scroll suppression path. Pure source-range tests cannot catch this DOM-selection failure. Retain the bounded real-browser check once permitted; no exhaustive rerun is required.

## E2 — coverage ledger improved, qualification remains incomplete

The ledger now maps the full checkpoint and accurately separates many open rows. The combined format-2 fixture proves source parsing, an edit and Markdown/HTML serialization for mixed nested tasks/table/image/Mermaid content. It does not render Mermaid, fetch an authorized image, produce PDF, or verify overflow. The test's assertions match its useful but narrower purpose.

Tester reports workspace typecheck and **62/62** focused cases passed on this exact candidate, with no failures/skips. That supports corrected caller wiring, source mapping, code controls and the named safety/serialization paths. A non-failing React key warning is recorded; it is not an acceptance blocker. No new database-backed receipt was claimed.

Remaining ledger gates are not all caused by the browser Block:

- **Browser-dependent:** rich-link refusal/valid save-before-navigation; bidirectional nested scroll behavior after R4 correction; responsive pane switching/containment; active preview code/math/diagram/error behavior. Tester reports a saved local-preview Block. No alternative access path was attempted by Reviewer; do not bypass it.
- **Evidence reconciliation:** actual-render HTML/PDF/ten-family receipts and their source equivalence; current-source/private-file authorization; extended-text and media/alt-text coverage. Naming tests is not a passing receipt. Link retained results and establish applicability, or obtain targeted qualification through the authorized Tester workflow. Existing evidence reconciliation can proceed without browser access.

The report therefore does not adopt “HOLD solely because browser access is blocked” as the overall checkpoint conclusion. R4 is an actionable code defect, and the ledger still explicitly retains non-visual evidence work. Do not expand this into separate native builds, exhaustive checks or routine Visual Check; those remain excluded, not passed. C5 remains separate and production deployment remains user-owned.

**Next owners:** Builder fixes R4 and completes evidence mapping; Tester qualifies the affected selection/scroll logic and supplies applicable remaining receipts. Browser interaction remains pending until the saved Block is legitimately resolved. Reviewer then closes the retained scope within round **1/3**. No integration, push or deployment acceptance is issued here.
