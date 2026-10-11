# C5 Tester qualification report — 11 October 2026

**Status:** Frozen-candidate Tester evidence recorded. C5 remains in **Test**; review is **round 1/3**, with the C5-VIS-001 correction retest appended below. Reviewer closure and the bounded Visual recheck remain pending. This report does not claim C5 acceptance.

## Candidate and boundaries

- Checkout: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`
- Branch: `codex/c5-pages-publication`
- Frozen source: `046c0b85a56b82966db7f398c63c8537fbb5bea5`
- Base: `9c7c3fdb`
- Scope: maintained-page bindings and schedules, scoped human `@orbyn` comment requests/replies, structured-document preservation, scoped publication consent/revocation/privacy/media, request logging and route inventory, and existing local Slack/Teams/agent-channel contracts.
- The user explicitly deferred live Slack/Teams workspace checks. The tests below exercise local contracts and do not establish external delivery.
- Tester made no product or test-source edits. HEAD remained at the frozen commit. Shared-worktree documentation/review changes were preserved: `docs/architecture.md`, `docs/setup.md`, `docs/reviews/adr-current-state.md`, `docs/reviews/c5-progress.md`, and the untracked `docs/reviews/c5-visual-report.md`.

## Results

| Check                                                                                  | Command                                                                                          | Result                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Shared packages, backend and desktop production build                                  | `npm run build`                                                                                  | Exit 0. Vite emitted its non-blocking warning that some minified chunks exceed 500 kB. |
| Workspace typecheck                                                                    | `npm run typecheck`                                                                              | Exit 0 for packages, backend, desktop and mobile.                                      |
| Existing guarded database migration runner                                             | `DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' npm run migrate`          | Exit 0; normal runner completed on the already-current schema.                         |
| Fresh-schema migration runner                                                          | `DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_c5_fresh_test' npm run migrate` | Exit 0; full migration chain applied from an empty, marked `_test` database.           |
| C5 maintained-page, comment, publication, store/media/log/inventory and channel cohort | Focused command below                                                                            | Exit 0: **471/471 passed**, 0 failed, 0 skipped; 95,810 ms.                            |
| Structured-document/storage and docs regression cohort                                 | Focused command below                                                                            | Exit 0: **78/78 passed**, 0 failed, 0 skipped; 9,842 ms.                               |

### Database guard and migrations

Before tests, the test service returned `orbyn_test|test`; its migration table had 224 rows through `264_page_comment_requests.sql`. The test runner was given `TEST_DATABASE_URL` for this database, whose name ends in `_test` and whose server marker is `orbyn.environment='test'`. The marker and migration maximum were rechecked after testing and remained `orbyn_test|test` and migration 264.

For fresh-schema behavior, I created `orbyn_c5_fresh_test`, set its database marker to `test`, and ran the standard migration script. Both databases recorded `263_scoped_page_publications.sql` and `264_page_comment_requests.sql`. The fresh database exposed `scoped_page_publications`; migration 264's `source_comment_id`, `source_comment_revision`, and `assistant_request_id` columns were present. After verification, I dropped the fresh probe database and confirmed it was absent. The disposable `orbyn_test` service remains available and was not used by Visual Check.

Exact setup and cleanup commands; every command exited 0:

```sh
docker exec orbyn-postgres-test-1 psql -U orbyn -d postgres -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE orbyn_c5_fresh_test;"
docker exec orbyn-postgres-test-1 psql -U orbyn -d postgres -X -v ON_ERROR_STOP=1 -c "ALTER DATABASE orbyn_c5_fresh_test SET orbyn.environment TO 'test';"
DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' npm run migrate
DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_c5_fresh_test' npm run migrate
docker exec orbyn-postgres-test-1 psql -U orbyn -d orbyn_c5_fresh_test -X -v ON_ERROR_STOP=1 -Atc "SELECT current_database()||'|'||current_setting('orbyn.environment',true); SELECT count(*)||'|'||max(name) FROM migrations; SELECT to_regclass('public.scoped_page_publications')||'|'||to_regclass('public.assistant_page_bindings')||'|'||to_regclass('public.doc_comments');"
docker exec orbyn-postgres-test-1 psql -U orbyn -d postgres -X -v ON_ERROR_STOP=1 -c "DROP DATABASE orbyn_c5_fresh_test;"
docker exec orbyn-postgres-test-1 psql -U orbyn -d postgres -X -Atc "SELECT count(*) FROM pg_database WHERE datname='orbyn_c5_fresh_test';"
```

