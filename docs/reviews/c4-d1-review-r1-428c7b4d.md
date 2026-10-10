# C4/D1 checkpoint decision — round 1/3

**Decision: changes required. The complete C4/D1 checkpoint is not accepted for main integration.** The latest object-pill correction passes its targeted qualification, but it does not close every navigation path or the governing D1 matrix. Continue batched correction/closure within round **1/3**, maximum three full rounds.

Reviewed product candidate `428c7b4d25c32b828a17a35f48fe918c99bda78c`, `codex/c4-docs-parity`, `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`. Existing changes were limited to Tester's progress update and untracked r4 report. Inspected corrections since `907f45bd`, original/preliminary findings, Tester r1–r4 reports, `adr-execution-order.md`, and the D1 contract at `devday-2026-implementation-review.md:695–710`.

## Accepted finding closures and their limits

- **R1 closed:** Independent invalid-source state now survives title edits, successful/failed save receipts and failed conflict refresh. Tests explicitly defer requests, introduce duplicate anchors, settle/reject them and assert retained buffer/validation. Earlier web/Expo checks establish the title-change behavior.
- **R2 closed for the identified persistence and invalid-source acknowledgment defects:** Outbox/cache receipts await serialized storage and propagate rejection; acknowledgment is generation-bound. Invalid-source guards now run before offline queueing, after durable cache completion and before/after leaving. Store plus caller-helper tests cover rejection even with a queued flag. Persistence delay/rejection/reopen tests are meaningful. Live mobile offline interaction remains unverified/inconclusive; no installed-device pass is inferred.
- **R3 partially closed:** Same-page/cross-page heading and explicit-block targeting, editor-capable fetches, missing initial-target feedback, valid draft handoff and mobile object-pill guard are supported by source and Tester r2–r4 evidence. The exact r4 check closes the mobile `LinkPillText` route, not all rich-content navigation. R3 remains open through the bypasses below.
- **E1 closed:** The previously missing ownership suites were supplied in the 91/91 r2 run; the History restore Orbyn-dialog interaction passed. These do not establish the entire D1 render/import/export matrix.

These are accepted corrections and qualified behavior within the candidate, not approval to integrate an incomplete full checkpoint.

## R3 continuation — P1: Rich-content links still bypass draft guards

**Locations:** `mobile/src/components/MermaidDiagram.tsx:240`; `desktop/src/features/docs/RichBlocks.tsx:1203,1402,1417–1420,1490`; desktop dispatcher `DocLinks.tsx:73–81`.

Mobile's Mermaid “Open [node]” button calls `openObject(node.link!)` without the current `DocNavigationContext.onAppLink`. Its default calls `openAppUrl` directly. Desktop Mermaid node listeners, section-embed Open/fragment links and linked-task controls likewise call `openObject` or dispatch `OPEN_LINK_EVENT` directly. They bypass `StructuredDocEditor.openLinkedPage`, even though ordinary inline links now use that guard.

Concrete failing path: save a flowchart containing a node link to another Doc; start invalid Source using duplicate anchors (leaving the previous valid tree visible); switch to Preview on mobile and use the diagram's Open button, or click the diagram node on web. The global navigation path can replace the editor without validating or retaining the invalid buffer. This is the same data-loss class as the object-pill failure, on another reachable renderer. The mobile Mermaid test mocks `openObject` as a no-op and cannot detect the bypass. This is application-owned link routing, not a claim that Mermaid executes arbitrary scripts.

**Builder correction:** Route every rich-content action that replaces the current page through its owning editor's guarded navigation callback. Preserve parent ownership when nested section renderers install a child navigation context. Audit diagram links, embed headers/fragments and linked-task actions together on both clients; keep appropriate global fallback for rendering outside an editor. Centralize the routing contract where practical so each leaf renderer need not invent an independent guard.

**Tester verification:** Caller-level assertions must prove each affected affordance reaches the supplied guard and does not dispatch globally after refusal. Use a bounded web/Expo interaction with a linked diagram and invalid Source, then a valid dirty draft: refusal retains the buffer; successful navigation saves first. Include embedded-section routing in focused caller tests. No full visual sweep is requested.

## R4 — P2: Structured desktop editor omits required scroll synchronization

**Location:** `desktop/src/features/docs/StructuredDocEditor.tsx:116–149,488–604`; D1 Preview row.

