# C6 production visual validation — 2026-10-11

**Status:** Direct discovery was blocked before an endpoint response; full C6 acceptance remains open.

## Scope and provenance

- Requested public discovery URL: `https://mcp.orbyn.dev/.well-known/oauth-protected-resource/plugin`
- Handoff context, not independently verified: approved runtime `937cb16f`; latest remote environment cleanup `df8f16aa`; deployed commit unknown.
- Local checkout at inspection: branch `codex/c6-file-viewer`, HEAD `df8f16aad614d9bf0836a8cb38dbcf3119511b55`. `docs/reviews/adr-current-state.md` was already modified and was preserved. This local SHA is not evidence of the deployed commit.

## Public discovery check

The internal browser refused to open the requested URL with `net::ERR_BLOCKED_BY_CLIENT`. It returned no HTTP status or response body, so endpoint health could not be determined. The Builder's prior 503 probe was not reproduced by this check.

No screenshot was captured: the browser did not render the endpoint. No alternate browser or network route was used.

## Host connection flow during this Visual Check

Not attempted because public discovery health was not established. Visual Check did not add a custom server connection or perform a production write, grant, consent, account creation, OAuth flow, or private account data access.

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

## Retry after owner recovery update

The owner reported `/plugin` recovery and supplied server evidence naming commit
`b3d02d19`, a healthy gateway, no plugin service in the running Compose list,
and Docker DNS failure resolving `plugin`. These are handoff claims, not
independently verified in this browser check.

Visual Check made the requested single retry of the exact discovery URL in the
internal browser. The browser again returned `net::ERR_BLOCKED_BY_CLIENT` and
left the tab at `about:blank`; no HTTP status, response body or screenshot was
available. The retry therefore did not confirm the reported recovery. The
`/plugin` resource, authorization-server metadata and ChatGPT authoring flow
were not opened. No production connection, grant, consent, account or data was
created or changed.

## Later unified C6 checkpoint and legacy host evidence

The local checkout and `origin/main` now both point to
`4f9e8e889c456348ee3cb61e93f7cfa89dab8521`, a checkpoint-evidence commit. The
committed Reviewer report approves runtime `8f99272c66101734f0536405ad5bb68f5122e60b`
for main integration and closes U2-R1–R4 within round 2/3; its linked Tester
report records 58/58 focused tests and backend typecheck exit 0. These are local
code/review receipts, not production evidence. The Tester report says its DOM
stand-in editor cases do not establish rendered host cards or layout. The owner
has not confirmed deployment, so the canonical `/mcp` host plan below remains
pending. See the
[unified-MCP decision](../adr/002-unified-mcp-integration.md),
[Reviewer report](c6-unified-mcp-review-r2.md) and
[Tester report](c6-unified-mcp-tester-r2-8f99272c-2026-10-11.md).

The separate [host check](c6-host-subagent-2026-10-11.md) records the existing
**Orbyn Plugin** Today card and an explicit **Load today** action that completed
without a loading or failure state. It copied no private entries. Retain that
as legacy `/plugin` evidence; it does not establish the unified `/mcp`
candidate's supported previews. The separate [connector reads](c6-production-tool-evidence-2026-10-11.md)
record successful read-only `get_context` and `get_today` calls, with their
stated evidence limits.

No new visual sweep was requested. The browser errors above remain this Visual
Check's observations. Targeted preview checks are pending owner confirmation of
deployment and the delegated run; this report makes no claim about those future
checks.

## Planned bounded canonical `/mcp` preview acceptance

The expanded baseline was `bc43d9d58865d0c74f3c402f61063143c279a758`; the final
accepted runtime freeze is `8f99272c66101734f0536405ad5bb68f5122e60b`, integrated
at `origin/main` evidence commit `4f9e8e889c456348ee3cb61e93f7cfa89dab8521`.
The owner has not confirmed deployment. No canonical `/mcp` host connection or
call was made during planning; wait for the owner to identify the deployed
runtime commit before using the production path.

### Local feasibility, source evidence only

`backend/src/modules/mcp-server/apps.ts` defines self-contained MCP App
resources and the `ui/initialize` host bridge. The generic result card has a
Markdown/diagram renderer, source links, and an anchored line editor that calls
`edit_doc` only after **Review change** and **Submit change**. The server builds
the document preview from the authorized fetch result in
`backend/src/modules/mcp-server/result-preview.ts`. A targeted file search found
no repository MCP Apps browser-host harness. These facts establish that the
candidate exposes material for a host check; they are not a rendered local card
observation or evidence of ChatGPT/MCP host acceptance.

### Post-deployment run

1. Confirm with the owner that the deployed image contains accepted runtime
   `8f99272c66101734f0536405ad5bb68f5122e60b`. If deployment reports the main
   evidence commit `4f9e8e889c456348ee3cb61e93f7cfa89dab8521`, verify it includes
   that runtime unchanged. Then check that the canonical OAuth resource is
   exactly `https://mcp.orbyn.dev/mcp` with the first-party issuer.
   Confirm `/plugin` remains separate and unchanged. If the browser repeats its
   discovery block, stop and record the block; do not retry or route around it.
2. With the user present, create one fresh `/mcp` connection for the disposable
   test workspace. The user reviews and submits any ChatGPT trust/consent step.
   Never reuse `/plugin` credentials, grants, receipts, or provider permission.
3. Use one synthetic Orbyn document containing ordinary Markdown, a Mermaid
   block, and a stable anchored line. In one bounded host session:
   - call `search` and `fetch`; verify a result card links back to that authorized
     synthetic source and its line;
   - verify Markdown and Mermaid render when the host supports the view, with
     the original Mermaid source still available as fallback;
   - select **Edit a line**, make a small synthetic edit, review the diff, then
     submit only after the explicit **Submit change** action;
   - check one controlled stale-revision result, permission-denied result, and
     proposal-required result. Each failure/pending outcome must retain the
     draft; do not retry an uncertain submission or approve the proposal.
4. Check portable fallback once with a text-only MCP client that does not
   advertise MCP Apps: verify useful text/structured content and source links
   without a rendered card. If this requires a separate connection or consent,
   pause for the user's decision at that step; do not transfer a token between
   hosts.
5. Record exact deployed commit, host/capability result, observed calls,
   unsupported behavior, and sanitized screenshots only where permitted in a
   dated acceptance report under `docs/reviews/` and evidence under
   `docs/reviews/evidence/`. Use synthetic content and remove account details.

This run excludes the legacy `/plugin` connection, unrelated screens, provider
execution, Today, mentions, host file-resource editing, account switching, and
revocation. No third-party connection consent is given by this plan.