The final cleanup query returned `0`. The fresh database verification returned `orbyn_c5_fresh_test|test`, `224|264_page_comment_requests.sql`, and all three expected tables. The equivalent inspection of the existing database returned `orbyn_test|test`, `224|264_page_comment_requests.sql`, and the same tables/columns.

### Focused test commands

Run from `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn/backend`. Both commands set `DATABASE_URL` and `TEST_DATABASE_URL` to the guarded test database; test output is retained at the paths shown.

```sh
TEST_DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' ../node_modules/.bin/tsx --test --test-concurrency=1 tests/maintained-page*.test.ts tests/maintained-pages.unit.test.ts tests/page-comment*.test.ts tests/page-maintenance-store.unit.test.ts tests/doc-comment-layout.test.ts tests/scoped-publication*.test.ts tests/publication-media*.test.ts tests/publication-renderer.test.ts tests/publication-diagrams.unit.test.ts tests/file-request-log.unit.test.ts tests/route-inventory.test.ts tests/provider-runtime-inventory.unit.test.ts tests/capability-errors.test.ts tests/agent-channel*.test.ts tests/slack*.test.ts tests/teams*.test.ts > /tmp/orbyn-c5-focused-test.log 2>&1
TEST_DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' ../node_modules/.bin/tsx --test --test-concurrency=1 tests/structured.test.ts tests/doc-structured-storage.test.ts tests/docs.test.ts tests/assistant-docs.test.ts > /tmp/orbyn-c5-structured-test.log 2>&1
```

The first cohort includes all matched maintained-page, comment, publication-media, Slack, Teams and agent-channel test files, plus the named store, renderer, logging, capability and inventory tests. The second adds structured document parsing/storage and docs preservation coverage.

## Remaining evidence limits

- The full backend `npm test` suite was not run; qualification followed the C5 focused verification plan above.
- Tester did not run browser previews. Visual evidence is separately reported; the candidate-backed observations and C5-VIS-001 are in `docs/reviews/c5-visual-report.md`. Visual Check is preparing the bounded two-client reply/draft-preservation and Expo sharing recheck on its owned preview; the ready signal is pending. Tester has not written to that fixture.
- No native iOS/Android build or device interaction was run. Build/typecheck results do not qualify visual layout or native behavior.
- No live Slack/Teams workspace or provider delivery was tested, by user direction.
- C4/D1 production browser follow-ups, merge/push and production deployment remain outside this Test report and are not claimed.

No failed or skipped tests were observed in the two focused cohorts. Reviewer assessment and any remaining visual/user-owned gates are still required before C5 can be accepted.

## Round 1 retest — R1/R2 corrections on dc75c780

This is the requested retest continuation within **review round 1/3**, not a new full review. The frozen correction candidate is `dc75c780b69d01aa4baa0b9eac8317c67f62ea60` on `codex/c5-pages-publication`, in the same checkout, following baseline `046c0b85a56b82966db7f398c63c8537fbb5bea5`. The working tree had documentation/review changes only; no product or test-source edits were made by Tester.

The original **471/471** focused and **78/78** structured/docs receipts above remain scoped to `046c0b85`. Builder's development receipts (15/15, then 24/24, plus types) remain Builder evidence. Tester independently reran the workspace typecheck and affected contracts on `dc75c780`.

### Retest results

- `npm run typecheck` — exit 0 across packages, backend, desktop and mobile.
- Focused API/store/scan/worker cohort — exit 0, **88/88 passed**, 0 failed, 0 skipped, 27,211 ms. Log: `/tmp/orbyn-c5-r1-retest-dc75c780.log`.
- Post-run database guard — exit 0; `orbyn_test|test`, 224 migration rows through `264_page_comment_requests.sql`. No migration changes were made. Visual Check's separate port 55438 was not used.

Exact focused command, run from the backend directory with both database variables constrained to the marked port-55434 test database:

```sh
TEST_DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' ../node_modules/.bin/tsx --test --test-concurrency=1 tests/maintained-page-routes.test.ts tests/maintained-page-runs.test.ts tests/page-comment-requests.test.ts tests/page-maintenance-store.unit.test.ts tests/maintained-page-consumer.test.ts tests/page-comment-routes.test.ts tests/maintained-page-bindings.test.ts > /tmp/orbyn-c5-r1-retest-dc75c780.log 2>&1
```

### Finding coverage

