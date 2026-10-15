# ADR 003 Tester qualification

Scope: qualification of the integrated ADR 003 redesign candidate recorded in
[`adr-003-candidate.md`](adr-003-candidate.md). This report records the checks
completed in the Tester phase; it does not establish acceptance, merge,
deployment or completion of the final visual gate.

## Candidate and status

- Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch
  `codex/c6-file-viewer`.
- Test date: 2026-10-15 (Australia/Melbourne).
- Retest HEAD: `15fc3a5a34356fa5cd55b23ec59a57077768957e`, parent
  `6b40a6eaf78da5d00b36f186005c629de273f082`.
- Product/runtime ancestry: original implementation `f7899149385f6be4189849a3678ad1b37fc64306`; test-fixture correction `7039a77bde85aaa695a0542df69a327bc43ce8c1`; TeX image/starter correction `7dfd1b9faaa875fd926d438e5455c0aa6126883a`; docs-only note `6b40a6eaf78da5d00b36f186005c629de273f082`; dialog focus correction and source-view test updates `15fc3a5a34356fa5cd55b23ec59a57077768957e`.
- Review counter: `0/3`; Reviewer has not started.
- The working tree had only the pre-existing unrelated modifications
  `docs/reviews/adr-current-state.md` and
  `docs/reviews/c6-production-visual-2026-10-11.md`. They were left untouched;
  Tester made no product or test source edits.

Status: the focused correction retests and backend suites are green. Tester
qualification remains partial because the final shared-web and Expo-web visual
batch and several redesign interaction families remain unverified below.

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
remains `0/3`.
