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

Status: focused dialog/source-view retests and the 142-test backend batch are
green. The 17-suite supplemental batch exited 1. Its six changed suites were
retaken at `b0baced5` (15 failures out of 87) and the four affected suites were
retested at `626c58ee` (8 harness failures out of 76); desktop and mobile
typechecks pass at `626c58ee`. Results and limits are recorded below. Tester
qualification remains partial; the final shared-web and Expo-web visual batch
and several redesign interaction families also remain unverified.

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
  multi-pane draft/scroll independence, Chat/Work project history and pins,
  failure/retry and response-loss import receipts, broad route/deep-link draft
  retention, team ownership/locks, and the full Settings/Admin/public surface
  matrix remain open for the appropriate automated or visual evidence.

No merge, push, deployment, or acceptance is recorded. The review counter
remains `1/3`.
