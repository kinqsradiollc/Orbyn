# Plugin backend

The plugin service authenticates its own OAuth recipient independently of browser
sessions and the portable MCP recipient. It reuses authorized domain capabilities.

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
