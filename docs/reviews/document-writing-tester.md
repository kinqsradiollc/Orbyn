# Document writing redesign — Tester report

Decision: [ADR 004](../adr/004-document-writing-experience.md). This is a
separate follow-up to ADR 003; prior button-size results and ADR 003 acceptance
are historical and do not qualify this writing redesign.

Baseline: `b11b142930e3790c515aa2535628db6ba39bfbce`.
Branch: `codex/docs-writing-redesign`.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Formal review counter: `2/3`; this receipt qualifies the round-2 source/result refinement.

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

## Round 1 P2 correction retest — retained code viewers at c58c91b8

The correction freeze is
`c58c91b8214a475a46efb24e1e7fa34eac2bebd3`, parent
`a0ac3ba0fb5bfef8b162419bb36c468979247a59`, on
`codex/docs-writing-redesign`. This remains review round 1/3.

The read-only Reviewer and Builder's source audit identified a P2: replacing a
rendered code block with its inline editor could unmount its canonical viewer
and reset PDF page/zoom. The earlier `33fd1626` Tester receipt did not reproduce
that reset in a browser; it recorded that limitation. Visual Check paused the
exclusive fixture before the correction. No browser observation is added here.

The correction keeps code renderers mounted but hidden and noninteractive while
the inline field is visible; ordinary prose still has only one visible
representation. The web `DocWritingBlock` and mobile `DocWritingBody` wrappers
are explicitly bound in their parents. The added mounted-wrapper regression
checks Edit, actual text input and Done, stable iframe identity and a single
mount, plus hidden/inert/pointer/accessibility state. This uses a test iframe
and wrapper fixture, not the live PDF engine or complete mobile parent, so it
does not prove real viewer page/zoom retention.

The assigned five suites passed on the exact correction freeze:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-writing-experience.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts
```

Result: exit 0, **51/51 passed**, 0 failed, 0 cancelled and 0 skipped
(3.82 seconds). The mode-0600 log is
[`round-1 P2 focused suites`](/private/tmp/orbyn-doc-writing-round1-p2-c58c91b8.tap).

Both workspace typechecks passed on `c58c91b8`:
`npm run typecheck -w desktop` and `npm run typecheck -w mobile`. Their
mode-0600 logs are
[`desktop types`](/private/tmp/orbyn-doc-writing-round1-p2-desktop-types-c58c91b8.log)
and
[`mobile types`](/private/tmp/orbyn-doc-writing-round1-p2-mobile-types-c58c91b8.log).
`npm run build -w desktop` passed on the same source, including PDF runtime
asset generation, TypeScript, Vite and homepage prerender. Vite emitted its
existing warning for chunks over 500 kB; the build completed. Its mode-0600 log
is [`desktop build`](/private/tmp/orbyn-doc-writing-round1-p2-desktop-build-c58c91b8.log).

No database/API suite, new compiler image, native build, provider test,
Security scan, Docker build or browser interaction was run. The actual viewer
page/zoom retention check remains a visual gate; the fixture remains with its
Visual owner. All host build writes for this correction are complete, so the
final visual batch can resume. Tester made no product or test-source edits;
the formal review counter remains 1/3.

## Round 1 narrow writing correction qualification — d44c4cdf

The latest product freeze is
`d44c4cdfbd47dadb0d0fd15e287af82c0d4ebb9c`, parent
`745ab1531bf8e4acef7534fdd277910391bd6c03`, on
`codex/docs-writing-redesign`. The later `55a19f46` descendant changes only
`docs/reviews/document-writing-redesign.md`; product and test sources remain
equivalent to the freeze. The review counter stays at 1/3.

This correction makes mobile structured titles wrap using the existing
multiline pattern and bounds its Note column to 760px; returns web Finish
editing focus to the owning block; keeps legacy Page info reachable while
Viewing remains read-only; and groups narrow web header controls more compactly.

The affected test batch included writing, store recovery, source/format/input
ownership, typography/layout and button fallback:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-writing-experience.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/editor-input-ownership.unit.test.ts \
  backend/tests/neatness.unit.test.ts \
  backend/tests/button-fallback.unit.test.ts
```

Result: exit 0, **69/69 passed**, 0 failed, 0 cancelled and 0 skipped
(6.57 seconds). The mode-0600 log is
[`d44c4cdf focused batch`](/private/tmp/orbyn-doc-writing-narrow-correction-d44c4cdf.tap).

`npm run typecheck -w desktop` and `npm run typecheck -w mobile` both passed on
`d44c4cdf`; their mode-0600 logs are
[`desktop types`](/private/tmp/orbyn-doc-writing-narrow-desktop-types-d44c4cdf.log)
and
[`mobile types`](/private/tmp/orbyn-doc-writing-narrow-mobile-types-d44c4cdf.log).
`npm run build -w desktop` passed on the same source, including PDF runtime
asset generation, TypeScript, Vite and homepage prerender. Vite emitted the
existing warning for chunks larger than 500 kB; the build completed. The
mode-0600 log is
[`desktop build`](/private/tmp/orbyn-doc-writing-narrow-desktop-build-d44c4cdf.log).

