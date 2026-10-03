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

## Plugin async reconnect groundwork — 3 October

codex/plugin-job-cursors preserves frozen plugin180bc381226. Local job-cursor.ts
binds a signed reconnect position to the current plugin principal, client/grant/
owner, plugin resource, job, source revision and effective authority. Expiry and
length/safe-integer bounds apply. Display renames/order do not invalidate equal
authority; scope changes, other accounts/grants/resources/jobs/sources do.
Derived key is domain-separated and must load outside read-only transactions.
Six cursor unit checks and backend typecheck passed terminal0. This is not yet
wired to a durable event store/async job route and is not a delivered C6 flow.
Implement live authentication, job/source revalidation and bounded durable event
retrieval before exposing results; keep current unsafe generic stored task reads
out of the plugin path. Do not promote dead groundwork as plugin completion.

UI qualification has priority: Home1834c6 and combined184509 failed the existing
shared font-scale ratchet (three CSS sizes). Combined recovered full finished
2505/2506 terminal1, no skips. Home repair1c00ed79 uses15/13/15, ratchet unchanged,
focused24/24. Combined newb0037a21 contains repair, no source conflicts, fresh
full42763 and build91303. Settings185d041 remains frozen while full62351 runs;
after terminal observation integrate the same repair, requalify its new head.
No main merge, deployment or cleanup; full ADR remains active.

## Plugin async import transport candidate — latest 3 October

Local codex/plugin-job-cursors now adds migration214, source-checked import job
store, shared fresh read/write grant transaction, bounded start/event routes and
response schemas. Cursor/store/protocol17/17 and actual plugin service13/13
passed terminal0. Actual start/replay and status persistence/duplicate/cursor/
visibility/Trash/shield paths are tested; file conversion completion is seeded.
See evidence/plugin-import-jobs.md for missing producer-grant guard at converter
writes and all remaining C6/ADR acceptance. Do not promote before that guard.
Final types/build/format and exact frozen full/CI remain required. No main merge.

Frozen combined184b0037a21 persistent full2506/2506 and settings1853b18468b
persistent full2512/2512 both completed code0, no skips/failures/cancellations.
All four exact-head CI37096051688/37096227442 jobs succeeded. These automated
results do not complete the remaining runtime/native/manual-web/host gates.
Preview services are detached and survive chat interruption. iPhone17 iOS26.5
now displays the actual Orbyn sign-in; the user-reported runtime startup recovery
cause is unverified. Saved credentials verified API8027 login200/admin, filled
existing password securely; human Sign in remains pending. No credentials in Git.
