# ADR 003 Tester qualification

Scope: qualification of the integrated ADR 003 redesign candidate recorded in
[`adr-003-candidate.md`](adr-003-candidate.md). This report records the checks
completed in the Tester phase; it does not establish acceptance, merge,
deployment or completion of the final visual gate.

## Candidate and status

- Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch
  `codex/c6-file-viewer`.
- Test date: 2026-10-15 (Australia/Melbourne).
- Initial qualification HEAD: `15fc3a5a34356fa5cd55b23ec59a57077768957e`, parent
  `6b40a6eaf78da5d00b36f186005c629de273f082`.
- The 17-suite supplemental batch below ran at docs-only HEAD
  `a0c5c7bdf4f4a7ae4d8746301deffb563fc3be57`; its product and test source is
  unchanged from `15fc3a5a`.
- The six-suite correction retest below ran at `b0baced59c393d22c4e0124a3cfdc83329d96a2f`,
  parent `a0c5c7bdf4f4a7ae4d8746301deffb563fc3be57`.
- The focused correction retest below ran at `626c58ee`, parent
  `b0baced59c393d22c4e0124a3cfdc83329d96a2f`.
- The correction batch froze product/test source at `90305ecef85284a6b4eae216dd2c993593bb29d0`,
  parent `5b10872ef3ed9ca8b103ca2c8c969ec8fe82b7f2`. Formal commands and
  mounted runtime checks ran from this assigned checkout at `87d0e8be`; the
  diff from `90305ece` contains documentation files only, so product and test
  source remained identical to the freeze.
- Product/runtime ancestry: original implementation `f7899149385f6be4189849a3678ad1b37fc64306`; test-fixture correction `7039a77bde85aaa695a0542df69a327bc43ce8c1`; TeX image/starter correction `7dfd1b9faaa875fd926d438e5455c0aa6126883a`; docs-only note `6b40a6eaf78da5d00b36f186005c629de273f082`; dialog focus correction and source-view test updates `15fc3a5a34356fa5cd55b23ec59a57077768957e`; focused source/test corrections `b0baced59c393d22c4e0124a3cfdc83329d96a2f` and `626c58ee`.
- Review counter: `1/3`; round one has been dispatched with the partial-evidence
  boundaries recorded here.
- Before the supplemental batch, only the pre-existing unrelated modifications
  `docs/reviews/adr-current-state.md` and
  `docs/reviews/c6-production-visual-2026-10-11.md` were present. After the
  batch log completed at 17:56 AEDT, a status check at 18:00 AEDT found new
  uncommitted changes in six test files and `desktop/src/features/settings/CalDavNote.tsx`.
  They were absent when that batch started and outside its evidence; they were
  subsequently frozen as `b0baced5` and retested below. Tester made no product
  or test source edits; both pre-existing review documents were left untouched.

Status before the final correction batch: focused dialog/source-view retests and
the 142-test backend batch were green. The earlier 17-suite supplemental batch
exited 1; six changed suites were retaken at `b0baced5` (15 failures out of 87),
and four affected suites were retested at `626c58ee` (8 picker-harness failures
out of 76). Those historical results remain below. At the later `90305ece`
source freeze, the scoped 12-suite regression batch, builds, types, environment
check, compiler boundary batch and finite mounted team/view/shared document
control cases all passed. Qualification remains partial: the final shared-web
and Expo-web visual batch is still pending, and the mounted document controls
did not exercise each full editor parent or API persistence.

Latest round-one retests: R4–R6 passed 38/38 affected source/provider/mode/store
checks, full workspace typecheck and production build at `9b1fb984`; R7 passed
29/29 affected mode/redesign-control checks and mobile typecheck at `3f7cd319`;
and V1 passed 2/2 Lucide menu checks, desktop typecheck and root build at
`239ce769`. Reviewer has closed the R1–R7 source findings and accepted the V1
source correction. Rendered recovery and final web/Expo evidence remain
pending with Visual Check. Review counter remains `1/3`.

## Verification

Workspace typecheck and build passed at `6b40a6eaf78da5d00b36f186005c629de273f082`,
which contains the same product source as the TeX correction commit. After the
dialog correction, `cd desktop && npm run typecheck` and `cd desktop && npm run
build` also passed at `15fc3a5a34356fa5cd55b23ec59a57077768957e`. Vite reported its
existing chunk-size warning for bundles over 500 kB; the build completed.

The four-file interaction batch at `6b40a6eaf78da5d00b36f186005c629de273f082`
(`admin-workspace-layout.unit.test.ts`, `app-dialogs.unit.test.ts`,
`chatgpt-provider-choice-ui.unit.test.ts`, and `doc-source-view.unit.test.ts`)
initially produced 44 passes and 4 failures out of 48. The dialog test found
focus returning to `document.body` instead of the original opener after queued
prompts. The three source-view failures were a native test querying a removed
preview control name and two web tests asserting old error copy rather than the
current actionable validation/recovery state. At `15fc3a5a`, the two affected
suites, `app-dialogs.unit.test.ts` and `doc-source-view.unit.test.ts`, passed
29/29 tests. The other two suites passed in the earlier corrected batch and
their source was unchanged by `15fc3a5a`.

An earlier 21-file unit batch on the original candidate exited 1 before the
`7039a77b` fixture correction. Its full output was truncated in the task log,
so complete counts are unavailable; the captured excerpts showed stale harness
imports. It is retained as a failed attempt and is not counted as passing
evidence.

The marked PostgreSQL integration batch passed 142/142 tests (0 failed, 0
skipped, 37.5 seconds) across:
`assistant-activity.test.ts`, `assistant-activity-routes.test.ts`,
`imports-flow.test.ts`, `docs.test.ts`, `doc-editing.test.ts`,
`views-info.test.ts`, `saved-views.test.ts`, `projects.test.ts`,
`team-capacity.test.ts`, `team-analytics.test.ts`, and `project-api.test.ts`.
The guarded connection resolved to database `orbyn_test` with
`orbyn.environment=test`. The test setup noted that `DATABASE_URL` matched the
test URL and confirmed that tests use `TEST_DATABASE_URL`; the integration run
exited successfully.

### Supplemental regression batch

