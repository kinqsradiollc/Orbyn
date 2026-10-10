# C4/D1 review continuation — 0b96ad61

**Decision: evidence pending, round 1/3. No remaining non-browser correction finding from the preceding review.** Full checkpoint acceptance remains held for the retained browser interaction gates.

Candidate: `0b96ad6160d91dd2a5742ef863c9ccf1f1c16130`, branch `codex/c4-docs-parity`, managed checkout `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`. Reviewed only the delta from `8a449bce`, the updated ledger, prior decision and Tester's exact-candidate report. No repeat product-source sweep.

## Closure

- **Extended-source evidence gap closed within the serialization scope.** The new format-2 fixture edits highlight text and asserts preservation of frontmatter, folded callout, reference link, footnote definition and unsupported source; HTML escapes the unsupported element, and heading-fragment lookup succeeds. Tester reports the complete fixture suite **7/7**, with backend typecheck passing. This proves the asserted import/edit/serialization and fragment-index behavior, not rendered TOC interaction or semantic rendering of every extended feature.
- **Tasks/collaboration source-equivalence reconciliation closed.** The reported unchanged backend Docs/core domain paths are corroborated by the scoped diff from `45a80ca` to this candidate. Tester's named receipt-file equivalence is explicitly bounded. Client/editor/API-client changes are not included in that equivalence; multi-client interaction remains unverified. No redundant domain-suite rerun is requested.
- **R1/R2 remain closed; R3 caller correction and R4 nested-wrapper correction remain accepted at source/regression level.** This candidate changes no product source. The prior **67/67 unit checks, workspace typecheck and 33/33 actual rendered API/publication checks** remain applicable to their unchanged covered implementation. These are retained `8a449bce` receipts, not fresh executions on `0b96ad61`; the ledger's row-level “on this candidate” wording must be read with its explicit provenance paragraph.
- **Format-2 versus shared-renderer boundary remains recorded.** Structured fixtures qualify serialization; the earlier ten-family actual-render fixtures qualify the shared renderer through legacy-content inputs. Their combination is not a claim that every nested format-2 permutation was exercised end to end. No additional non-browser defect or targeted test requirement identified in this delta.

## Remaining gate and next owner

Tester still needs legitimately permitted, bounded web/Expo evidence for rich-link invalid-buffer refusal and valid dirty-save handoff; desktop mixed-height scrolling in both directions and feedback suppression; responsive pane switching/contained overflow; and active Preview/TOC, malformed-source and affected client interaction behavior recorded in the ledger. Preserve the inconclusive browser-outage result and unverified multi-client behavior. Do not bypass the saved local-preview Block.

Blind-design permission does not itself defer these functional acceptance requirements. Until their evidence arrives or the user explicitly changes the retained acceptance scope, **full C4/D1 and main-integration acceptance remain held**. Separate desktop/native builds, exhaustive retesting and routine Visual Check remain excluded. No further Builder code change is requested by this review.

Reviewer ran no tests/builds, browser actions or database queries and changed no product/test source. Existing Tester documentation was preserved. No merge, push or deployment is claimed.
