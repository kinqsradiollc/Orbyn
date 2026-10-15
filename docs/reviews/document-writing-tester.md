# Document writing redesign — Tester report

Decision: [ADR 004](../adr/004-document-writing-experience.md). This is a
separate follow-up to ADR 003; prior button-size results and ADR 003 acceptance
are historical and do not qualify this writing redesign.

Baseline: `b11b142930e3790c515aa2535628db6ba39bfbce`.
Branch: `codex/docs-writing-redesign`.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Formal review counter: `0/3`.

## Candidate and scope

The implementation freeze was
`f543b104cb6e5665d313e6f4e0e20c79daf061ac`. It changes structured web writing
to a readable column with an unboxed wrapping title, inline replacement editing,
contextual block actions and direct Add text; gives structured mobile inline
editing, direct text activation and an action sheet; quiets shared format
controls; and consolidates legacy web secondary actions under More. The
structured containers, stable block IDs, save/store/permission contracts,
source/Note/PDF ownership and backend mechanisms remain in scope as preserved
contracts.

After the focused suites ran, Builder froze successor
`a0ac3ba0fb5bfef8b162419bb36c468979247a59`. Its only difference from `f543b104`
is one responsive rule in
`desktop/src/features/docs/structured-doc-editor.css`: the narrow `max-width:
640px` case now joins the existing coarse-pointer media query so fine-pointer
narrow previews also retain the full 48px action gutter. No test, TypeScript,
store, native or backend source changed. The CSS-sensitive
`button-fallback.unit.test.ts` suite was rerun on `a0ac3ba0`; its 4/4 pass and
the one-file diff establish source equivalence for the other test results.

## Focused test evidence

The first development batch passed 21/22. The format-control test failed
because its test harness did not stub the new `./doc-editor-modes.css` import.
The correction was limited to the test mock; no product workaround was made.
The retained initial log is
[`21/22 initial development batch`](/private/tmp/orbyn-doc-writing-dev.tap).
The corrected pre-freeze development batch passed 56/56; its log is
[`56/56 corrected development batch`](/private/tmp/orbyn-doc-writing-final-dev.tap).

On the frozen implementation `f543b104`, I ran the seven assigned suites plus
the existing typography/layout regression suite:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-writing-experience.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/button-fallback.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/editor-input-ownership.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/neatness.unit.test.ts
```

Result: exit 0, **66/66 passed**, 0 failed, 0 cancelled and 0 skipped
(6.50 seconds). The mode-0600 log is
[`f543b104 focused batch`](/private/tmp/orbyn-document-writing-frozen-f543b104.tap).
On the successor `a0ac3ba0`, the CSS-sensitive
`backend/tests/button-fallback.unit.test.ts` rerun passed **4/4**, 0 failed,
0 cancelled and 0 skipped. Its mode-0600 log is
[`a0ac3ba0 CSS-sensitive regression`](/private/tmp/orbyn-document-writing-button-fallback-a0ac3ba0.tap).

## Types and desktop build

Both workspace typechecks passed on the exact final source `a0ac3ba0`:
`npm run typecheck -w desktop` and `npm run typecheck -w mobile`. Their
mode-0600 logs are
[`desktop types`](/private/tmp/orbyn-document-writing-desktop-types-a0ac3ba0.log)
and
[`mobile types`](/private/tmp/orbyn-document-writing-mobile-types-a0ac3ba0.log).

`npm run build -w desktop` passed on `a0ac3ba0`. This ran the existing PDF
preview asset prebuild, TypeScript and Vite production build, and homepage
prerender. Vite emitted the existing warning about chunks over 500 kB; the
build completed. The mode-0600 log is
[`desktop production build`](/private/tmp/orbyn-document-writing-desktop-build-a0ac3ba0.log).

A desktop build started on `f543b104` while the successor freeze landed. I did
not count it as final candidate evidence; desktop and mobile types and the
desktop build were rerun against `a0ac3ba0`. No root packages/backend build or
Docker rebuild was run.

## Remaining qualification boundaries

No database/API suite, new compiler image, provider test, native build or
Security scan was run; ADR 004 excludes those checks. The final bounded visual
batch is still required for the actual writing experience across legacy and
structured Note on web and Expo web, wide and 320px layouts, both themes,
editing/context actions/comments, save recovery and source/Note/PDF transitions.
All host build writes are complete, so that visual batch can now proceed. This
report does not claim visual acceptance, Reviewer approval, integration or
delivery. Tester changed no product or test source; only this report is owned
by this session. The existing Visual-owned edit to
`docs/reviews/c6-production-visual-2026-10-11.md` was preserved.