The 17 suites omitted from the earlier truncated batch were run at
`a0c5c7bdf4f4a7ae4d8746301deffb563fc3be57` with the guarded test environment:
`agenda-summary-status.unit.test.ts`, `chatgpt-remote-ui.unit.test.ts`,
`home-companions.unit.test.ts`, `mobile-disclosure.unit.test.ts`,
`neatness.unit.test.ts`, `redesign-controls.unit.test.ts`,
`searchable-picker.unit.test.ts`, `views-workspace-layout.unit.test.ts`,
`workspace-layout.unit.test.ts`, `assistant-activity-client.unit.test.ts`,
`doc-editor-store.unit.test.ts`, `doc-content-merge.unit.test.ts`,
`doc-versioned-source.unit.test.ts`, `doc-comment-layout.test.ts`,
`views.unit.test.ts`, `saved-views.unit.test.ts`, and `imports.test.ts`.

Result: exit 1; 169 tests, 130 passed, 39 failed, 0 skipped (10.6 seconds).
The full mode-0600 output is in
[`/private/tmp/orbyn-adr003-17-remaining-a0c5c7bd.tap`](</private/tmp/orbyn-adr003-17-remaining-a0c5c7bd.tap>).
No source was changed during this batch.

Thirty failures are harness setup failures: 17 in
`chatgpt-remote-ui.unit.test.ts` stop at the unmocked
`../../components/ChoicePicker` import; 9 in `searchable-picker.unit.test.ts`
provide a non-DOM `button.current` that lacks `.matches`; and 4 in
`redesign-controls.unit.test.ts` lack `useEffect`/`useId` in the React test
shim. Those tests do not establish the corresponding UI behavior.

The other 9 failures need Reviewer classification against the intended design:

- `neatness.unit.test.ts` reports web and phone font values outside the declared
  `[11, 13, 15, 18, 24, 36]` scale (examples include 20px and 16px), a two-part
  CalDAV intro at `desktop/src/features/settings/CalDavNote.tsx:14`, and only
  four phone Settings intro matches where the assertion requires at least five.
- `redesign-controls.unit.test.ts` expects the exact unpublish phrase “The
  address stops working at once”; current copy says “The public address stops
  working. You can publish it again later.” The provider-focus assertion also
  expects a direct `useModalFocus(onCancel, busy)` call in `AdminAi`; the actual
  `ProviderForm` calls the hook through a callback closure. Both are static
  source assertions; no runtime defect was established by this batch.
- `views-workspace-layout.unit.test.ts` expects layout controls inside a
  disclosure labelled “Filter, group and sort”; current web source exposes a
  separate labelled Layout group and a “Filters and sort” control. Its mobile
  assertion also expects the web empty-state phrase “Save a filter to use
  again.” in `ViewsSheet.tsx`. These source assertions failed; rendered mobile
  behavior was not examined in this follow-up.
- `workspace-layout.unit.test.ts` expects the literal `task-filters` id. The
  current toolbar links `aria-controls` and the filter group through the same
  dynamic `filtersId`; this is a brittle literal assertion, not a confirmed
  accessibility failure.

Eleven of these 17 files had no failing subtests in this run, including
`imports.test.ts`. The additional batch did not repeat the already-green 142
database tests, compiler checks, builds, signup, or runtime exploration.

### Six-suite correction retest

Commit `b0baced59c393d22c4e0124a3cfdc83329d96a2f` changed six test files and
`desktop/src/features/settings/CalDavNote.tsx`. The six corresponding suites
were retested without rerunning the other 11 suites:
`chatgpt-remote-ui.unit.test.ts`, `neatness.unit.test.ts`,
`redesign-controls.unit.test.ts`, `searchable-picker.unit.test.ts`,
`views-workspace-layout.unit.test.ts`, and `workspace-layout.unit.test.ts`.
Command: `node --import=tsx --test --test-concurrency=1` with those six files.

Result: exit 1; 87 tests, 72 passed, 15 failed, 0 skipped (4.5 seconds). The
full mode-0600 log is
[`/private/tmp/orbyn-adr003-six-retest-b0baced5.tap`](</private/tmp/orbyn-adr003-six-retest-b0baced5.tap>).
The CalDAV and phone Settings introduction assertions, Views/workspace
structural assertions, and Views empty-state assertion from the prior batch now
pass; the two typography scale assertions remain.

Remaining failures:

- `chatgpt-remote-ui.unit.test.ts`: ended-session recovery expects the copy
  “session has ended,” while the UI says “Session ended. Reconnect to continue.”
  The saved-account picker test expects item gap `16`, while the component uses
  `8`. These are test/copy/layout assertion mismatches; runtime was not checked.
- `neatness.unit.test.ts`: desktop and mobile styles still contain font sizes
  outside the declared type scale, including 20px, 16px, 14px, and 12px values.
- `redesign-controls.unit.test.ts`: a static mobile provider assertion expects
  `editable={!busy && !removeKey}` and does not match the current source
  expression. This does not establish a runtime editing defect.
- `searchable-picker.unit.test.ts`: eight web picker tests fail because the
  VM-based test environment lacks `MutationObserver`. Two native picker tests
  fail before rendering because the mocked theme omits `radii`, so
  `radii.input` throws. These are harness failures, not evidence about picker
  runtime behavior.

The other 72 tests in the six-file batch passed. The 11 untouched suites retain
their results from the 17-suite run; the 142 backend, compiler, and build
results were not repeated.

### Focused correction retest at 626c58ee

The candidate `626c58ee` changes the three test files above and updates
type-scale values across desktop CSS and mobile screens. I reran the four
affected suites, including the style-scale suite:
`chatgpt-remote-ui.unit.test.ts`, `neatness.unit.test.ts`,
`redesign-controls.unit.test.ts`, and `searchable-picker.unit.test.ts`.
Command: `node --import=tsx --test --test-concurrency=1` with those four files.

Result: exit 1; 76 tests, 68 passed, 8 failed, 0 skipped (3.9 seconds). The
full mode-0600 log is
[`/private/tmp/orbyn-adr003-four-retest-626c58ee.tap`](</private/tmp/orbyn-adr003-four-retest-626c58ee.tap>).
All eight failures are web picker tests in `searchable-picker.unit.test.ts`;
the VM harness now stops at `HTMLFieldSetElement is not defined` before those
tests can exercise the picker. The changed native picker fixture tests pass.

