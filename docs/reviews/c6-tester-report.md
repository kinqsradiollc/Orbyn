# C6 Tester qualification — frozen 81e4c812 candidate

## Candidate and status

- Source candidate: `81e4c81262df24efe7ca2c93846e6da1cf95d0bd`; base: `058a63e5ce898a874b7ad043c7d91fbbac5ea476`.
- Source branch: `codex/c6-file-viewer`; original checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
- The original checkout was at documentation freeze `1c09ea0e070017372cb20629f54266c2c23ef643` when qualification began. Later, uncommitted remediation edits appeared in that checkout. To keep source provenance exact, the final qualification run used a separate clean detached worktree at `81e4c81262df24efe7ca2c93846e6da1cf95d0bd`: `/tmp/orbyn-c6-frozen-81e4`. That worktree remained clean after testing. The later uncommitted edits are outside this report and require their own frozen-candidate qualification.
- Phase: **Test**. Owner: Orbyn Tester. Review counter: **0/3**.
- Tester will not edit product or test source. No merge, push, deployment, or acceptance is claimed.

The source scope includes the private plugin gateway and Compose/deploy rollout, independent plugin recipient and connector authority, launch/import/reconnect flows, managed/BYO provider execution and limits, Today host UI, Markdown host file resources and guarded saves, and owner-authorized scoped title/link composer mentions. Full item contents remain outside mention results.

## Qualification plan

1. Preserve source provenance by testing only code identical to frozen source `81e4c812` in a clean detached worktree.
2. Build workspace packages, then run backend typecheck and build.
3. Run these suites as separate serial processes on the frozen source: `gateway-config.test.ts`, `plugin-ai-permission-view.unit.test.ts`, `plugin-ai-permission.test.ts`, `plugin-ai-permission.unit.test.ts`, `plugin-auth.unit.test.ts`, `plugin-compose.unit.test.ts`, `plugin-import-jobs.unit.test.ts`, `plugin-inference.test.ts`, `plugin-job-cursor.unit.test.ts`, `plugin-launch.unit.test.ts`, `plugin-principal.unit.test.ts`, `plugin-protocol.unit.test.ts`, `plugin-provider-policy.unit.test.ts`, `plugin-service.test.ts`, `plugin-tool-input.unit.test.ts`, `plugin-ui-resources.unit.test.ts`, and `oauth.test.ts`. Include the new mention route/protocol assertions. Keep each process log under `/tmp/orbyn-c6-frozen-81e4-tests/` and report each exit and assertion count without summing overlapping Builder receipts.
4. Use a new, marked disposable database `orbyn_c6_tester_20261011_test` for PostgreSQL tests, leaving the open local signup database `orbyn_test` and other preview fixtures untouched. Verify the name suffix and `orbyn.environment='test'` before and after; run provider-setting suites serially.
5. Validate Compose configuration with `DOC_PDF_KEY=c6-test-dummy-placeholder PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin docker compose --env-file .env.example config --quiet`, and run `scripts/deploy.sh --check` against a temporary copy of `.env.example` with disposable placeholder values. These checks must not deploy or call external hosts.
6. Keep external host OAuth/account switching/reconnect, real platform file read/save and mention selection, live managed/BYO vendor behavior, and current-source security qualification explicitly unverified if unavailable. Reuse prior visual receipts only with their synthetic-wrapper and older-source limits; no new visual sweep or native build is planned.

## Existing evidence provenance

Builder reports the serial `123/123` plugin/OAuth cohort on preceding source `55e94ca5`, and service `16/16`, protocol `11/11`, and backend typecheck on `81e4c812`. These are Builder receipts, not Tester results, and the overlapping counts will not be added together. The prior partial security scan ends at `88f46bb2`; it does not cover this source candidate or establish a whole-repository result.

## Tester execution

The final run used clean detached worktree `/tmp/orbyn-c6-frozen-81e4` at exact commit `81e4c81262df24efe7ca2c93846e6da1cf95d0bd`; `git status --short` was empty after the run. A preliminary run in the original checkout returned 135 passes, but that checkout had concurrent uncommitted changes and is excluded from this qualification. The exact-candidate rerun below is authoritative.

