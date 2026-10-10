# C4/D1 review continuation — 8a449bce

**Decision: evidence pending.** No additional blocking code defect identified in this revision. The R4 nested-wrapper defect is closed at source/regression level. Full C4/D1 remains held under the retained acceptance contract; this is still **review round 1/3**, not a new round.

Candidate: `8a449bce17341fbc0fb2be19d665b4d6b0e734c9`, branch `codex/c4-docs-parity`, managed checkout `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`. Inspected the exact diff from `ccae5a60`, new test assertions, relevant rendered-export/publication assertions, Tester `c4-d1-tester-8a449bce.md` and the requirements ledger. Existing Tester documentation changes were preserved.

## Findings that can close

- **R4 nested-wrapper selection defect: closed.** Both scroll handlers now query `.structured-doc-leaf[data-container-path]`, matching the block-only map and excluding quote/list wrappers and ordinary embedded renderer nodes. The regression extracts and executes the actual handlers with wrapper-before-leaf geometry; it asserts Source moves into the visible leaf's line range and that the resulting synthetic source event is suppressed. The previous broad selector would fail the test. This is meaningful regression coverage, not proof of actual browser scrolling.
- **R1/R2: remain closed** for the identified source-validation, failed-receipt, durable-storage and acknowledgment defects. This revision does not change those paths.
- **R3: corrected caller wiring remains accepted at source level.** The prior 62/62 qualification is applicable to the unchanged guard callers. End-to-end rich-affordance refusal and successful dirty-draft navigation remain browser qualification items.
- **E2 rendered-output/security portion: qualified within the tested scope.** Tester reports 67/67 focused cases, workspace typecheck and 33/33 actual rendered API/publication cases on this exact candidate and marked test database. The render tests use the real rendering service, check ten-family PDF/HTML output, inert SVG/math and access/revision changes. These substantiate server-rendered output and security much more directly than source-preparation tests. They do not prove the active editor layout or complete the separate C5 publication stage.

## Limits of the new evidence

The scroll test drives Preview→Source selection and then the synthetic reverse-event suppression path. It does not independently drive user Source→Preview scrolling, native browser event timing, reflow, compact-pane switching or actual variable-height rendering. Keep those limits explicit rather than describing the one geometry test as complete bidirectional interaction qualification.

The mixed format-2 import/edit/Markdown-and-HTML fixture covers the structured serialization path. The inspected ten-family rendering fixtures create pages via legacy `content`; those actual render receipts demonstrate the shared renderer, not a complete end-to-end nested format-2 export matrix by themselves. This is an evidence boundary, not a newly asserted export bug.

## Remaining work

1. **Retained browser interaction gate:** when legitimately permitted, perform the bounded web/Expo rich-link invalid-buffer refusal and valid dirty-save handoff checks, and long mixed-height desktop scrolling in both directions. Check responsive pane switching, contained code/diagram overflow and the active preview's source/error behavior. Do not bypass the saved local-preview Block through another origin or tool.
2. **Finish ledger reconciliation:** resolve the still-open tasks/collaboration source-equivalence entry and extended-text format-2 editing/export coverage (callouts, highlights, TOC/frontmatter/unsupported source). Link applicable retained receipts where available; use targeted tests only for uncovered behavior. Record which export evidence covers format-2 routing versus the shared renderer. Do not rerun unchanged suites merely to replace valid receipts.
3. **Retain evidence limits:** browser-outage behavior remains inconclusive; installed-native behavior is untested. Neither is upgraded to a pass by storage unit tests or Expo web. Separate desktop/native builds, exhaustive retesting and routine Visual Check remain excluded; no new such gate is requested.

## Can this be accepted with deferred visuals?

**Not as complete C4/D1 under the instructions currently recorded.** The governing checkpoint still requires the retained functional interaction and D1 coverage. Authorization to continue blind design allows implementation while access is blocked; it does not explicitly defer acceptance requirements or approve integration with them outstanding. Several remaining checks are functional interactions, not merely cosmetic inspection.

A direct user disposition could explicitly defer named browser gates and authorize integration of a qualified subset. Such a decision would need to preserve the exclusions/unverified behaviors and resolve or explicitly defer the remaining non-browser ledger items. Reviewer cannot infer that change from the browser Block or grant it on the user's behalf. Until then, accept the code corrections and reported tested scopes above, but hold the full checkpoint and main-integration acceptance.

Reviewer ran no tests/builds, browser actions or database queries and edited no product/test source. No merge, push or deployment is claimed. Production deployment remains user-owned.
