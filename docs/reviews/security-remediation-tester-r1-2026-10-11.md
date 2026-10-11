# C6 Tester results — round 1 correction retest — 11 October 2026

## Candidate and scope

- Frozen source: `dc094b4ba06e68e0c48ac12eb6ae4363db5f60ad` (`fix: quiesce legacy key cutover and qualify authority interleavings`), based on `78fee1926c25492ad2c1835c87672b02887f85e2`.
- Branch: `codex/c6-file-viewer`.
- Test checkout: clean detached worktree `/tmp/orbyn-c6-r1-dc094b4b`, HEAD `dc094b4ba06e68e0c48ac12eb6ae4363db5f60ad`.
- Scope: bounded same-round retest of the SR-R1 key-upgrade correction and SR-E1 live-revocation/OAuth evidence, plus the requested config and type checks. Formal review remains **round 1/3**; same-round Reviewer closure is pending.
- No product or test source was edited in the frozen test checkout.

This is focused local evidence, not full C6 acceptance. The source candidate, round history, and still-open external gates are recorded in [`c6-qualification.md`](c6-qualification.md) and the [round-1 Reviewer report](security-remediation-review-r1-2026-10-11.md).

## Environment and commands

The PostgreSQL service was `orbyn-postgres-test-1` at `127.0.0.1:55434`. Tests used only `orbyn_c6_r1_20261011_test` through `TEST_DATABASE_URL`, with `NODE_ENV=test` and no provider credentials. Before cleanup, the database reported `orbyn.environment='test'`, 226 migrations, and latest migration `266_oauth_consent_generation.sql`. The test database was dropped after the final marker/migration check; no other database was touched.

- `npm run build:packages` — exit 0.
- `DATABASE_URL=<marked disposable database> TEST_DATABASE_URL=<same database> npm run migrate -w backend` — exit 0; migration 266 applied.
- `npm run typecheck -w backend` — exit 0.
- Four focused test files ran in separate serial `tsx --test --test-concurrency=1` processes with the marked test URL: `security-secret-upgrade.test.ts`, `security-live-revocation.test.ts`, `security-deploy-cutover.test.ts`, and `oauth.test.ts`. Per-file logs are in `/tmp/orbyn-c6-r1-dc094b4b-tests/`.
- `bash -n scripts/deploy.sh` — exit 0.
- `DOC_PDF_KEY=c6-test-dummy-placeholder-not-a-real-secret-000000 PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin docker compose --env-file .env.example config --quiet` — exit 0.
- `ENV_FILE=/tmp/orbyn-c6-r1-dc094b4b-deploy.env ./scripts/deploy.sh --check` — exit 0, `Preflight: OK`; expected TODO and optional `FILES_SECRET` warnings remained. No deployment was performed.
- `node scripts/check-env-examples.mjs` — exit 0; backend/Compose variables and both client templates were covered.
- Parsed all 19 Kubernetes YAML manifests with `yaml.parseAllDocuments` — passed.

## Focused results

| File                               | Passed | Failed | Skipped |                 Exit |
| ---------------------------------- | -----: | -----: | ------: | -------------------: |
| `security-secret-upgrade.test.ts`  |      1 |      0 |       0 |                    0 |
| `security-live-revocation.test.ts` |      1 |      1 |       0 |                    1 |
| `security-deploy-cutover.test.ts`  |      2 |      0 |       0 |                    0 |
| `oauth.test.ts`                    |     33 |      0 |       0 |                    0 |
| **Total**                          | **37** |  **1** |   **0** | **one failing file** |

The live-revocation failure is `authenticated CRDT SSE closes a revoked session and retains the authorized reader`. It timed out at the assertion “both readers received the initial CRDT parcel”; the preceding “existing document stream stops releasing notifications after access revocation” test passed. The retained log is `/tmp/orbyn-c6-r1-dc094b4b-tests/security-live-revocation.log`.

The failure is consistent with a fixture error and does not establish a product-stream regression. In the frozen test, the newly created page has no seeded `doc_updates` baseline, while both SSE requests hardcode `since=1` (`backend/tests/security-live-revocation.test.ts:93`). Delivery intentionally queries `seq > since` (`backend/src/modules/docs/live.ts:176-178`). The isolated database's `doc_updates` sequence ended at 1 after the failed test, and cleanup left no rows, corroborating that the first parcel was sequence 1 and therefore excluded. The test log itself does not print that row's sequence. This leaves the real authenticated CRDT revocation scenario **unverified** on this candidate.

No valid retry ran. One attempted retry launcher exited 127 because it looked for `node_modules/.bin/tsx` from the report checkout, where that path is absent; it produced no test result (`security-live-revocation-rerun.log`). I did not rerun on the same database: its sequence had advanced to 1, so the unchanged `since=1` fixture would then send its next parcel at a higher sequence and could conceal the fresh-database defect. The first failure is retained.

The saved remediation ledger records Builder receipts of 2/2 for the corrected live-revocation test, 2/2 focused OAuth interleavings, 2/2 deploy-cutover tests, and 1/1 secret-upgrade test. Those are Builder results, not Tester results, and do not replace the failure above. A separate unstaged edit to `backend/tests/security-live-revocation.test.ts` is currently visible in the `c6-next` report checkout; it seeds a baseline row and uses its returned sequence. It is outside the frozen test checkout, was not included in this run, and was preserved without modification.

## Limits and next step

The failed CRDT stream assertion leaves SR-E1 open for a corrected frozen fixture and bounded retest; SR-R1's focused secret-upgrade and deploy-cutover tests passed, but that does not prove a real production cutover. No scan, production deployment, live OAuth/provider host, external HTTPS plugin host, native build, visual sweep, merge or push was performed. Full C6 gates remain unverified as listed in [`c6-qualification.md`](c6-qualification.md).

The Reviewer can close the passing evidence and retain SR-E1 as open within round **1/3** after inspecting this report. The source/test correction remains Builder-owned, followed by a new frozen candidate and bounded Tester retest.
