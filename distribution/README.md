# Getting Orbyn listed where people find agents

Everything here is ready to publish or submit, and nothing here is published by the build. Orbyn is a hosted service: every listing points at `https://mcp.orbyn.dev/mcp`, and agents sign in with Orbyn (OAuth) or an agent key made in Settings → Connected agents.

The files marked _generated_ come from the capability registry (`npm run mcp:catalog -w backend`); CI fails until they match the server, so they never drift.

| Folder                                 | What                                                                                                                              | Who publishes it                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `mcp-registry/server.json` (generated) | The entry for the official MCP Registry, as `dev.orbyn/orbyn` (a remote server, nothing to install)                               | Owner, after the DNS check (below) |
| `claude-code/` (generated)             | A Claude Code plugin and one-plugin marketplace: `.mcp.json` plus the `orbyn` skill                                               | Owner: its own public repo         |
| `codex/` (generated)                   | Codex: `config.toml` for `~/.codex/config.toml`, a plugin manifest, `.mcp.json` and the `orbyn` skill                             | Owner: its own public repo         |
| `gemini/` (generated)                  | A Gemini CLI extension: `gemini-extension.json` and `GEMINI.md` (the skill)                                                       | Owner: its own public repo         |
| `directory/`                           | Material for Anthropic's Connectors Directory and OpenAI's apps directory: checklist, test cases, annotations audit, privacy text | Owner submits                      |

One-click install links for Cursor, VS Code, Goose and LM Studio are in the app (Settings → Connected agents → "Or add Orbyn in one click", on the web and in the mobile app) and come from `agentInstallLinks()` in `packages/core/src/agents.ts`. They carry only the address, never a key.

## The owner's steps

These need an outside party or Orbyn's own accounts, so they aren't done by the build.

1. **Pen test first.** An external penetration test of OAuth (`/api/oauth/*`, the consent page) and `/mcp`, before any listing. Fix what it finds, then run the game day (`docs/runbooks/agents.md`).
2. **Cloudflare.** Add the public hostname `mcp.orbyn.dev` to the tunnel, pointing at the gateway's port 8082 (`http://gateway:8082`). Skip WAF and bot challenges for `/mcp`, `/.well-known/*` and `/api/oauth/*`. Allow Anthropic's egress range `160.79.104.0/21` and OpenAI's published egress ranges. Make sure there is a public IPv4 `A` record and no redirect on the MCP address.
3. **MCP Registry.** Prove the `orbyn.dev` namespace with a DNS TXT record (`mcp-publisher login dns --domain orbyn.dev`, then add the record it prints), then `mcp-publisher publish` from `mcp-registry/`.
4. **Plugins.** Copy `claude-code/`, `codex/` and `gemini/` into three public repos (config and skill only; no Orbyn code). Check each manifest against the client's current plugin documentation before the first release (the formats are young and move).
5. **Directories.** Make the reviewer account on production (`DIRECTORY_EMAIL=… npm run directory:account -w backend` with `DATABASE_URL` set; it prints the password once, and refuses an address that already has an account; `DIRECTORY_RESET=1` resets the reviewer's own password later, never an admin's), then submit `directory/` to Anthropic and OpenAI. For OpenAI, set `OPENAI_APPS_CHALLENGE` to the token it gives (the MCP host answers it at `/.well-known/openai-apps-challenge`), and remove it after the check.
6. **Retiring old API keys on MCP** needs nothing: they stop working there on their date (shown in Admin → Agents), 90 days after agent access arrived. Keep them on until then for people still moving over; the switch in Admin → Agents turns them off early.
