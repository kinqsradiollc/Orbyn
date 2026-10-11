# C6 production visual validation — 2026-10-11

**Status:** Blocked before production endpoint response; no host acceptance claim.

## Scope and provenance

- Requested public discovery URL: `https://mcp.orbyn.dev/.well-known/oauth-protected-resource/plugin`
- Handoff context, not independently verified: approved runtime `937cb16f`; latest remote environment cleanup `df8f16aa`; deployed commit unknown.
- Local checkout at inspection: branch `codex/c6-file-viewer`, HEAD `df8f16aad614d9bf0836a8cb38dbcf3119511b55`. `docs/reviews/adr-current-state.md` was already modified and was preserved. This local SHA is not evidence of the deployed commit.

## Public discovery check

The internal browser refused to open the requested URL with `net::ERR_BLOCKED_BY_CLIENT`. It returned no HTTP status or response body, so endpoint health could not be determined. The Builder's prior 503 probe was not reproduced by this check.

No screenshot was captured: the browser did not render the endpoint. No alternate browser or network route was used.

## Host connection flow

Not attempted because public discovery health was not established. No custom server connection was added; no production write, new consent, account creation, OAuth flow, or private account data access occurred.

**Result:** Production plugin discovery and real-host C6 acceptance remain unverified. Resume only after the browser restriction is resolved and a healthy discovery response can be inspected.

## Separate Builder HTTP observation

Before Visual Check encountered its browser restriction, Builder made read-only
public HTTP requests: plugin protected-resource metadata returned **503**, while
MCP protected-resource metadata returned **200**. The plugin body was the gateway
JSON-RPC error `-32603`, “Orbyn is briefly unavailable. Please try again.”
The gateway source maps upstream 502/503/504 responses to that message; this
does not identify a container crash, DNS failure or deployed source version.
This is HTTP diagnostic evidence, not browser or OAuth acceptance.

Source inspection found the intended private `plugin:8000` gateway target and
Compose PORT=8000/service entrypoint. No speculative product fix was applied.
Owner was asked for deployed commit, plugin/gateway container status and recent
logs. No request was made to bypass the browser block after it was reported.
