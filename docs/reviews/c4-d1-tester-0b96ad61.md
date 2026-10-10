# C4/D1 Tester retest — `0b96ad61`

**Disposition: focused check passed; full checkpoint remains HOLD.** The extended format-2 source fixture passed on the exact candidate and backend typecheck passed. Browser-based TOC/editor interaction and the wider C4/D1 gates remain open in round 1/3.

Candidate: `0b96ad6160d91dd2a5742ef863c9ccf1f1c16130` on `codex/c4-docs-parity`, checkout `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`.

From `backend/`, ran `npx tsx --test --test-concurrency=1 tests/doc-container-export.unit.test.ts`: **7 passed, 0 failed, 0 skipped**. The exact-candidate format-2 fixture retains frontmatter, a folded callout, highlight syntax, reference links, footnotes, heading-fragment lookup, and unsupported raw source across edit and Markdown/HTML serialization. Unsupported markup remains escaped and inert in HTML. The existing mixed task/table/image/Mermaid fixture also passed. No database or application service was used.

Ran `npm run typecheck -w backend`: **passed**.

For the ledger's domain-source equivalence claim, `git diff --name-only 45a80ca..8a449bce -- backend/src/modules/docs packages/core/src` returned no paths. The task/comment/CRDT receipt-file filter also returned no paths. The complete historical diff is not empty: it includes client editor/render/navigation changes, `packages/api-client/src/doc-editor-store.ts`, and other tests/docs. Therefore the equivalence is limited to the cited backend Docs/core domain paths and named task/comment/CRDT receipts, not all client or workspace source. The step from `8a449bce` to this candidate adds the fixture and review documentation only; no product source changed.

The saved local-preview Block remains in force, so active Preview/TOC interaction and visual behavior were not checked. No alternate browser, port, or capture path was used. The fixture does not close the TOC interaction gate or the broader C4/D1 ledger. Round 1/3 remains open; no integration, push, or deployment is claimed.