No browser interaction, API/database suite, compiler image, Docker/native build,
provider test or Security scan was run. The final browser confirmation of
mobile title wrapping, Finish focus, Viewing Page info and compact header
layout remains with the Visual owner. The exclusive fixture was not accessed.
All host build writes are complete; the visual batch can resume against this
freeze. Tester changed no product or test source and changed only this report.
The unrelated Visual-owned `c6-production-visual-2026-10-11.md` edit remains
untouched.

## Round 2 paired source and live result qualification — 09d17c2c

The product freeze is
`09d17c2c12c8c1d5707414de7d4944ffbd0adedd`, parent
`1b19373b6b96ff56f27e43a7362f4c502d1d0dfa`, on
`codex/docs-writing-redesign`. The branch later advanced to `bf76762c`; that
descendant changes only ADR 004 and the document-redesign ledger, so product and
test sources remain equivalent to `09d17c2c`. The user refinement is in review
round 2/3.

In wide desktop split editing, the source occupies the left column and the
common Note/live result stays on the right. Direct code editing keeps that
result visible and interactive beside the editor; the paired grid stacks at
narrow widths. Mobile keeps the same code result beside its editor when the
effective pane width is at least 700px, with a stacked phone layout and a Note
column capped at 760px. Ordinary prose still uses replacement editing.

The assigned Builder development run passed 6/6 in
[`paired-source development tests`](/private/tmp/orbyn-doc-paired-dev.tap).
I ran the focused writing, PDF, source, store, format, input-ownership and
typography/layout suites on the freeze:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-writing-experience.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/editor-input-ownership.unit.test.ts \
  backend/tests/neatness.unit.test.ts
```

Result: exit 0, **66/66 passed**, 0 failed, 0 cancelled and 0 skipped
(5.02 seconds). The mode-0600 log is
[`09d17c2c focused suites`](/private/tmp/orbyn-doc-paired-source-result-09d17c2c.tap).

`npm run typecheck -w desktop` and `npm run typecheck -w mobile` both passed on
`09d17c2c`; their mode-0600 logs are
[`desktop types`](/private/tmp/orbyn-doc-paired-source-desktop-types-09d17c2c.log)
and
[`mobile types`](/private/tmp/orbyn-doc-paired-source-mobile-types-09d17c2c.log).
`npm run build -w desktop` also passed on the same product source, including
PDF runtime asset generation, TypeScript, Vite and homepage prerender. Vite
emitted the existing warning for chunks larger than 500 kB; the build
completed. Its mode-0600 log is
[`desktop production build`](/private/tmp/orbyn-doc-paired-source-desktop-build-09d17c2c.log).

No API/database suite, native build, provider test or Security scan was run.
The unit iframe confirms mounted, visible wrapper behavior but is not the live
PDF renderer or a rendered layout check; actual wide/narrow pairing and page/
zoom behavior remain with the paused Visual batch. All host build writes are
complete, so that batch can resume with its owner. Tester changed no product
or test source and changed only this report. The unrelated Visual-owned C6
review edit remains untouched; review round 2/3 is still open.

## Round 2 paired PDF focus qualification — 6673f912

The product correction freeze is
`6673f9129699081b42fdc9b47badf65afd3c93c7`, parent
`dbe95cbe6ec219ccbe1268f0f28507ee57e00f2b`, on
`codex/docs-writing-redesign`. The later `5dea0a41` descendant changes only
`docs/reviews/document-writing-redesign.md`; product and test sources remain
equivalent to the freeze. This continues round 2/3.

The Visual DW-V5 report found that PDF Next/Zoom could blur code editing with a
null `relatedTarget` and close the paired source view. The correction keeps
paired code editing open until explicit Done or Escape, while ordinary prose
blur behavior stays unchanged. The development `doc-writing-experience` batch
passed 6/6; its mode-0600 log is
[`paired focus development tests`](/private/tmp/orbyn-doc-paired-focus-dev.tap).

I ran the six writing tests plus the input-ownership suite on `6673f912`:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-writing-experience.unit.test.ts \
  backend/tests/editor-input-ownership.unit.test.ts
```

Result: exit 0, **9/9 passed**, 0 failed, 0 cancelled and 0 skipped
(1.79 seconds). The focus regression dispatches a `focusout` with null
`relatedTarget` from the code editor and asserts it does not call Done. The
mode-0600 log is
[`6673f912 writing and ownership tests`](/private/tmp/orbyn-doc-paired-focus-6673f912.tap).

`npm run typecheck -w desktop` passed on `6673f912`; its mode-0600 log is
[`desktop types`](/private/tmp/orbyn-doc-paired-focus-desktop-types-6673f912.log).
`npm run build -w desktop` passed on the same source, including PDF runtime
asset generation, TypeScript, Vite and homepage prerender. Vite emitted the
existing warning for chunks larger than 500 kB; the build completed. Its
mode-0600 log is
[`desktop build`](/private/tmp/orbyn-doc-paired-focus-desktop-build-6673f912.log).

