# C6 provider prerequisite runbook review — 12 October 2026

Documentation-only source review at `6654191ccf821f791d9f7d48f9c4866e50522216`
in `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`. Existing round 2/3 is
unchanged. No tests, browser actions, scans, provider dispatch or source edits.
Builder's in-progress runbook/readiness documents were read and left untouched.

## Source-confirmed instructions

- `backend/src/modules/mcp-server/workspace-ai.ts` exposes
  `request_workspace_ai` only to OAuth principals when
  `MCP_WORKSPACE_AI_ENABLED=true`. `get_workspace_ai_status` remains advertised
  to OAuth principals when that dispatch flag is false. Reading an old receipt
  still requires current grant authority, unexpired receipt and matching
  provider/permission snapshot; flag-independent discovery is not unconditional
  receipt access.
- The permission controls match
  `desktop/src/features/settings/PluginAiPermission.tsx`: Workspace AI,
  Output tokens per call, Calls per day (UTC), and Allow workspace AI / Save
  permission. Limits are 1–2048 output tokens and 1–100 daily calls.
  `provider-permissions.ts` offers the enabled provider/model selected by
  workspace `ai_settings`; this connection panel approves that configuration,
  rather than selecting any arbitrary configured provider. Consent pins its ID,
  revision, model, permission version and limits. Confirm the returned permission
  is active and matches the intended test provider/model before dispatch.
- `backend/src/services/plugin.ts` starts the integration worker;
  `services/mcp.ts` only starts the MCP HTTP service. `compose.yaml` puts the
  worker service under profile `plugin`; `scripts/deploy.sh` enables that
  auxiliary when canonical inference is enabled, even with an empty legacy
  `PLUGIN_PUBLIC_URL`. Both the serving MCP process and worker must receive the
  intended flag/configuration. Merely exposing the request tool does not prove
  a running worker or completed provider execution.
- `provider-policy.ts` requires a UUIDv7 operation ID and nonblank prompt up to
  16,000 characters. `inference-broker.ts` returns a receipt ID and the status
  tool accepts `{id, cursor?}`. Cursor continuation and the separate permission
  requirement are correctly described in the runbook.

## Small documentation corrections before use

1. **Retry identity:** amend step 5 to reuse the same operation ID **and exact
   prompt**. The broker checks `prompt_digest`; changing text with the same ID
   returns STALE. Prefer status retrieval when the receipt ID is known. A denied,
   expired or uncertain receipt is not permission to create a replacement ID.

2. **Evidence available through MCP:** distinguish the permission receipt
   (provider revision/model, version, output cap and daily call limit) from the
   execution receipt/status (ID, operation ID, provider/model, state, timestamps,
   event cursor, and text on `done`). Status does **not** expose measured token
   usage or `reserved_day`. The broker reserves daily call allowance in its
   durable run record, but a returned receipt alone is not independent evidence
   of the precise reservation row. Record reservation inspection only if an
   authorized server-side receipt is actually obtained; otherwise mark that
   field unverified. Do not call the configured output cap actual usage.

3. **Preserve the visual stop:** the generic paragraph immediately following
   the bounded provider section still tells the operator to verify Today,
   previews/edit conflict, mentions and host files. Label it a retained general
   acceptance inventory, inactive for this provider-only run. The next paragraph
   also mentions paused-worker/unknown-outcome verification; explicitly retain
   existing local receipts for those cases rather than prescribing additional
   live dispatch or failure injection here.

The readiness follow-up correctly distinguishes an in-process legal-route 200
probe from reproducing the earlier browser/proxy issue. It also correctly keeps
deployment pending owner confirmation and model/allowance consent pending.
The owner-selected existing test-provider path supersedes mandatory creation of
a fresh local account for this particular run; retain the earlier isolated-QA
failure as history, and record the actual authorized account/grant used instead
of claiming isolation. Five elapsed minutes do not establish deployment.

## Disposition

No product-source correction identified. Builder should apply the narrow wording
changes above to the owned documents. Live execution remains pending actual
deployment confirmation and the exact active provider/model/allowance receipt;
this review neither performs nor independently authorizes dispatch. Further
visual checks remain stopped. One bounded successful call would establish only
that selected provider/model path, not all managed/BYO configurations or full C6.

## Final documentation disposition

**Approve the revised documentation.** Reviewer reread the working-copy bounded
provider section and readiness follow-up at HEAD `6654191c`. Step 5 now requires
the same operation ID and exact original prompt, records receipt state/events,
and explicitly rejects inferring usage totals. The current-C6 owner-stop note
now makes the broader checklist reference-only; the preceding paragraph retains
local failure-case evidence without prescribing live failure injection. All
three requested wording corrections are closed; no further correction requested.

Approval covers these document revisions, not deployment or live-provider
qualification. The readiness follow-up still correctly awaits owner deployment
confirmation and the separate provider/model/allowance receipt. Current grant
authority and matching permission/provider state remain necessary for receipt
access even though the status tool is advertised with dispatch disabled.
No source edits, tests, browser actions, scans or inference were performed.
Existing round 2/3 and the stop on further visuals remain unchanged.
