# C6 serial Builder checks — 11 October 2026

Source: `55e94ca5` on `codex/c6-file-viewer`, managed checkout
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`. The checked HEAD was documentation
follow-up `ea9ea893`; source was unchanged. These are Builder checks, not formal
Tester or Reviewer acceptance.

**123 passed; zero failures or skips.** All 16 processes exited 0. Suites ran
serially to avoid interference through shared provider settings. Database suites
used the local `orbyn_test` fixture on port 55434 and enforced its server-side
`orbyn.environment=test` marker through `backend/tests/setup.ts`.

Command per file: `npx tsx --test backend/tests/<file>` with
`TEST_DATABASE_URL` pointing to that marked fixture. Logs and the machine summary
are retained under `/tmp/orbyn-c6-55e94ca5-checks/`; no credentials are included here.

| File | Passed | Exit |
| --- | ---: | ---: |
| `plugin-ai-permission-view.unit.test.ts` | 8 | 0 |
| `plugin-ai-permission.test.ts` | 1 | 0 |
| `plugin-ai-permission.unit.test.ts` | 4 | 0 |
| `plugin-auth.unit.test.ts` | 4 | 0 |
| `plugin-compose.unit.test.ts` | 1 | 0 |
| `plugin-import-jobs.unit.test.ts` | 4 | 0 |
| `plugin-inference.test.ts` | 11 | 0 |
| `plugin-job-cursor.unit.test.ts` | 6 | 0 |
| `plugin-launch.unit.test.ts` | 6 | 0 |
| `plugin-principal.unit.test.ts` | 2 | 0 |
| `plugin-protocol.unit.test.ts` | 10 | 0 |
| `plugin-provider-policy.unit.test.ts` | 10 | 0 |
| `plugin-service.test.ts` | 15 | 0 |
| `plugin-tool-input.unit.test.ts` | 5 | 0 |
| `plugin-ui-resources.unit.test.ts` | 7 | 0 |
| `oauth.test.ts` | 29 | 0 |

## Limits

Provider execution used a local mock upstream, not a live managed/BYO vendor.
OAuth tests used the local service/fixtures, not an external host login. Imports,
cursors, recipient/account isolation, scopes, resource inputs, permission changes,
UI bridge states and protocol behavior are covered only to the extent asserted
by these suites. Passing them does not establish real host UI or public HTTPS
rollout acceptance.

Deep Scan rejoin failed after the caller detached with the exact tool error:
“Deep Scan cannot safely start a read-only worker: the parent must provide a
managed filesystem permission profile.” No completion or no-findings result is
claimed. The prior partial diff scan remains evidence only for its older range.

The earlier conversational count of 133 was an arithmetic error; the retained
per-suite results establish **123**.
