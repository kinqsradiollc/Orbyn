# C6 unified MCP Tester results — `bc43d9d5` — 11 October 2026

## Candidate and scope

- Frozen candidate: `bc43d9d58865d0c74f3c402f61063143c279a758`, branch `codex/c6-file-viewer`, based on `e5bdc161`.
- Test checkout: clean detached worktree `/tmp/orbyn-c6-r2-bc43d9d5` at the exact candidate commit.
- Review round: **2/3**. This expanded unified-MCP scope does not reset or replace the closed round 1/3.
- Scope: focused unified-MCP, directory/protocol/tool, OAuth recipient, plugin auth/launch/provider-policy/inference/permission/import/cursor/resource checks; workspace typecheck and configuration/deploy preflight.
- No source or test changes were made in the frozen checkout.

## Environment and commands

The existing `orbyn-postgres-test-1` container was stopped when the run began. After Docker became available, I started that existing container without rebuilding it. Tests used the fresh database `orbyn_c6_r2_bc43d9d5_20261011_test` on `127.0.0.1:55434`, with `TEST_DATABASE_URL`, `NODE_ENV=test`, and `orbyn.environment='test'`. It migrated successfully through `266_oauth_consent_generation.sql` (226 migrations). I verified there were no other connections, dropped only this database, and confirmed it was absent. The existing test container was left running.

Seventeen suites ran serially as separate `tsx --test --test-concurrency=1` processes. Per-file logs are under `/tmp/orbyn-c6-r2-bc43d9d5-tests/`.

| File                                     |  Passed | Failed | Skipped |                              Exit |
| ---------------------------------------- | ------: | -----: | ------: | --------------------------------: |
| `unified-mcp.unit.test.ts`               |       5 |      2 |       0 |                                 1 |
| `mcp-directory.test.ts`                  |      10 |      1 |       0 |                                 1 |
| `mcp-protocol.test.ts`                   |      11 |      0 |       0 |                                 0 |
| `mcp-tools.test.ts`                      |      17 |      0 |       0 |                                 0 |
| `oauth.test.ts`                          |      33 |      0 |       0 |                                 0 |
| `plugin-auth.unit.test.ts`               |       5 |      0 |       0 |                                 0 |
| `plugin-launch.unit.test.ts`             |       7 |      0 |       0 |                                 0 |
| `plugin-provider-policy.unit.test.ts`    |      11 |      0 |       0 |                                 0 |
| `plugin-inference.test.ts`               |      12 |      0 |       0 |                                 0 |
| `plugin-ai-permission.test.ts`           |       1 |      0 |       0 |                                 0 |
| `plugin-ai-permission.unit.test.ts`      |       4 |      0 |       0 |                                 0 |
| `plugin-ai-permission-view.unit.test.ts` |       8 |      0 |       0 |                                 0 |
| `plugin-import-jobs.unit.test.ts`        |       4 |      0 |       0 |                                 0 |
| `plugin-job-cursor.unit.test.ts`         |       6 |      0 |       0 |                                 0 |
| `plugin-protocol.unit.test.ts`           |      11 |      0 |       0 |                                 0 |
| `plugin-tool-input.unit.test.ts`         |       5 |      0 |       0 |                                 0 |
| `plugin-ui-resources.unit.test.ts`       |       7 |      0 |       0 |                                 0 |
| **Total**                                | **157** |  **3** |   **0** | **15 files exited 0; 2 exited 1** |

`npm run typecheck` — exit 0. This built `@orbyn/core` and `@orbyn/api-client`, then typechecked backend, desktop and mobile.

Configuration checks passed:

- `DOC_PDF_KEY=c6-test-dummy-placeholder-not-a-real-secret-000000 MCP_PUBLIC_URL=https://mcp.orbyn.dev/mcp PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin docker compose --env-file .env.example config --quiet` — exit 0.
- `node scripts/check-env-examples.mjs` — exit 0; 131 backend/Compose variables and both client templates covered.
- `bash -n scripts/deploy.sh gateway/entrypoint.sh` and `git diff --check` — exit 0.
- All 19 Kubernetes YAML files parsed with `yaml.parseAllDocuments`.
- `ENV_FILE=/tmp/orbyn-c6-r2-bc43d9d5-deploy-legacy.env ./scripts/deploy.sh --check` and the equivalent canonical-AI-enabled preflight — both exit 0 with `Preflight: OK`. They showed expected example TODO and optional `FILES_SECRET` warnings. Neither preflight deployed or changed services.

## Failures

The two `unified-mcp.unit.test.ts` failures were:

- `generic resource is permission-filtered and its app script parses`: the test extracts the `ui://orbyn/result.html` script and `new Script(script)` throws `SyntaxError: Invalid or unexpected token` at test line 157. The retained log is `/tmp/orbyn-c6-r2-bc43d9d5-tests/unified-mcp.unit.log`.
- `canonical job cursor binds audience, connection and authority independently of legacy`: `pluginJobCursor(...).seal(12)` throws `This job cursor is unavailable` at test line 171. The cursor API requires a valid future `expiresAt` argument; this assertion does not provide one. This run does not qualify that new test as written. The same file's other five cases passed.

The `mcp-directory.test.ts` failure was `MCP Apps cards: off by default, then Today, a plan preview and a proposal, from palette tokens`. Its assertion rejects any `#[0-9a-f]{3,8}` token in the full HTML string; the returned resource includes bundled Mermaid runtime literals such as `#f0f8ff`. The remaining ten directory tests passed. The retained log is `/tmp/orbyn-c6-r2-bc43d9d5-tests/mcp-directory.log`.

No test retry or source correction was made on this frozen candidate. These outcomes remain specific to `bc43d9d5`.

## Limits and next step

The focused backend suites and type/config checks do not establish rendered host behavior. The existing [Visual Check report](c6-production-visual-2026-10-11.md) records that no repository MCP Apps browser-host harness was found and plans canonical `/mcp` card/edit/conflict acceptance after deployment. No rendered `/mcp` host session was performed here. Real-host canonical acceptance therefore remains open, as do the separate post-deployment gates in the implementation handoff.

No security scan, native build, production deployment, merge or push was performed. The three failures and all passing receipts are preserved for same-round review; no Reviewer approval or finding closure is claimed.
