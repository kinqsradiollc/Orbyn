# C6 Markdown widget launcher Tester report — 12 October 2026

## Candidate and scope

- Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
- Branch: `codex/c6-file-viewer`
- Frozen candidate: `29f9494262bc4796b6273c8e8a5f906ecc4e88d0`
- Parent: `de83f54bc209d40bd3c17da8fc8306cfd2ca7b15`
- Review cycle: **round 2/3**, focused correction retest; this does not start a
  new full review round.
- Candidate changes three files: `host-surfaces.ts`,
  `unified-mcp.unit.test.ts`, and `plugin-service.test.ts`. The tool description
  now identifies an existing host-provided file handle and says not to invent
  one; its UI metadata declares both `model` and `app` visibility. The tests
  assert descriptor serialization, file-resource MIME/read, UI opt-out, shared
  legacy descriptor metadata, no network dereference, and a static launch
  receipt that does not echo the handle.
- Scope requested: those two suites, serially, and backend typecheck only. No
  other suite, browser/visual check, native build, scan, provider call, merge,
  push, or deployment was performed.

## Test environment

Both test suites used the local `orbyn-postgres-test-1` service at
`127.0.0.1:55434`, database `orbyn_test`. Before execution, a connection check
verified `current_database() = 'orbyn_test'` and
`current_setting('orbyn.environment', true) = 'test'`. The test runner received
`TEST_DATABASE_URL` in its child environment from the local container
configuration; credentials were not printed, and `DATABASE_URL` was removed
from the child environment before test setup.

The plugin-service test's `before` hook ran migrations. After testing, the
database remained marked `test` and contained 188 public base tables. No
database was dropped. This is the disposable test database; no production
service or data was used.

## Commands and results

Each test file ran in its own process, one after the other.

| Command | Result |
| --- | --- |
| `npm exec --workspace backend -- tsx --test --test-concurrency=1 tests/unified-mcp.unit.test.ts` | **8 passed, 0 failed, 0 skipped; exit 0.** |
| `npm exec --workspace backend -- tsx --test --test-concurrency=1 tests/plugin-service.test.ts` | **16 passed, 0 failed, 0 skipped; exit 0.** |
| `npm run typecheck -w backend` | **Passed; exit 0.** |

`unified-mcp.unit.test.ts` verified the canonical file-tool descriptor has
`ui://orbyn/markdown-file.html`, `visibility: ["model", "app"]`, and the
`.md`/`.markdown` entrypoint. Its resource read returned
`text/html;profile=mcp-app`; UI opt-out removed the file tool and resource while
leaving ordinary tools. The launch test's mocked `fetch` call count stayed zero,
the opaque input handle was absent from the structured result, and the receipt
remained `{ kind: "markdown_file" }`.

`plugin-service.test.ts` verified the legacy shared tools descriptor emits the
same file-resource URI, visibility, and entrypoint metadata. Its other 15 plugin
service lifecycle and authority assertions also passed.

## Limits and remaining evidence

These results qualify the frozen source assertions only. They do not show that a
deployed host warning disappears. The separate Builder-reported Docs
Edit → Review → Submit success used the older deployed `de83f54b`; a direct
synthetic-fixture fetch then showed version 3. That evidence predates this
candidate and does not prove the host loaded the new descriptor. Per the user's
scope instruction, no additional browser or visual check was performed.

Live managed/BYO provider readiness remains **unverified**; retain the missing
isolated QA grant, provider/model/allowance consent, and test/sandbox
configuration in the [readiness report](c6-live-provider-readiness-2026-10-12.md).
No source or test file was edited by Tester. Existing and concurrent
documentation changes in the checkout were preserved.
