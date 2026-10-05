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
at most100 events, a reconnect cursor and a current document link when ready.
For continuation use `orbyn://plugin-job/<job-id>?cursor=<encoded-cursor>`.

Each read rechecks the current grant, account and source visibility; a resource
address grants no authority. UI cards are optional. Current protocol clients
must send the SDK-required `Mcp-Name` resource URI matching `params.uri`, along
with their normal protocol/client metadata. Legacy clients retain their normal
resource-read envelope. No arbitrary URL fetch or host identity override occurs.

### Remaining managed-provider execution contract

Launch context does not grant inference permission. Before adding a provider-call
endpoint, implement the following retained P1 boundary:

1. A signed-in owner explicitly enables AI for an existing plugin OAuth grant.
   Bind that permission to a database provider ID, configuration revision and
   model, with a per-call output limit and daily work allowance. Default is off.
   Show provider, model and possible workspace/API charges in both clients.
   Permission changes use an expected version; MCP credentials, plugin tokens,
   assistant sessions and host launch hints cannot enable or raise it.
2. Persist a grant-owned operation UUID and captured permission/provider revision
   before dispatch. Reserve the allowance atomically. Duplicate requests return
   the same receipt; a dispatched request with an unknown outcome is not replayed
   or refunded as though no call occurred.
3. Resolve only the captured administrator-configured managed/BYO connection.
   Reject missing, disabled or changed providers and every personal-plan text
   transport. Neither the request nor host metadata may select an endpoint,
   credential, user, tenant, callback or alternate provider. No paid fallback.
4. Recheck current connector audience, owner, grant/client status, permission and
   source visibility before dispatch and result acceptance. Read referenced
   Orbyn documents through the shared capability policy with retained revisions;
   host-provided text remains untrusted data, never additional authority.
5. Return bounded private asynchronous status/results through grant-bound receipt
   and cursor schemas, with no-store responses and existing rate/concurrency
   controls. Do not expose prompts, credentials or provider errors in discovery,
   launch metadata, logs or another grant's events.
6. Exercise 401/403/400/429, recipient/account isolation, CAS conflicts, disabled
   and changed providers, permission revocation, duplicate operations, unknown
   completion, allowance exhaustion and actual bounded managed transport. Verify
   permission controls on web/desktop and mobile before declaring P1 complete.

This is the implementation contract, not a shipped inference feature. The launch
checkpoint has no provider-call endpoint and portable MCP remains unchanged.
