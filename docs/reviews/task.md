## Plugin tool boundary structural limits — 3 October 2026

Isolated codex/plugin-tool-input-bounds follows frozen a74ad26a without editing
its original branch or the preserved node_modules link. Tool-call input now
checks finite JSON, at most 16 nested levels and 4096 values before policy/
capability dispatch. Existing 65,536-byte request limit, independent grant auth,
policy and execution remain active. Extra authority fields remain rejected.
12 focused JSON/resource/principal checks and backend typecheck pass. Initial
focused command failed due root esbuild platform installation; retry explicitly
uses the existing healthy Darwin binary without changing shared dependencies.
HTTP tests now assert excessive graphs400 with no argument echo; local DB gate
is unavailable, so those tests/full runtime are not claimed passed. OAuth host,
launch/resource/CSP/event/provider/tenant gates remain incomplete. No main merge.

## Plugin UI resource adapter — 3 October 2026

Isolated codex/plugin-ui-resources follows f74bb9de. The authenticated plugin
backend adds GET /plugin/resources and POST /plugin/resources/read, with strict
bounded identifiers and no arbitrary URL fetch. It reuses existing Orbyn MCP
cards and CSP declarations, filters resources by current registry tool scope,
and attaches resource metadata to authorized tools only when the existing card
UI opt-in is enabled. No browser session, first-party model default or plan
credential is introduced. Reads re-resolve the connector grant on each request.

9 focused resource/input checks and backend typecheck pass. Service assertions
cover401/403/400/429, UI enable/disable, disabled user, non-echoed host address,
metadata association and no-store; local execution awaits marked DB recovery.
Official source inspected: https://developers.openai.com/plugins/build/chatgpt-ui
(shared resource MIME, resourceUri metadata, CSP and portable tool fallback).
This is the separate HTTP resource adapter, not completed MCP-host launch:
transport/extension entry points, host screenshots, account-switch/provider and
async result/event cursors remain open. No main merge, deployment or cleanup.

## Separate plugin MCP transport — 3 October 2026

Isolated codex/plugin-mcp-transport follows frozen9d852b69. /plugin adds the
SDK's current and legacy stateless exchanges under the existing plugin-only
auth hook. Each request gets a server bound to its freshly resolved connector
principal and authorized catalog. It shares one dispatcher with HTTP calls,
retaining quotas, write revalidation/receipts, maintenance guards and activity.
UI resources remain opt-in and scoped. Discovery/list/read cache hints are
private with zero TTL; HTTP responses remain no-store. Unsupported legacy
session operations return405. Host metadata never chooses user or grant.

27 combined SDK/resource/input/principal/catalog checks pass, no skips. Both
legacy initialization and current2026-07-28 discovery/list/call were exercised
without external requests or DB. Structural input refusals happen before
invocation; unexpected errors are generic. Backend typecheck/build pass, final
service assertions being rechecked. HTTP401/403/400/429 assertions now include
the protocol path; local full/service runtime awaits Docker/marked DB recovery.

PR1776220f1c1 and PR178f74bb9de now have all four respective CI jobs successful
(37090985523/37091077562). PR179 CI37091484961 remains in progress. This transport
is not hosted ChatGPT/Codex launch acceptance: extensions, host screenshots,
actual account/provider/tenant execution and async event cursors remain open.
Full C1–C6/M1/D1/U1 continues; no main merge, deployment or cleanup.