The ended-session recovery and saved-account picker checks, mobile provider
guard assertion, and both desktop/mobile type-scale assertions now pass. The
desktop and mobile TypeScript checks also pass at `626c58ee` (`npm run
typecheck` in each package). The eight web picker failures leave rendered web
picker behavior unverified; no database, compiler, build, runtime, signup, or
unaffected test suites were rerun for this correction.

## Runtime evidence

The local API and browser app returned HTTP 200 at `127.0.0.1:8008` and
`127.0.0.1:8081`. The app was used with the authorized synthetic QA account;
account identifiers and credentials are intentionally omitted.

- A normal document persisted. Markdown source with inline and display math
  rendered in preview. A standalone TeX document was created and retained.
- The corrected private compiler image, built from `7dfd1b9f`, includes the
  missing T1 font package. The `latex` image
  `orbyn-u1-latex-qa:candidate-7dfd1b9` was built successfully and served by the
  isolated QA compiler on `127.0.0.1:18000`. The exact default starter with
  `\null` compiled, then the same document compiled with accented T1 prose,
  inline math, and a display integral. Both `POST /docs/:id/latex/preview`
  requests returned HTTP 200; the UI showed “Compiled LaTeX PDF” and a Download
  PDF link, and retained the saved source. This verifies PDF generation and
  delivery through the authenticated app path.
- Before the compiler correction, the T1 starter failed with missing
  `ecrm1000`. That failure is retained as prior evidence; it was resolved by
  the `cm-super-minimal` image change and non-empty `\null` starter.
- Activity filters for 30, 90, and 365 days were checked with the Melbourne
  timezone. The UI distinguished known zero activity from history before its
  coverage boundary and did not invent history.
- A synthetic task CSV previewed and imported one task. A Markdown file
  previewed and imported one page and one folder. A personal view displayed the
  imported task. Team sharing and replay-after-response-loss behavior were not
  exercised through the UI.

The embedded PDF frame's accessibility tree reported `about:blank` in the
in-app browser even though the API returned 200 and the Download PDF link was
present. I therefore treat PDF generation as verified and rendered PDF page
appearance as unverified; the final visual pass should check this explicitly.

## Remaining qualification boundaries

- The bounded final visual batch on shared web and Expo web has not been run.
  It should cover representative narrow, medium, and wide layouts, both themes,
  navigation and pane behavior, an open selector and modal, long composer
  growth, representative planner surfaces, and all three document modes.
- This Tester pass did not verify native iOS, Android, or desktop-app behavior;
  those builds remain excluded by the candidate scope.
- Runtime checks above do not cover every redesign requirement. In particular,
  rendered/browser acceptance for all editor modes and PDF appearance,
  multi-pane draft/scroll independence, Chat/Work browser rendering, broad
  route/deep-link draft retention, team ownership/permission transitions, and
  the full Settings/Admin/public surface matrix remain open for the appropriate
  visual or runtime evidence. The scoped API/unit tests for Chat/Work modes,
  import response-loss recovery, document modes and assistant acceptance pass
  at their recorded refs below; those checks do not establish rendered behavior.

## Final correction batch at 90305ece

The assigned worktree was `/Users/anhdang/.codex/worktrees/c6-next/Orbyn` on
`codex/c6-file-viewer`. Frozen source was `90305ecef85284a6b4eae216dd2c993593bb29d0`.
The commands ran at `87d0e8be815b70cc4bfca51d3cd973cc4cdc89c2`; its only
differences from the freeze are `docs/architecture.md`,
`docs/reviews/adr-003-final-visual-plan.md`, `docs/reviews/ui-ux-redesign.md`,
and `docs/setup.md`. No product or test source changed between these refs.

`npm run build` and `npm run typecheck` passed. Vite printed its existing
large-chunk warning (>500 kB); the build completed. The environment example
check, `node scripts/check-env-examples.mjs`, passed for the 132 backend/Compose
variables and both clients. Private mode-0600 logs:
[`build`](</private/tmp/orbyn-adr003-build-90305ece.log>),
[`typecheck`](</private/tmp/orbyn-adr003-typecheck-90305ece.log>), and
[`environment check`](</private/tmp/orbyn-adr003-env-check-90305ece.log>).

The 12 requested suites ran serially through `backend/tests/setup.ts` against
`orbyn_test` with `orbyn.environment=test`: the eight new files listed in the
correction handoff, `searchable-picker.unit.test.ts`, `chat-sweep.test.ts`,
`pdf-client.unit.test.ts`, and `pdf-service.unit.test.ts`. Result: exit 0,
63/63 passed, 0 failed, 0 skipped (14.35 seconds). This later candidate result
supersedes the `626c58ee` picker-harness failure for this frozen batch without
removing that earlier history. Full mode-0600 TAP output:
[`regression log`](</private/tmp/orbyn-adr003-formal-regression-90305ece.tap>).

One bounded test batch used the owned container `orbyn-u1-latex-fix`, image
`orbyn-u1-latex-qa:candidate-7dfd1b9`, and compiler service on loopback port
18000. The protected QA environment supplied the private key. The actual
read-only-root container and Bubblewrap isolation were inspected. External
read/write probes were denied; the shell/network namespace probe could not
reach the compiler service. The nonterminating TeX job returned 503 after
10,050 ms and left no private job directory. Health stayed HTTP 200; a
subsequent valid compile returned HTTP 200 with a valid 14,402-byte PDF, and no
job directory remained. The outer write canary was preserved and final canary
cleanup exited 0. Full mode-0600 output:
[`compiler boundary log`](</private/tmp/orbyn-adr003-compiler-boundaries-90305ece.log>).

Finite mounted checks used a temporary mode-0600 harness outside the checkout,
[`script`](</private/tmp/orbyn-adr003-mounted-runtime-90305.mjs>) and
[`result`](</private/tmp/orbyn-adr003-mounted-runtime-90305.log>). They passed
with the following scope:

- Actual shared `DocSuggestions` and `DocSourceAsk` controls were mounted in
  three labeled cases (normal text, Markdown source, LaTeX source). Each case
  dispatched one accept and one reject action; after a simulated assistant
  failure, the instruction remained in the textarea and a successful retry
  closed the request. Callbacks were deterministic harness stubs. The full
  editor parents, mode-specific source routing and API persistence were not
  exercised.
- Actual `TeamPlanning`, `TeamAttention` and `useSettingsRead` were mounted with
  a deterministic client. A budget save remained pending once, disabled week
  navigation, then committed once; the follow-up read failed; Retry recovered
  with three reads total and no second write.
