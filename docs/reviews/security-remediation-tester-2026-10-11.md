# C6 Tester results — saved-finding remediation candidate

## Candidate and scope

- Frozen source: `4da327dc05f93dc8aa4d8aa35225767e175bcf73` (`fix: remediate saved security findings and prevent unsolicited scans`), base `058a63e5ce898a874b7ad043c7d91fbbac5ea476`.
- Branch: `codex/c6-file-viewer`.
- Clean detached test checkout: `/tmp/orbyn-c6-remediation-4da327d`.
- Test role only. No product or test source was edited. The checkout was clean after the run.
- This is focused source qualification, not full C6 acceptance. Formal review remains `0/3`.

The focused scope covers the recorded OAuth consent/replay and recipient policy, admin-signup authority, API-key publication limits, provider request safety, publication privacy, private-file and live-stream revocation, team note write permission, secret rewrapping, plugin recipient/gateway controls, and the affected C6 plugin contracts.

## Environment and commands

All PostgreSQL tests used a separate disposable database, `orbyn_c6_remediation_20261011_test`, in container `orbyn-postgres-test-1` on `127.0.0.1:55434`. I verified the `_test` suffix and `orbyn.environment='test'`, then migrated the database through `266_oauth_consent_generation.sql` (226 migrations). After the suites, the marker and latest migration were rechecked and the database was dropped. The signup database `orbyn_test` and preview fixtures were not used.

- `npm run build:packages` — exit 0.
- `DATABASE_URL=<marked disposable database> TEST_DATABASE_URL=<same database> npm run migrate -w backend` — exit 0.
- `npm run typecheck -w backend` — exit 0.
- `npm run build -w backend` — exit 0.
- 29 test files ran as separate serial processes. Each used `NODE_ENV=test`, `TEST_DATABASE_URL` for the marked database, and no provider credentials. Equivalent command per file: `node node_modules/.bin/tsx --test --test-concurrency=1 tests/<file>` from `backend/`.
- Logs are under `/tmp/orbyn-c6-remediation-4da327d-tests/`.

| File                                     | Passed | Failed | Skipped | Exit |
| ---------------------------------------- | -----: | -----: | ------: | ---: |
| `security-remediation.unit.test.ts`      |      6 |      0 |       0 |    0 |
| `security-secret-upgrade.test.ts`        |      1 |      0 |       0 |    0 |
| `security-live-revocation.test.ts`       |      1 |      0 |       0 |    0 |
| `oauth.test.ts`                          |     31 |      0 |       0 |    0 |
| `auth-verification.test.ts`              |      6 |      0 |       0 |    0 |
| `api-keys.test.ts`                       |      8 |      0 |       0 |    0 |
| `publication-media.test.ts`              |     18 |      0 |       0 |    0 |
| `publication-media.unit.test.ts`         |     10 |      0 |       0 |    0 |
| `scoped-publication.test.ts`             |      8 |      0 |       0 |    0 |
| `scoped-publication.unit.test.ts`        |      5 |      0 |       0 |    0 |
| `originals.test.ts`                      |      6 |      0 |       0 |    0 |
| `rbac.test.ts`                           |      9 |      0 |       0 |    0 |
| `providers.test.ts`                      |      5 |      0 |       0 |    0 |
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

**Focused test result: 218 passed, 0 failed, 0 skipped; all 29 processes exited 0.** The total sums these separate test-file receipts; it is not a measure of complete checkpoint or unique security coverage.

Additional checks:

- `DOC_PDF_KEY=c6-test-dummy-placeholder-not-a-real-secret-000000 PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin docker compose --env-file .env.example config --quiet` — exit 0.
- `ENV_FILE=/tmp/orbyn-c6-remediation-4da327d-deploy.env ./scripts/deploy.sh --check` — exit 0, `Preflight: OK`. Expected TODO and optional `FILES_SECRET` warnings remained. The check did not deploy or call the configured host.
- `sh -n gateway/entrypoint.sh scripts/deploy.sh` — exit 0.
- Parsed all 19 Kubernetes YAML manifests with `yaml.parseAllDocuments` and parsed the security-remediation skill frontmatter — passed. An initial validator attempt used single-document `yaml.parse` and stopped at the first multi-document manifest; the corrected all-document parser accepted every manifest.

## Limits

- No Codex Security scan was run. Repository instructions prohibit scans unless the user explicitly requests one. The canceled partial scan and focused tests do not establish whole-repository security status.
- Provider tests used local fixtures; `provider-transport-fixture.ts` refuses live requests unless the test has installed a mock. No external provider credentials were supplied.
- No live OAuth host, account switch/reconnect, production-host composer/file resource, deployed gateway, native build, visual sweep or production deployment was exercised. Existing visual receipts are from earlier C6 source and retain their synthetic-host and source limits.
- This report qualifies focused local checks on `4da327dc` only. It does not claim formal Reviewer approval, full C6 acceptance, merge/push, production readiness or a clean security scan. The earlier `c6-tester-report.md` remains the historical report for `81e4c812` and is not combined with these results.
