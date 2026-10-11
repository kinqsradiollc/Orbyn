# C6 visual check: Today card

**Candidate:** `codex/c6-plugin-backend` at `b416aa6a69c27c86414b25dd3bdd82de21571e49`
**Source:** `backend/src/modules/mcp-server/apps.ts` (`cardHtml(APP_CARDS[0])`)

## Verified

- At **320 × 900**, the initial light and dark states show the heading, “Load today,” and disabled “Open Today in Orbyn” buttons at readable size. Both buttons fit on one row.
- At **1280 × 900**, the initial light state keeps the buttons side by side. Their measured widths are about 103 px and 168 px.
- No horizontal overflow was measured in the initial states: card `scrollWidth` matched its `clientWidth` at 320 px and 1280 px. The browser reported no console errors or warnings.
- No account data or real Orbyn/MCP service was accessed.

**Issues:** None observed in the requested initial-state scope.

**Scope deviation:** I clicked “Load today” once while using the local preview wrapper. The card sent one `tools/call` message for `get_today`; the wrapper intercepted it and returned synthetic rows. No request reached an Orbyn backend or MCP service. This result is recorded for transparency and is not counted as part of the requested initial-state check.

## Limits

- The card ran in an isolated loopback iframe wrapper that emulates the host’s initialize message. This checks the card’s rendered initial layout, not rendering inside a production MCP Apps host.
- Screenshots were captured inline during the check. The in-app browser exposed no supported local screenshot export path.
- Tests were not run; this was a bounded visual check only.
