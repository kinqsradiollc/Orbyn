# C4/D1 Tester retest — `8a449bce`

**Disposition: HOLD.** The nested-wrapper scroll correction and the current-candidate rendered export, publication, and media-security receipts passed their focused checks. Real browser interaction and visual inspection remain blocked, and other full-ledger gates remain open; round 1/3 is not closed.

## Candidate and scope

- Candidate: `8a449bce17341fbc0fb2be19d665b4d6b0e734c9`
- Branch: `codex/c4-docs-parity`
- Checkout: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`
- Scope: Reviewer R4 nested-wrapper scroll correction, source-map regression, and exact-candidate D1 export/publication/media-security evidence.
- Prior decision: [`c4-d1-review-r1-ccae5a60.md`](./c4-d1-review-r1-ccae5a60.md)
- Review round: 1/3.
- No product or test source was edited during this Tester run.

## Executed checks

`npm run typecheck` — **passed** across shared packages, backend, desktop, and mobile.

From `backend/`, ran:

```sh
npx tsx --test --test-concurrency=1 \
  tests/doc-scroll-sync.unit.test.ts \
  tests/doc-versioned-source.unit.test.ts \
  tests/diagram-export.unit.test.ts \
  tests/doc-inline-object-privacy.unit.test.ts \
  tests/export-images.unit.test.ts \
  tests/math-html.unit.test.ts \
  tests/mermaid-runtime.unit.test.ts \
  tests/doc-container-export.unit.test.ts \
  tests/export-version-client.unit.test.ts
```

Result: **67 passed, 0 failed, 0 skipped**. The new scroll test executes both synchronization handlers against quote/list wrapper geometry, selects mapped leaf paths, and checks that a synthetic reverse scroll is suppressed. The source-map suite passed 7/7. The four scoped privacy/image/math/Mermaid security suites passed **43/43**; the batch also covered diagram export (9), structured container export (6), revision-bound export client (1), and the scroll/source-map suites (8). The combined format-2 mixed Markdown fixture passed again.

The rendered API and publication suites were run with:

```sh
npx tsx --test --test-concurrency=1 \
  tests/export.test.ts tests/publication-renderer.test.ts
```

Before starting, a private preflight derived the connection from the dedicated `orbyn-c4-postgres-test` container and verified `127.0.0.1:55434`, database `orbyn_test`, and `orbyn.environment=test`. Credentials were not printed. Result: **33 passed, 0 failed, 0 skipped**.

These tests exercise actual rendered PDF and standalone HTML output for all ten Mermaid families and math, authorization and current-revision fences, refusal of changed/deleted resources during rendering, publication access changes, and authorized live publication media. The 43/43 unit suites add object-link privacy redaction, authorized image lookup, MIME/signature/size bounds, revocation, redirect rejection, Mermaid export isolation, and math safety. These are server/export and unit receipts; they do not establish the active editor's visual layout.

## Scroll finding and source equivalence

The DOM-geometry regression passed on the frozen candidate for both enclosing quote and list wrappers. Preview-to-Source selected a visible mapped leaf rather than its owner wrapper, moved Source to the leaf's source range, and suppressed the paired synthetic Source event without moving Preview back. Workspace typecheck passed.

The previously qualified R3 caller-guard files are unchanged from `ccae5a60`; this candidate's product correction is confined to the desktop editor's scroll selectors. The prior 62/62 guard qualification therefore remains source-equivalent for those callers, while the new focused batch retested this candidate's scroll, source-map, export, and security paths.

## Browser limit and remaining status

The saved browser-use Block still applies to the local preview. I did not use another port, browser, or indirect capture. Therefore real bidirectional scrolling on a long mixed-height page, responsive pane switching, invalid-Source rich-link refusal/valid save-before-navigation, and narrow rendered overflow remain **unverified**. No screenshots or visual pass are claimed.

**R4's nested-wrapper selection defect passes the focused exact-candidate geometry regression.** Its requested real-browser interaction remains pending. Exact-candidate export, publication, and media-security receipts are qualified as above. The broader C4/D1 ledger and browser-dependent gates remain open, so the overall checkpoint is **not accepted** and round 1/3 remains open. No integration, push, or deployment is claimed.
