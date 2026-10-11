# C6 post-deployment connector evidence — 12 October 2026

## Provenance

The owner reports deployment completed and authorizes testing. Expected main
checkpoint is `f81463e2`, containing locally accepted runtime `8f99272c`.
The owner did not supply the deployed hash; neither call below independently
identifies the server image/commit. Keep reported deployment distinct from
verified runtime provenance.

Later on 12 October, the owner supplied server `git rev-parse --short HEAD`
output `de83f54b`. Local ancestry confirms that commit contains accepted source
`8f99272c`; this establishes owner-reported checkout provenance, not independent
container-image or wire-response provenance. At the owner's request, Builder
opened ChatGPT in this session's internal browser to perform reconnect directly.
That browser is signed out, so host testing awaits its account sign-in; the
existing authenticated MCP connector remains separate from this browser session.

## Read-only connector checks

Builder invoked each already-connected app's `get_context({})` once. No grant,
connection, consent, provider permission or production data was changed.

| Connection | Observed result | Scope proved |
| --- | --- | --- |
| Orbyn | `isError=true`, `error_code=UNAUTHORIZED`; host message: “This app connection requires reauthentication. Reconnect the app and try again.” | Current connection cannot make authenticated calls. This does not establish a server regression or the cause of token invalidation. |
| Orbyn Plugin | `isError=false`; structured connection kind is `plugin` | Existing legacy recipient still serves an authenticated read. This does not qualify canonical `/mcp`, previews, Docs edits or deployed source. |

No account name, private item text, token or personal identifier is copied here.
The connection error itself does not reveal its configured URL. Visual Check
was asked to inspect the canonical entry and reconnect/sign-in step, preserving
Orbyn Plugin. The user must handle any required third-party account consent.

## Successful retry after owner sign-in

The owner completed sign-in. A subsequent canonical Orbyn `get_context({})`
returned `isError=false` and connection kind `oauth`. The initial unauthorized
result above is retained as history; canonical authenticated access now works.

Builder created one explicitly labelled synthetic Personal fixture:
`doc:07775a91-a645-433c-930a-c79f9a5c68c4`, titled
`[QA] C6 canonical MCP preview — 2026-10-12`. Existing personal documents were
not edited. The fixture includes Markdown emphasis, inline code, a table, a
Mermaid source block, a link and one editable QA line.

| Check | Observed result |
| --- | --- |
| Canonical create and fetch | Success, fixture version 1; complete anchored Markdown returned. |
| Anchored save | Success, version 1 → 2; only the synthetic QA line changed. |
| Exact request replay | Same client reference returned version 2; no duplicate change. |
| Stale write with a new client reference | Rejected; text reports `VERSION_CONFLICT`, structured code is `INVALID_ARGUMENT`. |
| Fetch after stale write | Version 2 and intended QA line retained; stale text absent. |

The connected create/fetch responses expose no `_meta` fields. This observation
does not establish whether the host strips metadata, previews are disabled, or
the deployed runtime differs. Rendered card capability remains a separate check.
Builder handed the fixture writer to Visual Check at version 2 for the actual
host Review → Submit interaction. These API calls do not prove that UI flow.

## Remaining gates

Canonical discovery/issuer, negotiated
previews and portable fallback, synthetic Docs Markdown/Mermaid/edit/conflict/
proposal interaction, supported host files/mentions, account/reconnect/revocation
and live managed/BYO qualification remain open. No new visual, host or full-C6
pass is claimed by the connector and fixture calls. U1 remains unstarted.

## Latest read-only preflight while owner prepares deployment

After main documentation checkpoint `fb8d719d` (runtime unchanged from
`6654191c`), Builder called canonical `get_context({})` once while the owner
prepared test-production deployment. Result: **UNAUTHORIZED**, with host text
“This app connection requires reauthentication. Reconnect the app and try
again.” No private context was returned. The current callable host inventory
also lacked `request_workspace_ai`; this may be cached discovery and does not
establish the deployed feature flag or permission state.

This is a new current connection observation; it does not erase the earlier
successful authenticated reads or synthetic document save. Deployment hash,
fresh canonical authentication, and provider/model/allowance permission remain
pending. No inference, mutation or browser action was performed. The owner has
stopped further visual checks for this task.

## Owner reconnect — canonical tool-only checks

The owner reported the deployment live and explicitly reconnected the selected
Orbyn plugin, directing Builder to test through its MCP calls only.

| Check | Result |
| --- | --- |
| `get_context({})` | Success; OAuth connection, write access, readonly false. No private context copied into this report. |
| Fetch existing synthetic QA document | Success; revision 3 and previously host-saved QA line retained. |
| Stale revision-2 line replacement | Rejected with `VERSION_CONFLICT` in text and `INVALID_ARGUMENT` structured code. |
| Fetch after rejected edit | Still revision 3; saved line preserved, stale replacement absent. |