- `npm run build:packages` — exit 0.
- An initial typecheck before this setup exited 2 because `@orbyn/core` declarations had not yet been built in the clean checkout. After `npm run build:packages`, typecheck passed as recorded below.
- `npm run typecheck -w @orbyn/backend` — exit 0.
- `npm run build -w @orbyn/backend` — exit 0.
- Created `orbyn_c6_tester_20261011_test` inside the disposable `orbyn-postgres-test-1` container on port 55434. Verified the `_test` suffix and `orbyn.environment='test'`, migrated successfully through `264_page_comment_requests.sql` (224 migrations), rechecked the marker after testing, then dropped the temporary database. The C6 suite did not use the signup app's `orbyn_test` database or any Visual fixture.
- All 17 test files ran as separate serial processes with no provider credentials and local/test fixtures only. **133 passed, 0 failed, 0 skipped; all 17 processes exited 0.** Logs: `/tmp/orbyn-c6-frozen-81e4-tests/`.

| File                                     | Passed | Failed | Skipped | Exit |
| ---------------------------------------- | -----: | -----: | ------: | ---: |
| `gateway-config.test.ts`                 |      8 |      0 |       0 |    0 |
| `plugin-ai-permission-view.unit.test.ts` |      8 |      0 |       0 |    0 |
| `plugin-ai-permission.test.ts`           |      1 |      0 |       0 |    0 |
| `plugin-ai-permission.unit.test.ts`      |      4 |      0 |       0 |    0 |
| `plugin-auth.unit.test.ts`               |      4 |      0 |       0 |    0 |
| `plugin-compose.unit.test.ts`            |      1 |      0 |       0 |    0 |
| `plugin-import-jobs.unit.test.ts`        |      4 |      0 |       0 |    0 |
| `plugin-inference.test.ts`               |     11 |      0 |       0 |    0 |
| `plugin-job-cursor.unit.test.ts`         |      6 |      0 |       0 |    0 |
| `plugin-launch.unit.test.ts`             |      6 |      0 |       0 |    0 |
| `plugin-principal.unit.test.ts`          |      2 |      0 |       0 |    0 |
| `plugin-protocol.unit.test.ts`           |     11 |      0 |       0 |    0 |
| `plugin-provider-policy.unit.test.ts`    |     10 |      0 |       0 |    0 |
| `plugin-service.test.ts`                 |     16 |      0 |       0 |    0 |
| `plugin-tool-input.unit.test.ts`         |      5 |      0 |       0 |    0 |
| `plugin-ui-resources.unit.test.ts`       |      7 |      0 |       0 |    0 |
| `oauth.test.ts`                          |     29 |      0 |       0 |    0 |

- `DOC_PDF_KEY=c6-test-dummy-placeholder PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin docker compose --env-file .env.example config --quiet` — exit 0.
- The first clean-candidate `scripts/deploy.sh --check` attempt used a temporary environment missing `DOC_PDF_KEY` and exited 1. After adding disposable, non-production `SECRETS_KEY` and `DOC_PDF_KEY` placeholders, `ENV_FILE=/tmp/orbyn-c6-frozen-81e4-deploy.env ./scripts/deploy.sh --check` exited 0 with `Preflight: OK`. Expected warnings remained for sample TODO values and unset optional `FILES_SECRET`; no deployment or external call occurred.

## Unverified requirements and limits

- Real HTTPS host discovery/OAuth, account switching/reconnect/events, host composer selection and platform-supported file read/save remain unverified. Synthetic host visual receipts are delegated and source-scoped; no new visual sweep or native build was requested.
- Provider tests used local fixtures/mocks, not live managed or BYO vendors. No external provider credentials were passed to the test processes.
- No current-source security scan was run under the user's reported restriction. The prior partial diff scan does not cover this candidate; security qualification remains open.
- The authoritative Tester run is 133 tests on exact source `81e4c812`. It is not added to the Builder's earlier 123/123 receipt or the overlapping 16/16 and 11/11 follow-ups.
- This report does not qualify the later uncommitted remediation edits or any newer candidate. It does not claim full C6 acceptance, Reviewer approval, merge/push, or production deployment. Review counter remains **0/3**.