- Actual `ViewsView` was mounted with a test `ViewTable` event harness and
  deterministic client. A confirmed row write happened once, its result refresh
  failed, and Retry read the results successfully without repeating the write
  (three reads, one write). The production table interaction and backend write
  were stubbed.

Local signup was completed at `127.0.0.1:8081` with a synthetic QA identity
after the displayed agreement was accepted. The frontend and API processes
were from this assigned worktree; the API command used the protected QA env
file, whose `DATABASE_URL` and `TEST_DATABASE_URL` both resolved to
`orbyn_test` and the test marker. The app opened the new workspace. The account
identifier and password are omitted.

## Owner-correction qualification at f19566e9

The new frozen product source is `f19566e9f85fb70be43fb4d95e4beed06022b27a`,
parent `3704ec708231f1910c0b3d2749ae8599f2ef47a6`. It changes only
`desktop/src/features/docs/DocEditor.tsx` and
`desktop/src/features/docs/doc-source.css` relative to `3704ec70`. Verification
ran at the documentation-only successor `e7f243972a3dca5e88b91a1e2fa9c042f7ab25b0`;
the only additional paths are `docs/reviews/ui-ux-redesign.md` and
`docs/setup.md`. Product and test source are identical to `f19566e9`.

An initial typecheck started at `3704ec70` and exited 0 while `f19566e9` landed;
that moving-tree result is retained but not credited. The final `npm run
typecheck` passed at `f19566e9`, including package builds and backend, desktop
and mobile types. `npm run build` passed at `e7f2439`; Vite emitted the existing
chunk-size warning for bundles over 500 kB and completed. Private mode-0600 logs:
[`final typecheck`](</private/tmp/orbyn-adr003-f19566e9-typecheck.log>),
[`initial superseded typecheck`](</private/tmp/orbyn-adr003-3704-typecheck.log>),
and [`production build`](</private/tmp/orbyn-adr003-f19566e9-build.log>).

The seven affected suites ran serially with the protected QA environment and
`backend/tests/setup.ts` against the marked `_test` database:
`doc-source-view.unit.test.ts`, `latex-preview-store.unit.test.ts`,
`doc-latex-note.unit.test.ts`, `document-editor-modes.unit.test.ts`,
`doc-assist-formats.test.ts`, `latex-preview.test.ts`, and
`latex-renderer.unit.test.ts`. Result at `e7f2439` (product/test source exactly
`f19566e9`): exit 0, 49/49 passed, 0 failed, 0 skipped (7.21 seconds). This
covers the four editor parents' mode entry points, Note's shared PDF owner,
source state/recovery, and guarded assistant accept/reject behavior for Note,
Markdown and TeX formats. Full mode-0600 TAP output:
[`affected suites`](</private/tmp/orbyn-adr003-f19566e9-affected-tests.tap>).

The 63/63 regression result at `90305ece` and actual compiler-container
isolation batch remain evidence for their unchanged scope only; neither is
re-labeled as a test at `f19566e9`. The compiler image and sandbox runtime did
not change. The new `latex-preview.test.ts` and `latex-renderer.unit.test.ts`
passed at the updated document/API source. No source or test files were edited
by Tester.

At the `f19566e9` report cutoff, Reviewer report `986af96c` still had R4–R6
open: common Note-renderer continuity, structured-editor mode/departure behavior,
and ownership for multiple standalone TeX previews. Visual dispatch was held
pending those source findings. Builder later froze the R4–R6 corrections at
`9b1fb984`, and Reviewer commit `06cc6825` closed those findings at source level;
the subsequent R7 retest and visual handoff status are recorded below.

Fixture readiness at handoff review: API `127.0.0.1:8008`, shared web
`127.0.0.1:5174`, and Expo web `127.0.0.1:8083` each returned HTTP 200. Their
listener working directories are the assigned checkout's `backend`, `desktop`,
and `mobile` folders. The protected visual handoff file exists with mode 0600
at `/private/tmp/orbyn-u1-final-visual-handoff.txt`; its contents and credential
values are omitted. These checks establish a ready fixture only, not visual
acceptance.

At the `f19566e9` retest cutoff, the worktree had advanced to docs-only Reviewer
commit `986af96c`; the then-current working tree also held new Builder-owned
changes to `backend/tests/doc-latex-note.unit.test.ts`, the desktop document
editor, source preview, structured editor and CSS, and the mobile document
editor, source preview and structured editor. These paths were outside the
`f19566e9` freeze, were not staged or edited by Tester, and are not covered by
the results above. Their later frozen correction batches are recorded below.

No merge, push, deployment, or acceptance is recorded. The review counter
remains `1/3`.

## Round-one R4–R7 correction retest at 9b1fb984 and 3f7cd319

The R4–R6 source freeze was
`9b1fb9844aa09c486bfe93a90609990257889e8b`, parent
`01fee5650aca23879aa41380e3b9910608b930af`, on
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`.
The exact scoped command was:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/latex-preview-store.unit.test.ts
```

Result: exit 0, **38/38 passed**, 0 failed, 0 cancelled and 0 skipped (2.88 s).
The full mode-0600 TAP log is
[`R4–R6 affected suites`](/private/tmp/orbyn-adr003-r4-r6-tester-9b1fb984.tap).
`npm run typecheck` passed at this exact freeze, including package builds and
backend, desktop and mobile TypeScript checks; its mode-0600 log is
[`workspace typecheck`](/private/tmp/orbyn-adr003-r4-r6-typecheck-9b1fb984.log).
`npm run build` also passed at this freeze; Vite emitted its existing warning
for chunks over 500 kB and completed. The root production build covers packages,
backend and desktop. Its mode-0600 log is
[`production build`](/private/tmp/orbyn-adr003-r4-r6-build-9b1fb984.log).
These results qualify the R4–R6 scope at `9b1fb984`; they are not relabeled as
R7 evidence.

