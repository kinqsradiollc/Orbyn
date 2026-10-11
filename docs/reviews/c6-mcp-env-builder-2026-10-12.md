# C6 MCP environment update — 12 October 2026

Candidate: `b636deb9`; `.env.example` documentation/configuration only.
The primary checkout's private `.env.production` remains ignored and uncommitted.

| Production setting | Result |
| --- | --- |
| `MCP_PUBLIC_URL` | Preserved: `https://mcp.orbyn.dev/mcp` |
| `PLUGIN_PUBLIC_URL` | Preserved: `https://mcp.orbyn.dev/plugin` |
| `MCP_WORKSPACE_AI_ENABLED` | Changed from `false` to `true` |
| `COMPOSE_PROFILES` | Preserved; includes `plugin` |

Builder parsed the complete private file before and after the flag edit and
asserted every other variable value was identical. Subsequent comment edits
were separately checked to preserve every parsed value. All four settings have
one active assignment. No credential value was printed or committed.

The canonical example and the primary checkout's existing example received the
same targeted MCP edits; unrelated primary changes were preserved. Example
inference remains opt-in (`false`) with explicit server enablement instructions.
`git diff --check` passed on the frozen corrected example. No runtime code changed.

Copy the private production file to the test server's runtime `.env`, keeping
server-specific values appropriate there. Deploy using the current main script.
Then explicitly allow **Workspace AI** for the canonical connection with its
provider/model and allowance, and refresh host tools. Advertising a request tool
does not grant provider permission or establish live C6 qualification.
