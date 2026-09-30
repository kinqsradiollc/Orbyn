# R1–R10 local verification evidence

Verified 30 September 2026 in `codex/r1-r10-fixes`.

## Commands and results

| Check                                                                | Result                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `TEST_DATABASE_URL=<isolated test database> npm run test -w backend` | 1,726 tests passed, zero failures, 522.5 s                         |
| Final `assistant-runs.test.ts` after conflict-message cleanup        | 41 passed, zero failures                                           |
| Receipt API shields / durable actions                                | 8 passed                                                           |
| Notice lifecycle / legacy reminder-chat migration                    | 8 passed                                                           |
| Poll / reminder local load batch                                     | 56 passed                                                          |
| `npm run typecheck`                                                  | Core/API packages built; backend, desktop and mobile passed        |
| `npm run build`                                                      | Packages, backend and desktop passed; existing large-chunk warning |
| `npm run export -w mobile`                                           | iOS and Android bundles exported                                   |
| `git diff --check`                                                   | Passed                                                             |

The complete suite includes real process-kill recovery, transaction rollback, current visibility, scheduler settings, decision identity, submission deduplication and guarded Undo checks. The suite's first run exposed seven fixture/catalog/architecture failures; those were repaired before the complete passing run. Passing fixture repairs did not weaken source-access checks.

## Local measurements

- 60 simultaneous job polls: one actual presence row revision, 369 ms locally.
- Fresh presence poll with the runner row locked: 35 ms; expired presence writes again.
- Selected reminder revalidation with 1,004 due tasks: one source SQL query, 3 ms locally.
- These numbers describe the dedicated local PostgreSQL fixture, not production latency or backlog.

## Runtime proof

- `desktop-receipt-reload.png`, `mobile-receipt-reload.png`, `native-receipt-reload.png`: persisted Undo receipt after reload.
- `mobile-send-during-restore.png`, `native-send-during-restore.png`: late restoration does not replace a newly submitted message.
- `desktop-historical-night.png`, `mobile-historical-night.png`, `native-historical-notice.png`: retained older night identity.
- `desktop-stale-bulk.png`, `native-stale-bulk.png`: changed work is rejected after confirmation opens.
- `desktop-stale-question.png`, `native-stale-question.png`, `desktop-stale-approval.png`, `native-stale-approval.png`: displayed old waiting IDs fail with 409 after transaction advancement. The next waiting card remains unconsumed. Approval rendering used an empty controlled plan; real write/scope guards are covered by backend tests.

Runtime used web preview 5174, mobile web 8083, iOS Expo Go 57.0.9 on iPhone 17 Pro / iOS 26.5, a separate disposable database, and loopback fake providers. No real provider, SMTP or OS push delivery was used. Native background/resume retained the selected historical night; native reload restored the saved reminder chat and receipt. The stale-card screenshots precede the final conflict-message wording cleanup.

## Limits

No production deployment/load result, OS push arrival, Android native interaction or installed-app universal-link launch is asserted. The in-app browser timed out on the mobile web JavaScript confirmation; desktop and native confirmation behavior were verified. Exports do not substitute for installation or device interaction. Original static findings remain preserved in `docs/reviews/archive/r1-r10-original-review-2026-09-30.md` and the review artifact.

## Git integration and post-merge checks

Repair commit `dfe91af` was fast-forward merged into local `main`. From the primary checkout, 61/61 assistant-run, receipt and Overnight regressions passed; typechecks, backend/desktop production builds and iOS/Android exports passed. The post-merge poll fixture measured one row revision for 60 simultaneous polls (447 ms) and 35 ms for a fresh poll under a held runner lock. Unrelated existing changes were preserved. No remote push or production deployment occurred.

## Authorized publication preflight

On 30 September 2026, after explicit authorization to push `main`, the full backend suite was rerun from the primary checkout: **1,726 passed, zero failures, zero skips**, in 457.2 seconds. Root typechecks, backend/desktop production builds, iOS/Android exports, changed-file Prettier checks and `git diff --check` also passed. Tests used the healthy separate PostgreSQL test container and enforced the test database name and server marker; real SMTP was disabled. Existing UI proof and its device/delivery limits remain as documented above. Unrelated local work is excluded from publication.

## Clean Docker packaging follow-up

A server build exposed a missing API-client package in the backend Docker image that prior local builds did not detect. See [Docker build repair](../../docker-build-repair-2026-09-30.md) for the fix, no-cache image builds, production import/health checks, empty-database migration and fresh-database full-suite result (1,726 passed).