- **C5-R1:** The API test pauses after a human edit, preserves the original snapshot, rejects an outsider (404) and a stale binding revision (409), and refuses resume with a rebind-required conflict. Run lifecycle tests pause queued, running and waiting jobs; each keeps the captured snapshot, clears staged/lease/waiting state, cannot be claimed again, and rejects stale apply/approval. The shared client-store regression verifies pause preserves the reviewed revision.
- **C5-R2:** Parent-thread resolution invalidates an attached comment request and the scanner retires it. The quota regression creates 100 one-shot requests, confirms another is rejected at the limit, resolves half and edits the other half before queueing, then runs the normal scanner path. It verifies no active withdrawn bindings or replies remain and a subsequent valid mention is accepted. The cohort also exercises the comment HTTP routes and maintained-page consumer/worker contracts.

The post-run read-only log filter initially exited 1 because of a shell-quote mismatch; a corrected filter exited 0 and confirmed the new pause, parent-resolution and 100-request quota tests were among the passing cases. This did not affect test execution or database state.

Tester has not run native, visual, live Slack/Teams, or deployment checks. The two R1/R2 findings are ready for Reviewer closure within round 1/3; this report does not itself mark the review accepted.

## Round 1 retest — C5-VIS-001 refresh correction on 7f7bc08f

This is a focused continuation of **review round 1/3**, not a new full review. Candidate `7f7bc08fbed63552354ff4186b08acd48298b72d` was rechecked at HEAD on `codex/c5-pages-publication` in this checkout. The candidate changes the shared comment/run refresh path in `@orbyn/api-client`, desktop and mobile comments and page-maintenance views, and adds the focused `doc-refresh.unit.test.ts` coverage. Tester made no product or test-source edits; only review documentation changed in the shared worktree.

### Retest results

- `npm run typecheck` — Tester rerun exited 0 for package builds and backend, desktop and mobile typechecks.
- Focused `doc-refresh.unit.test.ts` and `page-maintenance-store.unit.test.ts` cohort — exit 0, **9/9 passed**, 0 failed, 0 skipped. Log: `/tmp/orbyn-c5-r1-refresh-retest-7f7bc08f.log`.
- The guarded database marker returned `orbyn_test|test` before and after. These two unit files do not need database writes; no migrations or database changes were made.

Exact focused command, run from the backend directory with both database variables constrained to the marked port-55434 test database:

```sh
TEST_DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' ../node_modules/.bin/tsx --test --test-concurrency=1 tests/doc-refresh.unit.test.ts tests/page-maintenance-store.unit.test.ts > /tmp/orbyn-c5-r1-refresh-retest-7f7bc08f.log 2>&1
```

The cohort covers same-version remote events and explicit local invalidation without duplicate rows, an event received during a fetch, account/disposal fencing for late responses, retention of prior data with retry on refresh failure, and the maintenance store's pause/decision payload and draft-save guard. Inspection confirmed that successful `PageMaintenanceStore.decide` calls emit the shared local invalidation. The test files exercise the invalidation signal and decision path separately; they do not directly assert that cross-module call. The bounded two-client Visual recheck remains responsible for confirming that the initiating and other open clients each render exactly one posted nested reply without reopening, while preserving an unsent draft. No broader regression suite was run.

Visual Check also owns the remaining bounded cases: two saved synthetic waiting replies on the same scoped thread, posted once from each client while the other is already viewing it, draft preservation in both directions, and Expo-only selected-block snapshot/live/consent/revoke. Its preview readiness signal is still pending; no fixture database writes or live provider calls were made for this retest.

Tester has not run native, live Slack/Teams, deployment, or browser checks. Reviewer closure and Visual's bounded recheck remain pending; this evidence does not mark C5 accepted.

## Round 1 retest — run-card refresh race correction on d416d6bb

This is a focused continuation of **review round 1/3** after `7f7bc08f`. Candidate `d416d6bbcf1f6b23ebbf6cb51cb9b78562e5e858` was rechecked at HEAD on `codex/c5-pages-publication`. The correction changes only `PageMaintenanceStore` and its unit tests. Tester made no product or test-source edits.

- `npm run build -w @orbyn/api-client` — exit 0, typechecking the changed shared store package.
- Focused `doc-refresh.unit.test.ts` and `page-maintenance-store.unit.test.ts` cohort — exit 0, **11/11 passed**, 0 failed, 0 skipped. Log: `/tmp/orbyn-c5-r1-refresh-race-retest-d416d6bb.log`.
- The previous full workspace typecheck passed on `7f7bc08f`; no client signatures or desktop/mobile files changed in `d416d6bb`, so the changed package build is the targeted typecheck for this correction.
- Guard queries before and after returned `orbyn_test|test`. These unit tests made no database writes; no migrations or backend tests were run.

