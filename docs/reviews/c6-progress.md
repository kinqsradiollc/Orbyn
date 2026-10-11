# C6 progress — 11 October 2026

**State:** C6's local checkpoint is accepted and pushed to main: runtime
`937cb16f`, service/environment documentation through `b607e1dc`, evidence
`4ab7dbc9`. Formal review closed within round 1/3. Earlier source candidates
and their bounded receipts remain below as history.

The owner supplied server commit `b3d02d19`. Its gateway logs identified an
unresolvable `plugin` upstream, and no running plugin container appeared in
the supplied Compose output. The owner subsequently reports `/plugin` working.
Visual Check's internal-browser retry still returned `ERR_BLOCKED_BY_CLIENT`;
it did not observe an HTTP response or start host OAuth. Full C6 real-host
acceptance remains open. See [qualification](c6-qualification.md) and
[production evidence](c6-production-visual-2026-10-11.md).

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

- Composer mentions are implemented following the owner’s explicit authorization
  on 11 October to share scoped titles and links. Real host selection remains
  unverified; full item contents are excluded.
- File entrypoint source is implemented; actual production-host validation remains
  unverified. The source editor is not a rendered Markdown/Mermaid preview.
- Live host OAuth, account switch/reconnect, actual ChatGPT/Codex UI and public
  gateway behavior require a reachable HTTPS deployment and a connected test
  host. Local fixtures do not prove these.
- Codex Security diff scan `f3fa3b73-0b8f-453f-9416-4a435b708594` completed
  for `058a63e5..88f46bb2` with **zero reportable findings** and **partial
  coverage**. It reviewed the C6 gateway, private service rollout, connector
  authority and Today UI data release. The scan does not establish whole-repo
  security or deployed HTTPS host behavior. Its canonical report is in the
  local Codex Security scan artifacts; see [security boundaries](c6-security-boundary.md).
- Tester ran source-scoped checks on `81e4c812`; saved-finding remediation supersedes it and the corrected local checkpoint has Reviewer acceptance. The bounded Visual
  Check is complete; screenshots were inline because the browser had no
  supported local export path.

The existing independent grant, inference broker, launch context, import and
reconnect code precedes this worktree; see the governing ADR and source tests.

## Host Markdown file integration

- `open_markdown_file` declares `.md` and `.markdown` file entrypoints and accepts
  the host's opaque resource handle. The backend returns static UI metadata,
  never file contents, paths or a reflected handle.
- The iframe reads through the host resource bridge. Editable resources require
  writable metadata and an ETag; Save uses `openai/resources/write` with `ifMatch`.
  Read-only/oversized resources cannot be saved. Conflict and failed-save states
  preserve the draft; Reload requires an explicit discard step when dirty.
- `a98e6f04` prevents duplicate saves/reloads while a write is pending. Typing
  during that write preserves newer edits and cannot falsely mark them saved.
- Builder checks: UI resource/runtime tests **7/7**, terminal exit 0, including
  concurrent typing/save/reload, duplicate host input, failed file switches and
  resource-update assertions; backend typecheck
  and diff check passed. Earlier service tests **15/15** and protocol/UI **16/16**
  cover the preceding source; they are not formal acceptance of the latest ref.
- [Visual Check](c6-markdown-file-visual.md) reports no overlap/clipping at
  320×740 light and 1280×900 dark for loaded, unsaved and conflict states. This is
  delegated inspection of source `83c49c18` in a synthetic host. Subsequent source
  changes affect pending-save behavior, not layout/CSS. Screenshots remain inline;
  no supported export path was available. Builder has not personally inspected pixels.
- Official contract references: [extension guide](https://developers.openai.com/plugins/build/extensions)
  and [MCP extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md).
  Host file-resource support is platform-specific; browser/native acceptance is
  unverified and must not be inferred from the synthetic wrapper.
- Full repository Deep Scan could not rejoin after caller detachment: the tool
  requires a managed filesystem permission profile. No completed result is
  claimed; its original target `bb7a046f` excludes these file-entrypoint commits.

- `55e94ca5` clears the previous source on a new file open, retains dirty drafts
  when the host repeats the same file input, and keeps Reload available after an
  unreadable resource. The UI/runtime suite passed **7/7**, exit 0, on this ref.
  Layout/CSS is unchanged; no additional visual sweep was requested.

## Serial local contract checks

[Builder receipt](c6-builder-checks-2026-10-11.md): **123/123**, zero failures or
skips, all 16 suite processes exit 0 on source `55e94ca5`. This covers the complete
plugin suite plus OAuth regressions, run serially with the guarded test database.
Live provider, external host and formal acceptance gates remain open. The earlier
conversational total of 133 is corrected by the per-suite receipt.

## Composer mentions

`81e4c812` adds `search_orbyn_mentions`, an app-visible read-only host tool,
conditionally advertised through `openai/mentions` only when UI opt-in and the
connection’s search capability are available. It accepts a bounded query (empty
means recent items), escapes wildcard characters, and returns up to 20 resource
links containing only the title and first-party app URL. Queries read no page
content, notes or project summary. Shared visibility excludes other owners,
ungranted teams, Trash, agent/memory pages and projects kept out of AI.

Both HTTP and MCP adapters use the search limiter and `pluginRead` for a fresh
locked connector-authority check. No browser session or ChatGPT plan token is
accepted. Protocol **11/11**, service **16/16**, and backend typecheck passed.
These follow-up results supersede the two affected suites in the older 123-test
receipt; they are not a new full-suite total. No custom visible UI changed.

## Saved-finding remediation — 11 October

The owner canceled Codex Security and prohibited further scans unless explicitly
requested. All 29 saved finding IDs (including duplicate causes) have source
patches recorded in [the remediation ledger](security-remediation-2026-10-11.md).
This revision changes OAuth consent/replay, signup admin authority, private file
and stream revocation, publication privacy, provider transport and credential
upgrade/deployment controls. No replacement scan or production deployment is
claimed. Independent read-only patch closure is recorded in the ledger; new
frozen-source Tester qualification follows. Earlier tests remain source-scoped.

## Formal review correction handoff

Reviewer round 1/3 requested SR-R1 (legacy key conversion while old writers run)
and SR-E1 (real SSE and OAuth race evidence). Builder froze `dc094b4b`: quiesced
Compose cutover with fail-closed production rewrap/Kubernetes procedure, rollback
fixtures, actual authenticated SSE revocation/control, SQL-barrier consent tests,
and env template updates `78fee192`. Focused local passes and fixture failures
are in the remediation ledger. Tester retest has been dispatched; same-round
Reviewer closure follows. No main merge/push, deployment or external-host
acceptance is claimed.
