# C6 unified MCP Tester correction results — `8f99272c` — 11 October 2026

## Candidate and scope

- Frozen candidate: `8f99272c66101734f0536405ad5bb68f5122e60b`, branch `codex/c6-file-viewer`, detached test checkout `/tmp/orbyn-c6-r2-8f99272c`.
- Review round: **2/3**. The expanded unified-MCP scope does not reset or replace the closed round 1/3.
- Compared with `3a7b6069f38ba77fa566eb43c89ddd88703cbb9e`, this freeze changes only `backend/tests/mcp-document-editor.unit.test.ts`. Runtime behavior is the same as `3a7b6069`.
- Scope: run all six document-editor lifecycle cases and the correction-affected unified preview, MCP directory, canonical inference/import, legacy plugin-service and import-job suites, plus backend typecheck.
- No product or test source was edited in the detached test checkout.

The initial `bc43d9d5` outcomes remain in the [round-2 baseline report](c6-unified-mcp-tester-r2-bc43d9d5-2026-10-11.md): 157/160 passed, with three failures. Those attempts are preserved and not added to this report's totals.

## Environment and commands

Database tests used a fresh disposable database, `orbyn_c6_r2_8f99272c_20261011_test`, on the existing `orbyn-postgres-test-1` service at `127.0.0.1:55434`. The database reported `orbyn.environment='test'` and 226 migrations through `266_oauth_consent_generation.sql`. After verifying no other database connections, I dropped only this database and confirmed it was absent. The detached source worktree was clean after removing its temporary dependency symlink.

Each test file ran as a separate serial `tsx --test --test-concurrency=1` process with `NODE_ENV=test` and the marked `TEST_DATABASE_URL`. Logs are in `/tmp/orbyn-c6-r2-8f99272c-tests/`.

| File                               | Passed | Failed | Skipped |                       Exit |
| ---------------------------------- | -----: | -----: | ------: | -------------------------: |
| `mcp-document-editor.unit.test.ts` |      6 |      0 |       0 |                          0 |
| `unified-mcp.unit.test.ts`         |      8 |      0 |       0 |                          0 |
| `mcp-directory.test.ts`            |     11 |      0 |       0 |                          0 |
| `plugin-inference.test.ts`         |     13 |      0 |       0 |                          0 |
| `plugin-service.test.ts`           |     16 |      0 |       0 |                          0 |
| `plugin-import-jobs.unit.test.ts`  |      4 |      0 |       0 |                          0 |
| **Total**                          | **58** |  **0** |   **0** | **all six files exited 0** |

The six editor tests execute the shipped RESULT script against a deterministic DOM stand-in. They cover keeping a dirty document visible through replacement, locking actions for immutable unknown retries, preserving/recovering drafts after conflicts, preventing a delayed save or refresh from replacing a switched document, locking controls during revision refresh, and retaining a rejected snapshot after a failed refresh. This is script-state evidence, not browser rendering evidence.

The unified-MCP suite passed the corrected script parse and cursor-expiry assertions, along with preview bounds and canonical audience/resource checks. The directory card palette assertion passed. The inference suite passed its canonical `start_import` → recipient-bound resource → cursor/replay and opposite-audience/revocation contract. The service and import-job suites passed legacy `/plugin` route boundaries, import replay/status visibility and owner/grant binding.

`npm run typecheck -w backend` — exit 0.

## Retained checks and limits

The earlier [round-2 baseline report](c6-unified-mcp-tester-r2-bc43d9d5-2026-10-11.md) records full workspace typechecking, Compose/env/shell/Kubernetes checks and both legacy/canonical deployment preflights. The final candidate adds only the document-editor test file after `3a7b6069`; configuration paths were unchanged from `bc43d9d5` through this freeze, so those configuration receipts remain source-equivalent. They are not combined with the 58/58 correction batch. Other baseline suite outcomes remain historical where the final candidate changed their runtime source.

The six editor tests use a stand-in and do not prove a rendered host card, browser layout, or ChatGPT/MCP host behavior. The [Visual Check record](c6-production-visual-2026-10-11.md) reports no local MCP Apps browser-host harness; canonical preview/edit/conflict acceptance remains a post-deployment host gate. No security scan, native build, production deployment, merge or push was performed. Reviewer same-round assessment and full C6 host acceptance remain open.
