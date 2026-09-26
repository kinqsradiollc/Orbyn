# Directory submission: Orbyn

For Anthropic's Connectors Directory and OpenAI's apps directory. The owner submits; everything they ask for is here.

## The listing

- **Name:** Orbyn
- **Server address:** `https://mcp.orbyn.dev/mcp` (Streamable HTTP; MCP `2026-07-28`, `2025-11-25` and `2025-06-18`)
- **Short description** and **long description:** in [privacy.md](privacy.md), at the end.
- **Category:** Productivity (planning, tasks, calendar, study).
- **Website:** https://orbyn.dev · **Developer docs:** https://orbyn.dev/developers/mcp (the same as `docs/mcp.md`)
- **Privacy Policy:** https://orbyn.dev/privacy · **Terms:** https://orbyn.dev/terms
- **Support and security contact:** https://orbyn.dev/.well-known/security.txt
- **Hosted:** yes. Orbyn is a hosted service. The agent uses its own model, and Orbyn runs no AI for it.

## Signing in

- OAuth 2.1 with PKCE (S256). Public clients: a client ID metadata document (preferred) or dynamic client registration. Protected-resource metadata at `https://mcp.orbyn.dev/.well-known/oauth-protected-resource/mcp`; the authorization server is `https://orbyn.dev` (`/.well-known/oauth-authorization-server`).
- Callbacks: `https://claude.ai/api/mcp/auth_callback` and `https://chatgpt.com/connector_platform_oauth_redirect` work as declared by the clients. `offline_access` is advertised, so access doesn't lapse.
- Scopes: `orbyn:read`, `orbyn:propose`, `orbyn:write`, `orbyn:bookings` and `offline_access`. The person chooses on Orbyn's consent page; write access asks for their password or passkey again.
- A call with no credential gets `401` with `WWW-Authenticate` (never an error result). A tool that needs more access gets `403 insufficient_scope` (ChatGPT: `_meta["mcp/www_authenticate"]` on the result, and every tool lists its `securitySchemes`).

## Reviewer account

Made with `npm run directory:account -w backend` (see `backend/scripts/directory-account.ts`): a member with a verified email, the Terms accepted, **no two-step sign-in**, and a week of a student's work (a Biology project, two tasks with deadlines, a lecture, a page of notes, an old task to try deleting). The password is printed once; give it to the directory with the submission, not in this repository.

## Test cases

[test-cases.md](test-cases.md): five prompts that should work and three that shouldn't. `backend/tests/mcp-directory.test.ts` runs all eight against the same account with no AI model involved, on every CI run.

## Tool annotations

[annotations.md](annotations.md): every tool's `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` next to what it really does and who decides. No tool reaches outside Orbyn (`openWorldHint` is false everywhere). CI keeps the audit free of issues.

## Safety, in one paragraph

An agent sees only what its person can open, in the spaces and toolsets the person chose, with each team's own cap (owners can turn agents off or down to reading). Deleting, anything that reaches other people, and anything in a space the connection may only suggest in waits for the signed-in person in Orbyn's Review inbox; no agent credential can approve it. Text from outside (imports, subscribed calendars, emails, booking answers) comes back fenced as untrusted and labelled with where it came from. Connections are limited per credential, paused automatically on abuse, and can be stopped at four levels without a deploy (`docs/runbooks/agents.md`).

## OpenAI's domain check

OpenAI asks for a token at `https://mcp.orbyn.dev/.well-known/openai-apps-challenge`. Set `OPENAI_APPS_CHALLENGE` to it (it answers `404` while unset), restart the mcp service, and clear it after the check.
