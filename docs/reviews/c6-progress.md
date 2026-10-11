# C6 progress — 11 October 2026

**State:** Builder source candidate `b416aa6a` is frozen on
`codex/c6-plugin-backend` from `058a63e5`. This is not a reviewed checkpoint,
main merge or production deployment. The current-state ledger and this progress
record follow the frozen source commit.

## Implemented in this worktree

- The optional Compose plugin process is private to the Compose network. The
  gateway routes only the plugin recipient and its protected-resource metadata;
  blank `PLUGIN_PUBLIC_URL` returns 404. `deploy.sh` includes the opt-in service
  in its staged rollout and stops it when disabled.
- The plugin Today UI has a host sidebar entrypoint backed by `open_orbyn`, a
  static bootstrap that returns no account content. The person clicks **Load
  today** before the existing scoped `get_today` capability runs. Portable MCP
  cards continue to work when the host ignores the extension.
- [Security boundaries](c6-security-boundary.md) records the connector, managed
  provider, host UI and publication controls, plus the diff scan result.

## Builder evidence so far

- Enabled and disabled generated Nginx configs: `nginx -t` passed.
- Disposable gateway smoke: disabled `/plugin` returned JSON 404; enabled
  `/plugin/connection` and protected-resource metadata reached the mock plugin
  with path and Host preserved; `/me` remained 404. Mock containers and network
  were removed. This is not an external HTTPS host test.
- `docker compose --env-file .env.example config --quiet` passed with a
  disposable placeholder for the example file's required PDF key.
- `deploy.sh --check` passed with a disposable example env and
  `PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin`; no deployment occurred.
- Backend typecheck passed. Focused gateway/Compose/UI/protocol checks passed.
  The authenticated plugin service check passed 15/15 against the marked local
  `_test` database after fixing the new entrypoint's async error mapping.
- Plugin inference passed 11/11 and plugin permission passed 1/1 when run as
  separate files. A prior parallel invocation failed 10 inference cases
  because both files changed shared provider settings in the same fixture
  database. Do not use that mixed run as product failure or as passing evidence.
- [Visual Check](c6-visual-report.md) rendered the frozen Today card at
  320 × 900 in light/dark and 1280 × 900 in light, including a synthetic result.
  No horizontal overflow or console error was observed. This was a loopback
  host-message wrapper, not a production ChatGPT/Codex host connection.

## Open gates

- Composer mentions are not wired. Automatic approval review rejected sending
  Orbyn item titles and links to the external plugin host without specific
  authorization. Builder has asked the owner about that exact scoped flow.
- File-viewer integration needs a supported product file contract and host
  validation; no generic host-file read is implemented.
- Live host OAuth, account switch/reconnect, actual ChatGPT/Codex UI and public
  gateway behavior require a reachable HTTPS deployment and a connected test
  host. Local fixtures do not prove these.
- Codex Security diff scan `f3fa3b73-0b8f-453f-9416-4a435b708594` completed
  for `058a63e5..88f46bb2` with **zero reportable findings** and **partial
  coverage**. It reviewed the C6 gateway, private service rollout, connector
  authority and Today UI data release. The scan does not establish whole-repo
  security or deployed HTTPS host behavior. Its canonical report is in the
  local Codex Security scan artifacts; see [security boundaries](c6-security-boundary.md).
- Formal Tester → Reviewer qualification has not started. The bounded Visual
  Check is complete; screenshots were inline because the browser had no
  supported local export path.

The existing independent grant, inference broker, launch context, import and
reconnect code precedes this worktree; see the governing ADR and source tests.
