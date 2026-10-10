# C4/D1 Tester execution report — 45a80ca

**Disposition: HOLD.** The exact candidate passes the focused ownership suites,
workspace typecheck, invalid-source recovery checks, restore-dialog interaction,
and same-page fragment navigation. Cross-page structured-document links with a
fragment still fail on both web and Expo web, so R3 is open and this candidate
is not qualified for acceptance.

## Candidate and fixture

- Exact candidate: `45a80ca14a0de54148e804111642f38c1257aed4` on
  `codex/c4-docs-parity`.
- The source worktree was clean at the start of this execution. Tester changed
  no product or test source; this report and the delivery-record update are the
  only Tester changes.
- Tests used the disposable Docker container `orbyn-c4-postgres-test`, database
  `orbyn_test`, mapped to `127.0.0.1:55434`, with the test environment marker.
  The synthetic QA account and its two Docs were deleted, and zero matching
  user or Doc rows were verified. The API, Vite, Expo web, and test database
  services were stopped after execution. No production database or external
  account was used.

## Automated results

The focused ownership and durable offline-receipt suites passed **91/91, 0
failed, 0 skipped** (7.35 s) on the exact candidate:

```sh
node --import tsx --test --test-concurrency=1 \
  backend/tests/doc-add-to-page-format.unit.test.ts \
  backend/tests/doc-container-append.unit.test.ts \
  backend/tests/doc-container-controls.unit.test.ts \
  backend/tests/doc-content-extract.unit.test.ts \
  backend/tests/doc-content-merge.unit.test.ts \
  backend/tests/doc-content-operations.unit.test.ts \
  backend/tests/doc-editor-session.unit.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/doc-merge-format.unit.test.ts \
  backend/tests/home-reflection-format.unit.test.ts \
  backend/tests/doc-page-cache-durable.unit.test.ts \
  backend/tests/doc-offline-replay.unit.test.ts
```

`npm run typecheck` passed for core, API client, backend, desktop, and mobile.
The supplemental section-navigation suite passed **2/2** (0.93 s):

```sh
node --import tsx --test --test-concurrency=1 \
  backend/tests/doc-section-navigation.unit.test.ts
```

These suites cover invalid-source retention through title changes and an
in-flight save receipt, durable cache writes and reopen behavior, and offline
page receipts that await or reject persistence. They do not establish behavior
during a live network outage on an installed mobile device.

## Interactive results

- **R1 invalid-source recovery — pass on web and Expo web.** Duplicate block
  IDs displayed the validation error. Editing the title did not clear it, and
  Save stayed disabled. Correcting the source cleared the error; the web page
  saved successfully. On Expo web, correction auto-saved and the final state
  showed `Saved` with the corrected source.
- **History restore confirmation — pass on web.** Restore displayed the Orbyn
  modal with “Restore this version?” and the current-history explanation. The
  browser JavaScript dialog check returned `null`; Restore completed and showed
  the selected revision.
- **Same-page fragment navigation — pass on web and Expo web.** Nested links to
  duplicate heading slugs and an explicit block ID moved the preview to the
  corresponding target.
- **R3 cross-page and initial fragment navigation — fail on web and Expo web.**
  Opening a structured-document app link from a launcher page with a fragment
  returned HTTP 409 and “Update this client before opening nested document
  content.” The requested page and initial target did not open. A missing
  fragment on the current page produced the generic “Something went wrong. Try
  again.” message instead of a target-specific response.
- **Dirty-draft preservation during successful navigation — not established.**
  On web, an edited source marker remained after clicking a nested link, but the
  edit auto-saved and the target did not scroll. This interaction does not prove
  preservation of an unsaved draft during a successful navigation.

## Remaining qualification scope

The blocking R3 cross-page/initial-target behavior needs a correction and
source-exact retest. Offline persistence was checked with unit tests, not a live
outage. Per the user’s exclusions, this execution did not include a separate
desktop-app check, installed iOS or Android build, exhaustive 200% retest,
routine Visual Check, screenshot-based visual result, or keyboard and
assistive-technology audit. No merge, push, or deployment is claimed.