The mobile typecheck from `09d17c2c` remains applicable: `dbe95cbe` changed
only the Tester report, and the correction changes no mobile path. The
mode-0600 prior log is
[`mobile types`](/private/tmp/orbyn-doc-paired-source-mobile-types-09d17c2c.log).

No browser interaction, API/database suite, native build, provider test or
Security scan was run. The null-target focus behavior is covered by the
mounted-wrapper regression, not an actual PDF viewer interaction; visual
verification of PDF Next/Zoom while the code editor and source pair remain open
is still required. All host build writes are complete and the paused Visual
batch can resume with its owner. Tester changed no product or test source and
changed only this report; the unrelated C6 and Visual-owned uncommitted edits
were preserved. Round 2/3 remains open.

## Round 2 format ownership qualification — 8cde9352

The product correction freeze is
`8cde9352de8fa03c6625c26d4fd16e8993be79d1`, parent
`6673f9129699081b42fdc9b47badf65afd3c93c7`, on
`codex/docs-writing-redesign`. The later `cd11f5a0` descendant changes only
`docs/reviews/document-writing-redesign.md`; product and test sources remain
equivalent to the freeze. This continues the same review round 2/3.

The correction clears inline editor ownership on desktop and mobile only after
`chooseFormat` passes its existing save, account, error and dirty-draft guards.
It preserves an active source draft when saving fails. The new parent-wiring
regression verifies both structured editor bindings; the seven-test development
run passed 7/7 in
[`format-owner development tests`](/private/tmp/orbyn-doc-format-owner-dev.tap).

The focused writing, format, source, store, input-ownership and PDF suites
passed on `8cde9352`:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-writing-experience.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/editor-input-ownership.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts
```

Result: exit 0, **57/57 passed**, 0 failed, 0 cancelled and 0 skipped
(4.36 seconds). The mode-0600 log is
[`8cde9352 focused suites`](/private/tmp/orbyn-doc-format-owner-8cde9352.tap).

Both workspace typechecks passed on the exact freeze:
`npm run typecheck -w desktop` and `npm run typecheck -w mobile`. Their
mode-0600 logs are
[`desktop types`](/private/tmp/orbyn-doc-format-owner-desktop-types-8cde9352.log)
and
[`mobile types`](/private/tmp/orbyn-doc-format-owner-mobile-types-8cde9352.log).

No desktop production build was rerun. This correction changes two parent
callbacks and a regression only; it adds no asset, import or CSS change. The
desktop build at `6673f912` remains historical and is not claimed for
`8cde9352`.

No browser interaction, API/database suite, native build, provider test or
Security scan was run. The test establishes guarded format-transition wiring,
not the actual visual single-editor transition. That confirmation remains with
the Visual owner. Tester made no product or test-source edits and changed only
this report; the unrelated C6 and Visual-owned work remains untouched. Round
2/3 stays open.

## Round 2 paired mobile source height qualification — 94a56717

The product freeze is
`94a567178475fc7ec4a37bdf20fb8bc68c7d9562`, parent
`493312693443cdb16272d00f37e89367a930dbff`, on
`codex/docs-writing-redesign`. The later `3aadd5d3` descendant changes only
`docs/reviews/document-writing-redesign.md`; product and test sources remain
equivalent to the freeze. This continues review round 2/3.

For a paired mobile code editor, `DocWritingBody` now gives the multiline field
a 240px height with internal scrolling, beside its visible live result. This is
limited to code-paired editing; ordinary prose sizing remains unchanged. The
mounted React Native test mock now flattens style arrays and checks the actual
field height. Builder's seven-test development run passed 7/7; its mode-0600
log is [`paired height development tests`](/private/tmp/orbyn-doc-paired-height-dev.tap).

The `doc-writing-experience` suite passed on the exact freeze:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-writing-experience.unit.test.ts
```

Result: exit 0, **7/7 passed**, 0 failed, 0 cancelled and 0 skipped
(0.90 seconds). The paired mobile mock asserted `height: 240px`. The mode-0600
log is
[`94a56717 writing tests`](/private/tmp/orbyn-doc-paired-height-94a56717.tap).
`npm run typecheck -w mobile` passed on the same source; its mode-0600 log is
[`mobile types`](/private/tmp/orbyn-doc-paired-height-mobile-types-94a56717.log).

Desktop source is unchanged from `41fb7890`; the earlier desktop typecheck
remains applicable by source equivalence. No desktop build was rerun: this
correction changes only the mobile wrapper and its test, with no asset, import,
CSS or configuration changes. The `6673f912` desktop build remains historical,
not a build claim for this freeze.

No browser interaction, API/database suite, native build, provider test or
Security scan was run. Actual paired-input height and internal-scroll behavior
remain for the targeted Visual check. All host writes for this qualification
are complete, so that final check can resume with its owner. Tester changed no
product or test source and changed only this report; Visual and C6 uncommitted
work remains untouched. Round 2/3 remains open.