R7 was frozen at
`3f7cd319d7a23842d5c78f14159daf17fdaf5667`, parent
`06cc68257ffe2686eb8df07a79cefff97c08fb82`. The intervening reviewer commit
`06cc6825` closed R4–R6 at source level. Relative to `9b1fb984`, the product
and test changes are confined to
`mobile/src/screens/docs/DocEditor.tsx` and
`backend/tests/document-editor-modes.unit.test.ts`; review-document updates do
not affect build inputs. The focused command was:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/redesign-controls.unit.test.ts
```

Result: exit 0, **29/29 passed**, 0 failed, 0 cancelled and 0 skipped (1.20 s).
The full mode-0600 TAP log is
[`R7 affected suites`](/private/tmp/orbyn-adr003-r7-tester-3f7cd319.tap).
`npm run typecheck -w mobile` passed at `3f7cd319`; its mode-0600 log is
[`mobile typecheck`](/private/tmp/orbyn-adr003-r7-mobile-typecheck-3f7cd319.log).
The successful root build at `9b1fb984` remains applicable to `3f7cd319` because
the newer candidate changes no package, backend or desktop build inputs; the
mobile source change is covered by the exact-candidate mobile typecheck. No
second root build or full workspace typecheck was run at `3f7cd319`.

The 38- and 29-test batches are finite component/source/store/mode checks. They
do not verify all four actual editor-parent transitions, PDF page/zoom
preservation, measured Expo pane behavior in the running UI, or whole-candidate
rendered acceptance. R7 still awaits Reviewer assessment. Visual Check now owns
the final batch defined in
[`adr-003-final-visual-plan.md`](adr-003-final-visual-plan.md); its findings are
pending. Reviewer later closed R7 source at `8b98d878`; review remains round
`1/3`.

Before visual handoff, the API health endpoint returned HTTP 200, the shared web
preview `/app` returned HTTP 200, and Expo web `/` returned HTTP 200. Listener
working directories were respectively the assigned worktree's `backend`,
`desktop` and `mobile` folders. The protected credential handoff file exists
with mode 0600 at `/private/tmp/orbyn-u1-final-visual-handoff.txt`; no
credentials are included in this report. These observations establish fixture
readiness only, not visual acceptance.

After Tester report commit `011e2b5d`, Tester sent Orbyn Visual Check the
protected credential-file path and verified endpoints under the user's existing
authorization. Visual Check owns the fixture for the final `3f7cd319` batch and
will record outcomes in `docs/reviews/adr-003-final-visual.md`. No visual
findings or visual acceptance are claimed here.

## Visual V1 block-menu correction qualification at 239ce769

The new frozen candidate was
`239ce76918258f33c28fda5d7e6d1cf31316591d`, parent
`77b679bc503f18fcc15c053fa7cbb875bb8381bc`, on
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`.
The product correction is confined to
`desktop/src/features/docs/DocBlockMenu.tsx`; its new test is
`backend/tests/doc-block-menu.unit.test.ts`. The test renders both `SlashMenu`
and `DocBlockMenu` with the real Lucide package and checks all supported block
labels and SVG icons.

The formal test command was:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-block-menu.unit.test.ts
```

Result: exit 0, **2/2 passed**, 0 failed, 0 cancelled and 0 skipped (0.53 s).
The full mode-0600 TAP log is
[`block-menu suite`](/private/tmp/orbyn-adr003-block-menu-tester-239ce769.tap).
`npm run typecheck -w desktop` passed at the exact candidate; its mode-0600 log
is [`desktop typecheck`](/private/tmp/orbyn-adr003-block-menu-desktop-typecheck-239ce769.log).
The root `npm run build` also passed at `239ce769`; the existing Vite warning
for chunks over 500 kB appeared and the build completed. Its mode-0600 log is
[`root build`](/private/tmp/orbyn-adr003-block-menu-build-239ce769.log).

The earlier Visual V1 pre-fix menu failure remains a separate historical
receipt; this 2/2 result qualifies the correction at `239ce769` and does not
erase that failure. No database or QA fixture was accessed or mutated by Tester.
Visual Check retains ownership of the Expo fixture and rendered/mobile
verification. The prior 38/38, 29/29, 49/49 and 63/63 receipts remain scoped to
their recorded commits; they are not relabeled as tests at `239ce769`. Tester
made no source or test edits.

Reviewer report `adr-003-reviewer.md` accepts the `239ce769` source correction
and keeps the browser recovery case plus final web/Expo batch pending. Its
current decision remains evidence pending within round `1/3`; these formal
checks close only the requested test/type/build portion.

## V2–V7 Tester qualification at e942a1a0

The V2 viewer-lifetime correction froze product and test source at
`e942a1a08b4ec70da324124ec0659c96dd6b7368`, parent
`2033001cbe38623d8d8637a7a3b70dfc6b6b01be`, on the same checkout and branch
recorded above. The checks below ran at `a78d5b6b31ba8c18b6d73ef0bf134645792e0ac0`;
the only intervening change from `e942a1a0` is the review document
`docs/reviews/adr-003-v2-v7-review.md`. A scoped diff check confirmed backend,
test, desktop, packages and mobile source are identical to the freeze.

At the freeze, desktop now renders the PDF viewer from the owned `preview.pdf`
while its replacement download URL is pending. This retains the mounted iframe
on a same-block recompile; canonical owner, account and document changes still
reset it. The expanded provider regression changes the saved source, recompiles,
and checks the same iframe node in web and mobile providers.

The affected provider suite passed at the current source:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-latex-note.unit.test.ts
```

Result: exit 0, **2/2 passed**, 0 failed, 0 cancelled and 0 skipped (1.05 s).
The tests cover both providers, same-block viewer identity after successful
recompilation, canonical-owner replacement and cleanup. The mode-0600 TAP log
is [`viewer lifetime tests`](/private/tmp/orbyn-adr003-doc-latex-note-e942a1a0.tap).
This is mounted provider evidence; page 2/zoom preservation in a running browser
remains part of the final Visual Check.

`npm run typecheck -w @orbyn/desktop` passed at this source; its mode-0600 log
is [`desktop typecheck`](/private/tmp/orbyn-adr003-desktop-typecheck-e942a1a0.log).
The root `npm run build` passed at the same source, building packages, backend
and desktop and generating the bundled PDF preview runtime. Vite emitted the
existing warning for chunks larger than 500 kB; the build completed. Its
mode-0600 log is [`root build`](/private/tmp/orbyn-adr003-root-build-e942a1a0.log).
The 6044 full-workspace typecheck still supplies the mobile source check because
e942 changes desktop source and a backend test only; no mobile source changed.

