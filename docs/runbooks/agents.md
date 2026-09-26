# Runbook: outside agents (MCP)

What to do when an outside AI agent misbehaves, or something is wrong with the MCP address (`https://mcp.orbyn.dev/mcp`). Orbyn is hosted; everything here is done by Orbyn's own administrators.

## Kill switches

Four levels, from one connection to everything. None needs a deploy: L1 to L4 in Admin take effect at once on the copy that saved them and within 10 seconds everywhere (settings are re-read every 10 s; revocations are also sent on `orbyn_auth`, so every copy drops them at once). Open listen streams close when their connection is touched.

| Level | What it stops                             | Where                                                                                                                                                                                             | What the agent sees                                                            |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| L1    | One connection                            | The person: Settings → Connected agents → Disconnect. An admin: Admin → Users → the person → disconnect one agent, or Sign out everywhere (ends all of theirs).                                   | `401` with a sign-in challenge; the key or token never works again             |
| L2    | One app (every person's connection to it) | Admin → Agents → Apps → Block. Agent keys and old API keys each count as one app (`orbyn-agent-key`, `orbyn-legacy-key`). "Only allow apps from these websites" narrows sign-ins to listed hosts. | `403`; unblocking brings keys back, signed-in apps sign in again               |
| L3    | Every agent's changes (reads go on)       | Admin → Agents → "Let agents make changes" off                                                                                                                                                    | Each change: `READ_ONLY` ("Changes by outside agents are paused…"); reads work |
| L4    | Every agent                               | Admin → Agents → "Outside agents" off. If the service itself is in trouble: `MCP_DISABLED=1` on the gateway and restart it                                                                        | `503` with `Retry-After` (the gateway's answers even with every mcp copy down) |

Automatic pauses (no one needs to act): a connection is paused, and its person told and offered a restore in Settings → Connected agents, on refresh-token reuse (by email too), more than 5 limit breaches in 10 minutes, or more than 50 refusals (`NOT_FOUND`/`FORBIDDEN`) in 10 minutes. See `backend/src/modules/mcp-server/limits.ts` and `backend/src/modules/oauth/tokens.ts`. (A pause on read volume far above a connection's usual is planned, not built.)

Maintenance mode (Admin → System) also pauses agents' changes, like L3, with its own message.

## Detection

- **Admin → Agents**: calls by app over 30 days, pauses and refusals. A sudden app, or refusals climbing, is the usual first sign.
- **Admin → Requests**: every agent call is labelled `mcp:<tool>` (or `mcp:<method>`, `mcp:subscriptions/listen`) with its status and time, and no IP address.
- **Notices**: people get an email and a notice for every new connection and every pause; team owners hear the first time an agent uses their team.
- **The status page** probes the mcp service (`STATUS_MCP_URL`).

## Forensics

Everything an agent did joins on the request id (the gateway's `X-Request-Id`, kept by every service):

```sql
-- What one connection did, newest first (kept 180 days).
SELECT at, tool, tier, outcome, summary, target_ids, proposal_id, request_id
  FROM agent_activity WHERE grant_id = $1 ORDER BY at DESC LIMIT 200;

-- The requests behind it (kept 7 days by default).
SELECT l.at, l.service, l.route, l.status, l.duration_ms
  FROM request_log l
  JOIN agent_activity a ON a.request_id = l.request_id
 WHERE a.grant_id = $1 ORDER BY l.at DESC;

-- Who granted, changed, paused or revoked it, and admin switch changes.
SELECT created_at, actor_id, action, target_type, target_id, details
  FROM audit_log
 WHERE (target_type = 'agent_grant' AND target_id = $1::text)
    OR action LIKE 'agents.%'
 ORDER BY created_at DESC;
```

`agent_activity.args_digest` is a hash of the arguments (never their content); `summary` is one redacted line. Project timelines and page history record which connection acted (`via_grant_id`), so a page's or project's own history shows the agent's changes.

## Recovery

1. Stop it at the lowest level that holds (L1 for one person, L2 for one app, L3 while you look, L4 if you must).
2. Undo: each change an agent made directly keeps its before-values for 30 days. The person (or an admin with them) uses Settings → Connected agents → the connection's activity → Undo, change by change or all since a time. Pages also have their version history, and projects their time machine.
3. Anything still waiting in Review inboxes from that connection is cancelled when it's disconnected.
4. Restore: turn the switch back on; unblock the app. A paused connection is restored by its person.

## Telling people

- One person: a pause already tells them (in the app; by email for refresh-token reuse). If you ended their connections, write to them: what happened, when, what the agent could reach, what was undone, and that they can connect again in Settings → Connected agents.
- Everyone (L3 or L4 for more than a few minutes): an announcement in Admin → System ("Outside agents are paused while we look into a problem. Orbyn itself works as usual."), and the status page.
- A breach of personal data follows the Privacy Policy's notification duties; the forensics above give the scope.

## Game day

Before any directory listing, and twice a year after:

1. On staging, as an admin, make an agent key with write access for yourself (Settings → Connected agents).
2. Run the drills (each switch pulled, checked, timed, and put back; the key is revoked at the end):

   ```bash
   GAMEDAY_URL=https://staging.orbyn.dev GAMEDAY_ADMIN_TOKEN=<your session token> \
   GAMEDAY_AGENT_KEY=oak_… GAMEDAY_GRANT_ID=<the key's id> npm run gameday -w backend
   ```

   Every line must say PASS, each within about 10 seconds (the settings cache).

3. By hand: set `MCP_DISABLED=1` on the staging gateway, restart it, check `POST https://<mcp host>/mcp` answers `503` with the JSON-RPC error, then unset it and restart.
4. Open a listen stream (`subscriptions/listen`) with a second key and revoke that key: the stream must end at once with its `complete` result.
5. Write down the times and anything that surprised you here.

CI runs the same drills in one process on every build (`backend/tests/mcp-directory.test.ts`, via `localGameDay`).

## Old personal API keys

`ok_` keys work on MCP as a legacy connection for 90 days after agent access arrived (the date is in Admin → Agents). After that date they are refused on MCP with a message pointing to agent keys, with no deploy or switch; they keep working with the REST API and CalDAV. The "Old personal API keys reach agents" switch turns them off early (it is L2 for that one app).
