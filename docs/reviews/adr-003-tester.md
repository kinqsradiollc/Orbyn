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

Latest round-one retest: R4–R6 passed 38/38 affected source/provider/mode/store
checks, full workspace typecheck and production build at `9b1fb984`. The later
R7 freeze `3f7cd319` passed 29/29 affected mode/redesign-control checks and
mobile typecheck. The root build is reused from `9b1fb984` because `3f7cd319`
changes no package, backend or desktop build inputs. Reviewer commit `06cc6825`
closed R4–R6 at source level; R7 review and final shared-web/Expo-web visual
findings remain pending. The final visual batch has been handed to Visual Check.
Review counter remains `1/3`.

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
pending, and review remains round `1/3`.

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