The prior UNAUTHORIZED observations remain history; authentication has now
recovered. The callable selected-plugin inventory still lacks
`request_workspace_ai`, so no workspace-provider request was dispatched.
Deployment source hash and separate provider/model/allowance consent receipt
remain unverified. Host discovery can be cached; absent callable metadata alone
does not prove the server flag is disabled. No browser/native/visual action was
performed, and only the synthetic QA document was targeted.

## Latest deployment and reauthentication

The owner reported latest main deployed and Workspace AI enabled. The first
`get_context({})` returned `UNAUTHORIZED` and required reauthentication. After
the owner requested reauthentication, `get_profile({})` succeeded and returned
an account identity; no personal identity is copied into this report.

The current callable inventory contains `get_workspace_ai_status` but still
does not contain `request_workspace_ai`. Authentication recovery is verified;
dispatch capability, the deployed commit and separate connection permission
are not verified. No inference ran. Refreshing host tool discovery is the next
external step; missing metadata alone does not diagnose server configuration.
No browser, native app or visual check was used.

The owner subsequently supplied `docker compose exec mcp printenv
MCP_WORKSPACE_AI_ENABLED` with output `true`. This verifies the reported
container environment, not the public endpoint's running source or current
host catalog. Builder then inspected `workspace-ai.ts` and `server.ts` at
`f47c242f`: OAuth plus the enabled flag includes the request descriptor directly
in `tools/list`; per-connection provider consent does not filter discovery.
The server declares private discovery caching for five minutes. The selected
session inventory still exposes only the status tool. No further source filter
was found in that enumeration path, and no inference was attempted.

## Refreshed Codex connection — dispatch permission rejection

The refreshed `mcp__orbyn` inventory now exposes both Workspace AI tools.
`get_context({})` succeeded with OAuth write access and client `Codex`.
Builder submitted one synthetic request:

- Operation ID: `01a12d5a-64be-7c5c-8008-1782d0730e57`
- Exact prompt: `Reply with C6 live provider verified.`
- Result: `isError=true`, `FORBIDDEN: The owner has not permitted workspace AI for this plugin.`
- No receipt ID was returned and no inference pass is claimed.

Source at `f47c242f` checks this connection's enabled owner permission before
inserting a run or reserving allowance. This is live evidence that the request
tool is reachable and the missing-permission boundary rejects dispatch, not
evidence of successful provider execution. Owner must allow Workspace AI for
this Codex connection with provider/model and limits. Retain the exact operation
ID and prompt for the retry; no automatic retry was attempted.

## Owner permission enabled — live provider success

Owner explicitly enabled Workspace AI for the Codex connection and requested
retry. Builder reused the exact operation ID and prompt above.

| Observation | Result |
| --- | --- |
| Accepted receipt | `200f7721-4308-40ce-8ce7-32c635274828`, initially `queued` |
| Selected model | `matilda` |
| Provider ID | `0ffa0d3a-5dbe-4b80-941c-bf04b7522a95` |
| Status events | sequence 1 queued → 2 running → 3 done |
| Terminal response | `C6 live provider verified.` |
| Exact request replay | Same receipt ID, original creation timestamp and `done` state |
| Created / completed UTC | 2026-10-11 23:45:36.100 / 23:45:40.800 |

This proves one bounded live Workspace AI dispatch and terminal result through
the selected canonical Codex MCP connection, plus receipt identity on replay.
The preceding denied attempts did not produce receipts. No token totals, exact
configured allowance, second provider, live failure/revocation behavior or
additional dispatch is claimed. Earlier source-scoped deterministic/runtime
evidence retains its limits. Browser/visual/native checks remain stopped per
owner instruction; previously unperformed host cases are still unverified.
Full C6 closure requires Reviewer disposition against the retained requirements.

## Required live lifecycle checks — baseline

Owner explicitly retained live account-switch and revocation checks. Builder
confirmed `get_profile` succeeds and stored the opaque account identity only in
session state for comparison; no identity is copied here. The existing synthetic
AI receipt remains accessible and `done`. The callable connector offers no
account-switch or grant-revocation control. Owner is asked to revoke this Codex
grant in Orbyn while leaving the installed host plugin intact so the old
credential can be tested. No grant, account or permission was changed by Builder.
Next checks are denied old-credential account/receipt reads, followed by a fresh
different-account connection and denial of the original account's synthetic
document/receipt. These remain pending, not passes.

## Owner lifecycle confirmation and release disposition

The owner replied to the live revocation request: “no need i can confirm both
works and I think we can fully complete this now.” Account switching and
revocation are therefore recorded as **owner-confirmed**, not independently
observed by Builder/Tester. No revocation or account switch was performed in
this session. This latest direction supersedes the request to run those checks.

The owner accepts closing this delivery using the observed live provider result,
retained code/runtime evidence and their lifecycle confirmation. Remaining
stopped host cases and uploads retain their unverified/deferred labels. Exact
running image/revision and permission-version/output/daily caps were not supplied;
they remain provenance/configuration record limits, not fabricated values.
Reviewer must explicitly assess this owner-approved bounded closeout scope.
