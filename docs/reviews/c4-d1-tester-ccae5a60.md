# C4/D1 Tester execution — `ccae5a60`

**Disposition: HOLD.** The focused code-level checks passed on the frozen candidate, but browser-dependent validation of the R3 interaction and R4 Source/Preview scrolling remains blocked. This does not close round 1/3 or accept the full C4/D1 checkpoint.

## Candidate and scope

- Candidate: `ccae5a609ad79218cfd94069802ab42ea1cbee6c`
- Branch: `codex/c4-docs-parity`
- Checkout: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`
- Phase: Tester, focused round 1 requalification of rich-content navigation, desktop Source/Preview behavior, and the combined format-2 Markdown import/edit/export fixture.
- Prior review: [`c4-d1-review-r1-428c7b4d.md`](./c4-d1-review-r1-428c7b4d.md)
- Round: 1/3. No product or test source files were edited during this execution.

## Executed checks

`npm run typecheck` — **passed**. Shared packages built, then backend, desktop, and mobile typechecks completed successfully.

From `backend/`, ran:

```sh
npx tsx --test --test-concurrency=1 \
  tests/doc-linked-task-navigation.unit.test.ts \
  tests/doc-reference-title-render.unit.test.ts \
  tests/doc-section-navigation.unit.test.ts \
  tests/doc-container-export.unit.test.ts \
  tests/doc-versioned-source.unit.test.ts \
  tests/doc-code-controls.unit.test.ts \
  tests/doc-nested-render.unit.test.ts \
  tests/math-html.unit.test.ts \
  tests/mermaid-mobile.unit.test.ts \
  tests/mermaid-runtime.unit.test.ts \
  tests/mermaid-web.unit.test.ts
```

Result: **62 passed, 0 failed, 0 skipped**. The run covered web/mobile linked-task caller guards, web/mobile embedded-section routing, web/mobile Mermaid node routing, reference/object links, nested source mapping, code controls, math safety/fallback, Mermaid bounds/security, and the combined format-2 fixture that imports, edits, then serializes Markdown and HTML with a nested task list, table, image, and Mermaid fence. The reference-title suite emitted a React missing-key warning; it did not fail a test.

No database-backed tests or application writes were run. No Docker service was started.

## Browser and interaction limits

The shared browser-use record reports a saved Block for the local preview at `http://127.0.0.1:5174`. The available in-app browser tab currently identifies as the Orbyn marketing homepage, not a QA editor session. I did not try another origin, port, browser, or capture path to get around the saved Block.

As a result, these requested checks remain **unverified**:

- On web and Expo web, invalid Source duplicate anchors followed by Preview and a Mermaid, embed, or linked-task action; confirm refusal retains the buffer, then confirm a valid dirty draft saves before navigation.
- On desktop, scroll a long nested page in both Source and Preview with different code/math/diagram heights; confirm correspondence, no oscillation, and no draft mutation.
- Inspect the responsive two-pane/compact-switch layout and actual rendered overflow at wide and narrow widths.

Source inspection confirms paired handlers use the current `versionedDocSourceMap` and the rendered `data-container-path` elements, and the existing source-range tests passed. That is implementation and unit evidence only; it is not an interaction or visual pass.

## Remaining status

The code-level caller tests support the R3 guard wiring, and the fixture supports the combined Markdown round trip on this candidate. Browser interaction is still needed before closing the R3 finding as exercised behavior. R4 scroll mapping and responsive pane behavior remain unqualified in a browser. The broader D1 ledger also retains uncovered visual, rendered-export, and media/security evidence rows.

**Round 1 remains open and the full checkpoint remains unaccepted.** Reviewer closure, integration, push, and deployment are not claimed. The communication boundary remains in force; no message was sent to Orbyn Builder.