The corrected booking-default assertion was also rerun with the guarded test
container. The wrapper resolved the connection from `orbyn-postgres-test-1`,
verified database `orbyn_test` and marker `orbyn.environment=test`, then ran the
suite with `TEST_DATABASE_URL` and `DATABASE_URL` pointed at that URL and SMTP
disabled. Result: exit 0, **6/6 passed**, 0 failed, 0 cancelled and 0 skipped
(2.91 s). The mode-0600 TAP log is
[`booking correction retest`](/private/tmp/orbyn-adr003-booking-retest-a78d5b6b.tap).
This closes the earlier stale test expectation at `6044fddf` (5/6, expected the
old green default instead of V6's shared accent); that failed receipt remains
preserved at
[`initial booking run`](/private/tmp/orbyn-adr003-v2-v7-booking-api-6044fddf.tap).
The test-only correction at `2033001c` had already passed 6/6 and is retained at
[`booking correction at 2033001c`](/private/tmp/orbyn-adr003-v2-v7-booking-api-retest-2033001c.tap).

The earlier 6044 qualification receipts remain scoped to their recorded source:
package build, 70/70 focused unit checks, the 132-variable environment example
check, full workspace typecheck, root build, and desktop Docker build all
passed. The Docker image was built from `6044fddf`; it is pipeline evidence for
the existing bundle-generation path, **not** an image containing the e942 TSX
fix. Command:

```sh
docker build -f desktop/Dockerfile --tag orbyn-web:adr003-6044fddf-tester \
  --build-arg GIT_SHA=6044fddf .
```

No Docker build was repeated at e942. Its log remains
[`6044 desktop Docker build`](/private/tmp/orbyn-adr003-v2-v7-desktop-docker-build-6044fddf.log).
No broad integration batch, native build or Security scan was run for this
correction.

The review counter remains `1/3`. Scoped Reviewer closed the V2 source finding
at `e942a1a0` and found no additional V3–V7 source defect. This report verifies
the affected provider test, desktop typecheck/root build and booking correction;
it does not establish whole-ADR acceptance. Final shared-web and Expo-web
rendered behavior remains with Visual Check, especially PDF page/zoom retention,
compact layouts and the previously assigned V2–V7 cases.

### QA fixture handoff boundary

Parent reports that a separate registered synthetic fixture was created after
the guarded DB check and that visible Expo-web sign-in succeeded. The protected
file path is `/private/tmp/orbyn-ui-final-login.json`; the parent reports mode
0600 and no personal account changes. Tester did not independently verify that
account or use its credentials in this turn.

Tester also prepared `/private/tmp/orbyn-adr003-login-e942a1a0.json` with mode
0600 while preparing a clean signup tab, but stopped before submitting that
signup. It contains synthetic credentials only and **does not correspond to a
registered account**; do not use it for sign-in. No token was stored. A separate
Chrome tab was signed out of the pre-existing synthetic `Orbyn QA Tester`
session to reach the signup form; no account data was changed, and the other
in-app browser session was left signed in. The requested tab 7 was not present
in the Tester browser inventory; parent later took over visible Expo sign-in.
The local preview endpoints returned HTTP 200 at handback: shared web
`http://127.0.0.1:5174/`, Expo web
`http://127.0.0.1:8083/`, and API health `http://127.0.0.1:8008/health`.
These are reachability observations only; Tester performed no visual acceptance
check.

## V8 mobile correction qualification at 374258c5

The mobile-width correction froze at
`374258c5f459b87c42167aed61f081152d007d26`, parent
`2c0b8d00aeb4768f2a4fcc00092bcf653cd37049`, on `codex/c6-file-viewer`. The
requested checks ran at that exact HEAD. Relative to `e942a1a0`, the product
source changes are confined to mobile; desktop, backend implementation and
workspace packages are unchanged. The two changed test files add V8 regression
assertions.

The finite affected batch passed:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/visual-corrections.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts
```

Result: exit 0, **37/37 passed**, 0 failed, 0 cancelled and 0 skipped (2.61 s).
The tests cover the requested doc-source-view (29), visual-corrections (4) and
document-editor-modes (4) suites. The mode-0600 TAP log is
[`V8 mobile regression batch`](/private/tmp/orbyn-adr003-v8-mobile-unit-374258c5.tap).

`npm run typecheck -w mobile` passed at the same exact candidate. Its mode-0600
log is [`V8 mobile typecheck`](/private/tmp/orbyn-adr003-v8-mobile-typecheck-374258c5.log).

The desktop Docker image was rebuilt from the `374258c5` checkout to qualify
the same desktop source as e942's viewer-lifetime fix:

```sh
docker build -f desktop/Dockerfile \
  --tag orbyn-web:adr003-374258c5-tester \
  --build-arg GIT_SHA=374258c5 .
```

The build passed and `docker image inspect` confirmed tag
`orbyn-web:adr003-374258c5-tester`, image ID
`sha256:aef901a438250884ef08815a4540f667a3f2c59b6495a69d6aff2294affddb76`.
The Docker build generated the bundled PDF preview runtime and reported the
existing Vite warning for chunks larger than 500 kB. This closes the desktop
image provenance gap from the earlier `6044fddf` build. The image contains the
desktop e942 fix; the Dockerfile does not package the V8 mobile source. No
container run was performed. The mode-0600 build log is
[`V8 desktop Docker build`](/private/tmp/orbyn-adr003-v8-desktop-docker-build-374258c5.log).

No additional suites, root build, browser interaction, fixture or database work,
native build or Security scan was run. The actual Expo and shared-web visual
cases remain owned by the parent and Visual Check; this Tester receipt verifies
only the requested unit suites, mobile typecheck and desktop Docker build. The
review counter remains `1/3`; Tester made no product or test-source edits.

## V9 structured LaTeX ownership qualification at 43923346

The V9 correction froze at
`439233468f61bf11cdb9d539f42820cb21d7995d`, parent
`8f1f8c1f711dfcd958abedae83318d739543d00b`, on `codex/c6-file-viewer`. The
requested checks ran at that exact HEAD. Source preserves an existing optional
block ID when replacing LaTeX, generates an ID only for insertions, keeps
structured save status with the parent, and uses the regular mobile palette font
for the PDF download. Web and mobile provider tests cover anchored and
unanchored replacement, same-iframe identity, and deliberate canonical-owner
reset.

The required workspace package build passed before the tests:

```sh
npm run build:packages
```

Its mode-0600 log is
[`V9 package build`](/private/tmp/orbyn-adr003-v9-build-packages-43923346.log).

The finite affected batch passed:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/visual-corrections.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts
```

Result: exit 0, **38/38 passed**, 0 failed, 0 cancelled and 0 skipped (9.09 s).
This is the requested set of 4 LaTeX provider cases, 5 visual-correction cases
and 29 source-view cases. The mode-0600 TAP log is
[`V9 affected tests`](/private/tmp/orbyn-adr003-v9-unit-43923346.tap).

The full `npm run typecheck` passed at the exact freeze, including core and
API-client package builds and backend, desktop and mobile TypeScript checks. Its
mode-0600 log is
[`V9 workspace typecheck`](/private/tmp/orbyn-adr003-v9-workspace-typecheck-43923346.log).
The root `npm run build` also passed, building packages, backend and desktop and
generating the bundled PDF preview runtime. Vite emitted the existing warning
for chunks larger than 500 kB; the build completed. Its mode-0600 log is
[`V9 root build`](/private/tmp/orbyn-adr003-v9-root-build-43923346.log).

The latest desktop Docker image was rebuilt from the `43923346` checkout:

```sh
docker build -f desktop/Dockerfile \
  --tag orbyn-web:adr003-43923346-tester \
  --build-arg GIT_SHA=43923346 .
```

The build passed and `docker image inspect` confirmed tag
`orbyn-web:adr003-43923346-tester`, image ID
`sha256:ca9f7379bd8f26b1b521718dd310331b17982416fc5944a618324115e7345e47`.
It bundles the desktop/core V9 source together with the existing e942 PDF viewer
fix. The Dockerfile does not package mobile code, and the image was not run as a
container. The mode-0600 build log is
[`V9 desktop Docker build`](/private/tmp/orbyn-adr003-v9-desktop-docker-build-43923346.log).

No API suites, browser interaction, fixture or database work, native build or
Security scan was run. The actual unanchored page/zoom recheck remains with the
parent on the final UI candidate; this Tester receipt covers only the requested
unit suites, package/workspace/root builds and desktop image. The review counter
remains `1/3`; Tester made no product or test-source edits.

## V10 Tini process-reaping qualification at a7facf6a

The V10 candidate froze at
`a7facf6a2da24e51a115d1a437fd5918c209c545`, parent
`18d85f073cba98fdfb7b1e77dc67e4a61d53d587`, on `codex/c6-file-viewer`.
The requested qualification ran at that exact HEAD. The candidate adds a Tini
entrypoint to the LaTeX Docker target and retains the wrapper in Kubernetes;
the desktop source is unchanged since the V9 `43923346` candidate, so its
existing build evidence remains applicable. The earlier `29/32` and `30/32`
development runs remain recorded in the parent visual report and are preserved
as historical failures.
Since the qualification, commits `57397a0c` and `a50f480b` have added parent
visual receipts only; no V10 source or test file changed after the freeze.

The four requested unit suites passed:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/connections-sections.unit.test.ts \
  backend/tests/settings-connection-help.unit.test.ts \
  backend/tests/interactive-agent-identity.unit.test.ts \
  backend/tests/redesign-controls.unit.test.ts
```

Result: exit 0, **32/32 passed**, 0 failed, 0 cancelled and 0 skipped (4.13 s).
`npm run typecheck -w mobile` also passed at the same freeze.

The changed LaTeX image target built successfully:

```sh
docker build -f backend/Dockerfile --target latex \
  -t orbyn-u1-latex-qa:v10-a7facf6a-tester \
  --build-arg GIT_SHA=a7facf6a .
```

Image inspection confirmed ID
`sha256:33e49d97d3d308c336a7a0450d428de14c329cb73d562fe222d860367f3bb67f`,
revision `a7facf6a`, entrypoint `[/usr/bin/tini, --]`, and command
`[node, backend/dist/services/latex.js]`. A disposable container used that image
on loopback port `18002`, with Docker `init` disabled to exercise the image's
own Tini entrypoint. It retained the existing 64-process, 1 CPU, 768 MiB memory,
128 MiB `/tmp`, read-only root filesystem, `cap_drop: ALL`,
`no-new-privileges`, and `deploy/latex/seccomp.json` settings; the container
was removed after the checks. The already-active `orbyn-u1-latex-fix` container
was left running unchanged on port `18000` with its existing Docker init.

The private service health check returned HTTP 200. Six sequential signed
valid requests (five consecutive compilations plus one after the invalid case)
each returned HTTP 200 and a valid 31,361-byte PDF. An undefined-control-sequence
source returned the expected HTTP 503; health remained HTTP 200 and the next
valid request compiled successfully. The container ran Tini as PID 1 with Node
as its child. Process counts returned to the two-process Tini/Node baseline
after every completed job and after the final 1.5-second recovery interval;
no Bubblewrap, `prlimit` or `pdflatex` process remained. The mode-0600 runtime
receipt is
[`V10 LaTeX runtime probe`](/private/tmp/orbyn-u1-v10-latex-runtime-a7facf6a.log).

This qualification used direct signed calls to the local compiler. It made no
database, account, provider or browser changes and ran no API suites, native
build or Security scan. Tester made no product or test-source edits. The review
counter remains `1/3`.

## V12–V14 Tester qualification at product freeze 509462e6

The qualified product and test-source freeze is
`509462e63e34bb9a9282678c02d04d63f2605c6b`, parent
`e911672a2b66fb334e1adce6c0ffd2fd2de649d7`, on branch
`codex/c6-file-viewer` in `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
It contains the `3a97163c` expected-revision anchor changes, the `e911672a`
route variable-shadow correction, and the `509462e6` mobile secondary-LaTeX
source contrast fix. Later commits `bce93104` and `d07ef1c6` changed review
documentation only; product and test source remained identical to `509462e6`
through the final verification. The review counter remains `1/3`.

The initial four-suite run was interrupted by the `e911672a` commit arriving
while the process was running. It passed 20/20 tests, and that commit changed
only the backend anchor route, outside those suites' source. I reran the full
batch after the final `509462e6` product/test freeze, including the new mobile
LaTeX contrast cases:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/button-fallback.unit.test.ts \
  backend/tests/doc-assist-target.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts
```

Result: exit 0, **24/24 passed**, 0 failed, 0 cancelled, 0 skipped (3.66 s).
This includes the captured saved-revision refusal, all four web/mobile canonical
LaTeX-owner cases, and the V14 noncanonical source readability assertions. The
mode-0600 TAP log is
[`V12–V14 focused unit tests`](/private/tmp/orbyn-v12-v14-unit-509462e6.tap).

The one named PostgreSQL API regression passed on the exact product source:

```sh
node --import=tsx --test --test-concurrency=1 \
  --test-name-pattern='saved-selection anchors reject a shifted identical duplicate at a newer revision' \
  backend/tests/doc-structured-storage.test.ts
```

Before launch, `TEST_DATABASE_URL` was checked to resolve to a database ending
in `_test` with `orbyn.environment='test'`; the guarded setup used that test
database only. Result: exit 0, **1/1 passed**, 0 failed, 0 cancelled and 0
skipped. The shifted duplicate at a newer revision returned 409; the unchanged
saved revision returned 200. This retest covers the intermediate V13 failure
recorded by Visual Check: request
`61ec8fb4-2773-4530-b387-c08414dff9a5` returned 500 on `3a97163c` because the
anchor handler's request `version` binding was in a temporal dead zone. The
`e911672a` correction aliases it to `expectedVersion`. The mode-0600 TAP log is
[`saved-selection API regression`](/private/tmp/orbyn-v12-v14-anchor-api-509462e6.tap).

`npm run typecheck` passed, including shared package builds and backend,
desktop, and mobile TypeScript checks. The run started on `509462e6`; the only
commit that arrived during it was the docs-only `bce93104`, so the checked
product/test source is unchanged. The mode-0600 log is
[`workspace typecheck`](/private/tmp/orbyn-v12-v14-types-509462e6.log).

`npm run build` passed for packages, backend and desktop at the same product
source. Vite emitted the existing warning about chunks over 500 kB; the build
completed and generated the PDF preview runtime and homepage. Its mode-0600 log
is [`root build`](/private/tmp/orbyn-v12-v14-root-build-509462e6.log).

The exact desktop target also built successfully:

```sh
docker build -f desktop/Dockerfile \
  --tag orbyn-web:adr003-509462e6-tester \
  --build-arg GIT_SHA=509462e6 .
```

`docker image inspect` confirmed image ID
`sha256:c65a6bdf4496becfba856180fc7ef1bbe95c6bc0660dcb79012d77b4fca4e081`.
Vite reported its existing large-chunk warning; Docker completed successfully.
The image was built from the `509462e6` product source and was not run as a
container. The mode-0600 log is
[`desktop Docker build`](/private/tmp/orbyn-v12-v14-desktop-docker-509462e6.log).

The earlier `c5ae33faa49afb8b175f2010d369aafc5317fe09` attempt remains
preserved at
[`c5 focused unit attempt`](/private/tmp/orbyn-v12-v13-tester-unit-c5ae33fa.tap):
19/20 passed and the remote duplicate-reordering case failed because it did not
receive the captured revision. That attempt was not a clean freeze run: the
regression case was added to the working tree after `c5ae33fa` froze and while
the batch ran. The later exact `509462e6` 24/24 result is the qualification
evidence for that behavior.

No broad API suite, provider test, native build, additional browser batch or
Security scan was run. This report qualifies the named source checks and desktop
build only; the remaining bounded visual evidence and Reviewer closure are
separate gates. Tester made no product or test-source edits and changed only
this report.

## V15 retained-draft retry qualification at product freeze 2bc81bd1

The final V15 product/test freeze is
`2bc81bd10156f7643cf59f2a942183ee8d8a0a1f`, parent
`0b2152384bfc19964b1432027b51bdc14591f46a`, on
`codex/c6-file-viewer` in `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
It adds explicit retry for a retained valid structured-document draft after a
save failure, preserves invalid-source and conflict guards, and clears the
recovered navigation warning. The review counter remains `1/3`.

The assigned four-suite batch passed:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/document-editor-modes.unit.test.ts \
  backend/tests/doc-assist-target.unit.test.ts \
  backend/tests/button-fallback.unit.test.ts
```

Result: exit 0, **23/23 passed**, 0 failed, 0 cancelled and 0 skipped (2.77 s).
The store cases confirm explicit retry saves a retained failed draft without a
new edit, never sends invalid source, and preserves a conflicting draft for
review. The mode-0600 TAP log is
[`V15 focused tests`](/private/tmp/orbyn-v15-unit-2bc81bd1.tap).

All requested typechecks passed at the exact freeze:

```sh
npm run typecheck -w @orbyn/api-client
npm run typecheck -w desktop
npm run typecheck -w mobile
```

The mode-0600 logs are
[`API-client types`](/private/tmp/orbyn-v15-api-client-types-2bc81bd1.log),
[`desktop types`](/private/tmp/orbyn-v15-desktop-types-2bc81bd1.log), and
[`mobile types`](/private/tmp/orbyn-v15-mobile-types-2bc81bd1.log).

`npm run build` passed at `2bc81bd1`, building core and API client, backend,
and desktop, and generating the PDF preview runtime and homepage. Vite emitted
the existing warning for chunks over 500 kB; the build completed. Its
mode-0600 log is
[`V15 root build`](/private/tmp/orbyn-v15-root-build-2bc81bd1.log).

No new Docker build was run. The
[`509462e6 desktop image`](/private/tmp/orbyn-v12-v14-desktop-docker-509462e6.log)
remains packaging evidence for the Docker target at that earlier product
source; it does not contain V15. The API anchor route is unchanged, so the
guarded anchor checks were run against the final API source. The two selected
cases passed together on `2bc81bd1`: `a viewer can name one nested leaf
atomically without changing content ownership or history` and
`saved-selection anchors reject a shifted identical duplicate at a newer
revision`. Result: exit 0, **2/2 passed**, 0 failed, 0 cancelled and 0 skipped.
The viewer's concurrent naming requests returned the same block ID without
changing content ownership or version history; its edit attempt remained
forbidden. The newer-revision selection was rejected with 409, while the
unchanged version named the passage. The test also asserted the expected
rate-limit 429 response. Before launch, the guarded test database again
resolved to `_test` with `orbyn.environment='test'`. The mode-0600 log is
[`V15 anchor compatibility tests`](/private/tmp/orbyn-v15-anchor-compat-2bc81bd1.tap).
No broader API suite was run.

No browser interaction, native build or Security scan was run. The bounded
visual recovery recheck and Reviewer closure remain separate gates. Tester made
no product or test-source edits and changed only this report.
