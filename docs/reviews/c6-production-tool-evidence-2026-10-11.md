# C6 production connector reads — 11 October 2026

## Observed result

After the owner completed the custom-server connection under the name **Orbyn
Plugin**, the `mcp__codex_apps__orbyn_plugin` connector became available to
Builder. Two sequential calls through that connector succeeded:

| Call | Observed evidence |
| --- | --- |
| `get_context({})` | `isError=false`; structured response; connection kind `plugin`, access `write`, readonly false; eight toolsets and allowance fields present; zero visible teams |
| `get_today({})` | `isError=false`; structured day/timezone; four planned entries, zero due entries, zero late entries and three Up next entries |

These were read-only calls. No item, provider setting, grant or account was
changed. Personal titles, identifiers, document content, profile, Memory and
credentials are excluded from this report. Raw responses were not saved to disk.

## What this proves

The installed host connector can reach an authenticated plugin recipient and
execute these two reads. The `plugin` connection kind distinguishes this grant
from the ordinary MCP connector. The owner supplied server commit `b3d02d19`;
the calls do not independently identify the running server's commit.

## Remaining limits

The prior direct-browser discovery errors remain historical client observations;
successful tool calls do not turn them into successful browser metadata checks.
These calls do not qualify rendered Today UI, its explicit-load interaction,
composer mentions, host Markdown resources, account switching/reconnect,
revocation or managed/BYO inference. Those require their own evidence. Full C6
remains open; shared web/mobile U1 execution has not started.

See [host UI observations](c6-host-subagent-2026-10-11.md),
[qualification](c6-qualification.md) and
[production test cases](../plugin-production-test.md).
