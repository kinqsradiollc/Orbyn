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