Exact focused command, from the backend directory with both database variables constrained to the marked port-55434 test database:

```sh
TEST_DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' DATABASE_URL='postgres://orbyn:orbyn-test@127.0.0.1:55434/orbyn_test' ../node_modules/.bin/tsx --test --test-concurrency=1 tests/doc-refresh.unit.test.ts tests/page-maintenance-store.unit.test.ts > /tmp/orbyn-c5-r1-refresh-race-retest-d416d6bb.log 2>&1
```

The two additional store cases cover a remote run update or refresh error arriving during a busy read, a follow-up read that returns current state, and disposal/account changes preventing a queued follow-up. The bounded two-client Visual recheck is still pending and must establish the actual web↔Expo reply refresh and draft behavior, plus Expo sharing selection/mode/consent/revoke. Visual Check is preparing its owned preview and is tracing a local 429 before signalling fixture readiness; no new QA fixture writes or live provider calls have been made.

Tester has not run the full backend suite, native, live Slack/Teams, deployment, or browser checks. Reviewer closure and Visual's bounded recheck remain pending; this evidence does not mark C5 accepted.

## Round 1 targeted mobile retest — structured comment integration on 82dee01b

This is a proportionate continuation of **review round 1/3** for the mobile-only structured Docs comment correction. Candidate `82dee01bd88d3a8a3fb1ccaa9cc6f168820cca98` was rechecked at HEAD on `codex/c5-pages-publication`; relative to `d416d6bb`, only `mobile/src/screens/docs/DocEditor.tsx`, `DocsSheet.tsx`, and `StructuredDocEditor.tsx` changed.

- `npm run typecheck -w @orbyn/mobile` — Tester rerun exited 0.
- No native build, backend test, browser interaction, Visual fixture mutation, or database write was performed for this mobile-only correction.

Scope inspection confirms the structured Docs sheet projects format-2 blocks for comment anchoring, the editor synchronizes projected blocks after the complete document loads, and `StructuredDocEditor` now receives the comment state/user and renders the anchored `DocThread` and per-block count. Typecheck verifies the changed mobile surface compiles; it does not establish the actual Expo comment thread behavior. Visual Check is reloading this candidate and will exercise the already-coordinated two-client fixture after the local mock provider is selected. No run is queued yet.

Tester has not run native, live Slack/Teams, deployment, or browser checks. Visual evidence and Reviewer closure remain pending; this evidence does not mark C5 accepted.

## Round 1 targeted retest — structured document-link navigation on a713bfb

This is a focused continuation of **review round 1/3**. Candidate `a713bfbdddaaa2311aaaf260cb353edc29f65938` is HEAD on `codex/c5-pages-publication`. The change adds the format-capability header to ordinary `getDoc` reads and a contract test for opening a format-2 structured page through that path. Tester made no source or test-source edits.

- `npm run build -w @orbyn/api-client` — Tester rerun exited 0.
- `../node_modules/.bin/tsx --test --test-concurrency=1 tests/doc-content-client.unit.test.ts` — Tester rerun exited 0, **10/10 passed**, 0 failed, 0 skipped.

The added case verifies that an ordinary document-link read sends `x-orbyn-doc-formats: 1,2` and accepts a format-2 response; all nine adjacent editor/content-client contract cases also passed. Builder separately reported a desktop typecheck; Tester did not rerun it. No database, browser, Visual fixture, native, or full-suite checks were run. Visual Check owns browser qualification. Reviewer closure and C5 acceptance remain pending.

## Round 1 targeted UI retest — saved reply review initial view on bbb7f28d

Candidate `bbb7f28d0eb55b27ae1d8fea4b50c717b96b9dc5` is HEAD on `codex/c5-pages-publication`. Following Visual Check's observation that comment-only pages opened **Page updates** on the **New schedule** form and hid waiting reply reviews, this correction initializes `showForm` to false in both the desktop dialog and Expo sheet. The **Add schedule** action remains visible and opens the form.

- `npm run typecheck -w @orbyn/desktop` — Tester rerun exited 0.
- `npm run typecheck -w @orbyn/mobile` — Tester rerun exited 0.
- Repository search found no component-specific test for these two UI views. No browser or Visual fixture check was run; Visual Check owns that qualification.

Tester made no product or test-source edits and performed no database, native, or full-suite checks for this correction. The actual saved-reply visibility behavior remains pending Visual's web/Expo observation; Reviewer closure and C5 acceptance remain pending.