The new normal editor maps caret selection to preview and block clicks to source, but it has no Source or Preview scroll handler. Scrolling a long Source textarea leaves the rendered view at its previous location; scrolling the rendered page likewise does not synchronize Source. The existing `DocSourcePreview.tsx:298,311` has scroll handlers, but this structured path replaces it. Click/caret mapping does not satisfy the separately specified scroll-synchronization behavior.

**Builder correction:** Wire scroll synchronization against the current complete source map and the actual scrolling surfaces, with feedback-loop prevention. Preserve the common revision/draft and nested block ownership; reuse established mapping logic where appropriate.

**Tester verification:** Use a long nested page with differently sized code/math/diagram blocks. Scroll each view without moving the caret or clicking a block, and verify the other follows the corresponding content without oscillation or draft mutation. A focused functional check suffices; native builds and routine Visual Check remain excluded.

## Full-checkpoint assessment and remaining evidence gate E2

The governing execution order requires complete C4/D1, not only closing the latest navigation defect. The current progress table's statement that existing renderers/adapters are retained is an implementation claim, not proof of every matrix row.

| D1 area | Supported by reviewed evidence | Remaining gate before full acceptance |
| --- | --- | --- |
| CommonMark/GFM | Structured ownership/storage, source/parser tests; sampled nested/task edits in both clients | Map retained import/edit/export fixtures to the required syntax, including embedded fences, images and tables. Supply missing targeted receipts rather than rerunning unchanged coverage indiscriminately. |
| Code | Existing bundled rich-code renderer reused | Identify evidence for coloring, copy/source, unknown-language fallback and contained long lines through the active structured editor. |
| Mermaid | Restricted bundled renderer and bounds/policy tests; sampled flowchart preview | Close R3. Establish all ten required families through real rendering and relevant zoom/scroll/export/error behavior using current or demonstrated source-equivalent receipts. `mermaid.unit.test.ts`'s ten-family test only calls `prepareMermaidSource`; it does not render the ten diagrams. |
| Math | Math HTML tests and sampled inline/display source/preview | Map malformed-input, accessible source and preview/export consistency evidence to the active paths. |
| Extended text | Reference/footnote preservation helpers and navigation checks | Record coverage for callouts/highlights/frontmatter/TOC and inert raw/unsupported syntax through editing and export. |
| Preview | Shared draft/revision, desktop side-by-side, mobile toggle and block/line targeting | Close R4 and remaining guarded navigation paths. |
| Export/share | Structured Markdown/HTML privacy adapter tests; version-fenced export route; existing rendered HTML/PDF pipeline | Provide current/source-equivalent actual rendered HTML/PDF diagram/math and authorization/current-source receipts. Adapter-only tests and no UI download are insufficient to claim this row fully qualified. Scope publication evidence to D1's export/share contract; do not substitute completion of the separate C5 stage. |
| Media/security | Existing authorization/privacy and restricted-renderer boundaries; focused tests | Tie file authorization, alt text, URL safety, malicious/oversized inputs and isolation receipts to the retained matrix. Do not infer all of these from the object-pill test. |

**E2 correction:** Builder should add a concise requirement-to-implementation/test-receipt ledger covering all eight rows and C4's normal save/recovery/history/tasks/collaboration paths. Tester should qualify only uncovered retained behavior. Existing exact or source-equivalent historical receipts may satisfy rows if linked and checked for applicability. Explicitly label implementation gaps versus missing evidence; do not claim unsupported features are absent solely because receipts are missing. The table above identifies qualification gaps, while R3/R4 are concrete code defects.

## Evidence boundaries

Tester r4 reports **12/12** focused checks and workspace typecheck on `428c7b4d`, plus exact Expo invalid-object-link refusal and valid dirty-title handoff. Retain earlier **115/115**, **91/91**, **2/2**, and **14/14** only for unchanged relevant paths; the original **124/124** batch remains supplemental with its documented candidate drift. Reported web checks from b556 remain source-equivalent because the final correction is mobile-only. The offline browser attempt remains inconclusive; storage unit tests are not a live network-outage claim.

Reviewer performed source/evidence inspection only: no tests/builds, browser operations, QA database access or product/test edits. Separate desktop/native iOS/Android builds, exhaustive retesting and routine Visual Check are explicitly excluded, not blockers being reintroduced and not passes. No merge, push or deployment is claimed. Deployment remains user-owned.
