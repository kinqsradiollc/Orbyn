# Plugin backend

The plugin service authenticates its own OAuth recipient independently of browser
sessions and the portable MCP recipient. It reuses authorized domain capabilities.

### Host launch context

Send `POST /plugin/launch` with a plugin OAuth bearer token and a bounded body:

```json
{
  "version": 1,
  "presentation": { "theme": "system", "locale": "en-AU" }
}
```

`presentation` and `resource_uri` are optional. Choose a resource identifier from
`GET /plugin/resources` when selecting a card.
The response identifies the authenticated account, grant and OAuth client, lists
its currently allowed UI resources, and confirms the selected resource when
provided. Theme/locale are presentation hints only. It does not issue a session,
invoke a provider, fetch a URL or authorize a tool call. Resource reads and tool
calls continue to recheck current authority independently. Unknown fields,
host-supplied credentials/account/provider identifiers and query parameters are
rejected. UI selection requires the existing UI opt-in and current tool scope.

### Plugin import progress resources

The independently authenticated plugin recipient returns an `Import progress`
resource link with a successful `start_import` tool result. Read the
`orbyn://plugin-job/<job-id>` address with `resources/read` to receive JSON status,
at most 100 events, a reconnect cursor and a current document link when ready.
For continuation use `orbyn://plugin-job/<job-id>?cursor=<encoded-cursor>`.

Each read rechecks the current grant, account and source visibility; a resource
address grants no authority. UI cards are optional. Current protocol clients
must send the SDK-required `Mcp-Name` resource URI matching `params.uri`, along
with their normal protocol/client metadata. Legacy clients retain their normal
resource-read envelope. No arbitrary URL fetch or host identity override occurs.

## Managed inference

The source includes owner consent, durable storage, HTTP admission/results and a
separate inference worker. Earlier implementation-stage notes describing these
as unmounted foundations have been replaced by the current contract below.
This source description does not certify a deployed host or a live provider.

### Consent and limits

A signed-in owner enables a default-off permission for an existing OAuth grant,
with an exact administrator-configured managed/BYO provider, configuration
revision, model, per-call output limit and daily allowance. Connected agents
exposes provider/model review and revocation on web/desktop and mobile.
Updates use expected versions; launch context, MCP credentials and a read/write
grant alone cannot enable inference or raise its allowance. Personal ChatGPT
plan credentials and paid fallback are excluded from this broker.

### Admission and results

`POST /plugin/inference` accepts a recent UUIDv7 operation ID and bounded text.
New IDs must be no more than one day old or one minute ahead. Existing receipts
are looked up before applying new-ID age rules. A grant/operation-unique receipt
captures permission and provider identity before dispatch; changing or disabling
the provider/permission invalidates queued authority.

`GET /plugin/inference/:id/events` returns private ordered events with a
receipt/grant/resource/revision-bound reconnect cursor. Text is returned only
after accepted completion. Both routes require the plugin OAuth audience and
fresh authority, with bounded responses and no-store headers. Prompts, credentials
and upstream provider errors are not exposed through discovery or another grant.

### Worker and recovery

`backend/src/services/plugin.ts` starts the dedicated worker. It reserves the
grant's UTC daily allowance and claims receipts with separate persisted capacity
of two. It checks owner, client, grant, token, team access, consent and provider
revision before dispatch and acceptance, preserving grant-before-job locking.
Transport uses the captured output cap, a 30-second deadline and no fallback.

Unknown or interrupted outbound calls retain their reservation and are not
replayed. Known-undispatched queued revocations can release allowance. Receipts
expire after thirty days through the sweeper; expired IDs cannot become new work.
The canonical MCP workspace-AI tool uses shared broker contracts under its own
recipient checks and separate feature flag; it does not transfer legacy grants.

## Configuration, verification and owners

The canonical outside-agent connection is MCP. Keep legacy plugin recipients
available only as required by existing grants. See [environment](environment.md#one-mcp-connection-legacy-plugin-compatibility),
[MCP](mcp.md) and the [production qualification procedure](plugin-production-test.md).
The plugin service runs under the Compose `plugin` profile. Provider execution
still requires explicit owner consent and a configured managed provider.

Owning source is `backend/src/modules/plugin/` (`routes.ts`,
`inference-contract.ts`, `inference-broker.ts`, `inference-worker.ts`,
`provider-policy.ts`) and the shared schemas in `packages/core/src/plugin-ai.ts`.
Focused fixtures and CI establish only the cases they execute. Live external
provider renewal, actual host integration and installed-native consent UI require
separate qualification; this guide is not an acceptance receipt.
