import { randomBytes } from "node:crypto";
import {
  AGENT_KEY_CLIENT_ID,
  AGENT_KEY_PREFIX,
  LEGACY_KEY_CLIENT_ID,
  fail,
  type AgentAccess,
  type AgentActivity,
  type AgentGrant,
  type AgentGrantKind,
  type AgentKeyInput,
  type AgentOutcome,
  type AgentToolset,
  agentKeyInput,
} from "@orbyn/core";
import { pool, transaction, type Db, type Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { digest } from "../../lib/auth.js";
import { settings } from "../../lib/settings.js";
import { emailEnabled } from "../../worker/channels/email.js";
import { announceTo } from "../presence/live.js";

/**
 * Connections for outside agents: agent keys made in Settings, old personal
 * API keys used over MCP (legacy), and (phase A2) OAuth sign-ins. One list,
 * one activity log and one revoke for all of them.
 */

/** At most this many live connections per person. */
export const MAX_GRANTS = 50;

type GrantRow = {
  id: string;
  kind: AgentGrantKind;
  name: string;
  client_name: string;
  access: AgentAccess;
  personal: boolean;
  team_ids: string[] | null;
  toolsets: AgentToolset[];
  flags: { hide_outside_content?: boolean } | null;
  client_host: string | null;
  prefix: string | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  suspended_at: Date | null;
  created_at: Date;
};

const GRANT_COLUMNS = `g.id, g.kind, g.name, g.client_name, g.access, g.personal,
  g.team_ids, g.toolsets, g.flags, g.expires_at, g.last_used_at, g.suspended_at,
  g.created_at,
  (SELECT c.host FROM oauth_clients c WHERE c.id = g.client_id AND g.kind = 'oauth') AS client_host,
  (SELECT t.prefix FROM agent_tokens t WHERE t.grant_id = g.id AND t.kind = 'key' LIMIT 1) AS prefix`;

/** Team names for display, for the teams a person is in. */
async function teamNames(
  db: Queryable,
  userId: string,
): Promise<Map<string, string>> {
  return new Map(
    (
      await db.query<{ id: string; name: string }>(
        `SELECT t.id, t.name FROM teams t JOIN team_members m ON m.team_id = t.id
          WHERE m.user_id = $1`,
        [userId],
      )
    ).rows.map((t) => [t.id, t.name]),
  );
}

const view = (g: GrantRow, names: Map<string, string>): AgentGrant => ({
  id: g.id,
  kind: g.kind,
  name: g.name,
  client_name: g.client_name,
  access: g.access,
  personal: g.personal,
  team_ids: g.team_ids,
  teams: (g.team_ids ?? [...names.keys()])
    .filter((id) => names.has(id))
    .map((id) => ({ id, name: names.get(id)! })),
  toolsets: g.toolsets,
  hide_outside_content: !!g.flags?.hide_outside_content,
  client_host: g.client_host ?? null,
  prefix: g.prefix,
  expires_at: g.expires_at?.toISOString() ?? null,
  last_used_at: g.last_used_at?.toISOString() ?? null,
  suspended_at: g.suspended_at?.toISOString() ?? null,
  created_at: g.created_at.toISOString(),
});

/**
 * Connections still listed: not revoked, and not expired for more than 30
 * days (as long as their credentials are kept, the list says they expired).
 */
const LISTED = `g.revoked_at IS NULL
  AND (g.kind <> 'oauth' OR g.authorized_at IS NOT NULL)
  AND (g.expires_at IS NULL OR g.expires_at > now() - interval '30 days')`;

/** Connections that count against MAX_GRANTS: not revoked and not expired. */
const LIVE = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;

/** The person's connections that haven't ended, newest first. */
export async function listGrants(
  db: Queryable,
  userId: string,
): Promise<AgentGrant[]> {
  const [rows, names] = await Promise.all([
    db.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS} FROM agent_grants g
        WHERE g.user_id = $1 AND ${LISTED}
          AND (g.kind <> 'legacy' OR EXISTS (SELECT 1 FROM api_keys k WHERE k.id = g.api_key_id))
        ORDER BY g.created_at DESC LIMIT 100`,
      [userId],
    ),
    teamNames(db, userId),
  ]);
  return rows.rows.map((g) => view(g, names));
}

/** One connection as the list shows it, or null when it's not the person's. */
export async function grantView(
  db: Queryable,
  userId: string,
  grantId: string,
): Promise<AgentGrant | null> {
  const [row, names] = await Promise.all([
    db.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS} FROM agent_grants g WHERE g.id = $1 AND g.user_id = $2`,
      [grantId, userId],
    ),
    teamNames(db, userId),
  ]);
  return row.rows[0] ? view(row.rows[0], names) : null;
}

/**
 * Tells every copy of every service that agent access changed (a
 * connection revoked or paused, a person signed out everywhere, an app
 * blocked, a team's policy changed), on the orbyn_auth channel, so caches
 * clear at once. Inside a transaction it's sent on commit, and never if
 * it rolls back.
 */
export async function announceAuthChange(
  db: Queryable,
  change: {
    grants?: string[];
    users?: string[];
    clients?: string[];
    teams?: string[];
    reason: string;
  },
): Promise<void> {
  const payload = JSON.stringify({
    ...change,
    grants: change.grants?.slice(0, 200),
    users: change.users?.slice(0, 200),
  });
  await db.query("SELECT pg_notify('orbyn_auth', $1)", [payload]);
}

/**
 * A notice about outside agents: in the app, on the person's phones, and
 * (for anything about their security) by email, delivered by the notifier.
 */
export async function noticeAgentEvent(
  db: Queryable,
  userId: string,
  n: { ref: string; title: string; body: string; email?: boolean },
): Promise<void> {
  const email = !!n.email && (await emailEnabled());
  await db.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref)
     SELECT u.id, NULL, 0, c.channel, c.destination, $2, $3,
       CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'agent', $4
     FROM users u
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
       UNION ALL SELECT 'email', u.email WHERE $5::boolean
     ) c
     WHERE u.id = $1 AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [
      userId,
      n.title.slice(0, 200),
      n.body.slice(0, 2000),
      n.ref.slice(0, 200),
      email,
    ],
  );
  await announceTo(db as never, { user_id: userId }, "changed");
}

/** Why connections were ended in bulk. */
export type RevokeReason =
  "password_reset" | "admin_sign_out" | "disabled" | "client_blocked" | "admin";

/**
 * Ends every live connection a person has (by `userId`), or every one an
 * app has (by `clientId`): their credentials go at once, what they did
 * stays, and every copy is told (orbyn_auth). Agent keys and sign-ins are
 * ended; an old API key's MCP access is left to the key itself (it keeps
 * working with the REST API, so ending it here would protect nothing).
 * Returns how many ended.
 */
export async function revokeConnections(
  db: Db,
  where: { userId?: string; clientId?: string },
  reason: RevokeReason,
  actorId: string | null,
  requestId?: string,
): Promise<number> {
  if (!where.userId && !where.clientId) return 0;
  const gone = (
    await db.query<{ id: string; user_id: string; kind: string; name: string }>(
      `UPDATE agent_grants SET revoked_at = now()
        WHERE revoked_at IS NULL AND kind IN ('oauth', 'key')
          AND ($1::uuid IS NULL OR user_id = $1)
          AND ($2::text IS NULL OR client_id = $2)
        RETURNING id, user_id, kind, name`,
      [where.userId ?? null, where.clientId ?? null],
    )
  ).rows;
  if (!gone.length) return 0;
  const ids = gone.map((g) => g.id);
  await db.query("DELETE FROM agent_tokens WHERE grant_id = ANY ($1::uuid[])", [
    ids,
  ]);
  for (const g of gone.slice(0, 100))
    await audit(
      {
        actorId,
        action: g.kind === "key" ? "agent_key.revoked" : "agent_grant.revoked",
        targetType: "agent_grant",
        targetId: g.id,
        details: { user_id: g.user_id, name: g.name, kind: g.kind, reason },
        requestId,
      },
      db,
    );
  if (gone.length > 100)
    await audit(
      {
        actorId,
        action: "agent_grant.revoked_many",
        targetType: where.clientId ? "oauth_client" : "user",
        targetId: where.clientId ?? where.userId ?? null,
        details: { count: gone.length, reason },
        requestId,
      },
      db,
    );
  await announceAuthChange(db, {
    grants: ids,
    users: where.userId ? [where.userId] : undefined,
    clients: where.clientId ? [where.clientId] : undefined,
    reason,
  });
  return gone.length;
}

/**
 * Makes an agent key: a connection of kind 'key' and its secret, shown this
 * once and kept only as a hash. Its teams must be the person's own, and it
 * lasts no longer than the admin's limit.
 */
export async function createAgentKey(
  userId: string,
  raw: AgentKeyInput,
  requestId?: string,
): Promise<{ grant: AgentGrant; key: string }> {
  const d = agentKeyInput.parse(raw);
  const { agents } = await settings();
  const names = await teamNames(pool, userId);
  const teamIds = [...new Set(d.team_ids)];
  if (teamIds.some((id) => !names.has(id))) fail(404, "Team not found");
  const days = Math.min(d.expires_in_days, agents.max_grant_days);
  const key = `${AGENT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const prefix = key.slice(0, 12);
  const grant = await transaction(async (db) => {
    const live = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM agent_grants WHERE user_id = $1 AND ${LIVE}`,
        [userId],
      )
    ).rows[0].n;
    if (live >= MAX_GRANTS)
      fail(
        409,
        `You can have up to ${MAX_GRANTS} connected agents. Revoke one first.`,
      );
    const row = (
      await db.query<GrantRow>(
        `INSERT INTO agent_grants
           (user_id, kind, client_id, client_name, name, access, team_ids,
            personal, toolsets, flags, expires_at)
         VALUES ($1, 'key', $2, 'Agent key', $3, $4, $5, $6, $7, $9,
                 now() + make_interval(days => $8::int))
         RETURNING id, kind, name, client_name, access, personal, team_ids,
                   toolsets, flags, expires_at, last_used_at, suspended_at,
                   created_at, NULL AS client_host, NULL AS prefix`,
        [
          userId,
          AGENT_KEY_CLIENT_ID,
          d.name,
          d.access,
          teamIds,
          d.personal,
          [...new Set(d.toolsets)],
          days,
          { hide_outside_content: d.hide_outside_content },
        ],
      )
    ).rows[0];
    await db.query(
      `INSERT INTO agent_tokens (token_hash, grant_id, kind, prefix, expires_at)
       VALUES ($1, $2, 'key', $3, $4)`,
      [digest(key), row.id, prefix, row.expires_at],
    );
    await audit(
      {
        actorId: userId,
        action: "agent_key.created",
        targetType: "agent_grant",
        targetId: row.id,
        details: {
          user_id: userId,
          name: row.name,
          prefix,
          access: row.access,
          personal: row.personal,
          team_ids: teamIds,
          hide_outside_content: d.hide_outside_content,
          expires_at: row.expires_at?.toISOString() ?? null,
        },
        requestId,
      },
      db,
    );
    return { ...row, prefix };
  });
  return { grant: view(grant, names), key };
}

/**
 * Ends a connection: it stops working on the next call (and within seconds
 * on every other copy), its credentials are deleted, and it leaves the
 * list. What it did stays in its activity log. Audited.
 */
export async function revokeGrant(
  userId: string,
  grantId: string,
  actorId: string,
  reason = "revoked",
  requestId?: string,
): Promise<void> {
  await transaction(async (db) => {
    const gone = (
      await db.query<{ id: string; kind: string; name: string }>(
        `UPDATE agent_grants SET revoked_at = now()
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
          RETURNING id, kind, name`,
        [grantId, userId],
      )
    ).rows[0];
    if (!gone) fail(404, "Connection not found");
    await db.query("DELETE FROM agent_tokens WHERE grant_id = $1", [grantId]);
    await announceAuthChange(db, { grants: [grantId], reason });
    await audit(
      {
        actorId,
        action:
          gone.kind === "key" ? "agent_key.revoked" : "agent_grant.revoked",
        targetType: "agent_grant",
        targetId: gone.id,
        details: { user_id: userId, name: gone.name, kind: gone.kind, reason },
        requestId,
      },
      db,
    );
  });
}

/** Why Orbyn paused a connection by itself. */
export type SuspendReason = "rate_limit" | "probing";

/**
 * Pauses a connection that misbehaves (it keeps going over its limits, or
 * keeps asking for things it can't reach), until its person restores it in
 * Settings → Connected agents. Audited. false when it was already paused,
 * revoked or gone.
 */
export async function suspendGrant(
  grantId: string,
  reason: SuspendReason,
): Promise<boolean> {
  return transaction(async (db) => {
    const row = (
      await db.query<{ id: string; user_id: string; name: string }>(
        `UPDATE agent_grants SET suspended_at = now()
          WHERE id = $1 AND suspended_at IS NULL AND revoked_at IS NULL
          RETURNING id, user_id, name`,
        [grantId],
      )
    ).rows[0];
    if (!row) return false;
    await announceAuthChange(db, { grants: [row.id], reason: "suspended" });
    await noticeAgentEvent(db, row.user_id, {
      ref: `grant:${row.id}`,
      title: `Orbyn paused “${row.name}”`,
      body:
        reason === "rate_limit"
          ? "It kept going over its limits. Check its activity in Settings → Connected agents, then restore it or disconnect it."
          : "It kept asking for things it can’t reach. Check its activity in Settings → Connected agents, then restore it or disconnect it.",
    });
    await audit(
      {
        actorId: null,
        action: "agent_grant.suspended",
        targetType: "agent_grant",
        targetId: row.id,
        details: { user_id: row.user_id, name: row.name, reason },
      },
      db,
    );
    return true;
  });
}

/** Restores a connection Orbyn paused. Audited; 404 when it isn't theirs. */
export async function restoreGrant(
  userId: string,
  grantId: string,
  requestId?: string,
): Promise<void> {
  await transaction(async (db) => {
    const row = (
      await db.query<{ id: string; name: string; was: Date | null }>(
        `UPDATE agent_grants g SET suspended_at = NULL
           FROM (SELECT id, suspended_at FROM agent_grants WHERE id = $1 FOR UPDATE) old
          WHERE g.id = old.id AND g.user_id = $2 AND g.revoked_at IS NULL
          RETURNING g.id, g.name, old.suspended_at AS was`,
        [grantId, userId],
      )
    ).rows[0];
    if (!row) fail(404, "Connection not found");
    if (row.was)
      await audit(
        {
          actorId: userId,
          action: "agent_grant.restored",
          targetType: "agent_grant",
          targetId: row.id,
          details: { user_id: userId, name: row.name },
          requestId,
        },
        db,
      );
  });
}

/**
 * The legacy connection for an old personal API key used over MCP: made on
 * first use, then reused. It reaches Personal and every team, reads and
 * writes (risky changes still go to review), until the 90 days end.
 * `revoked` when the person disconnected it from agents.
 */
export async function legacyGrant(
  userId: string,
  keyId: string,
  keyName: string,
): Promise<{ id: string; revoked: boolean }> {
  const find = () =>
    pool.query<{ id: string; revoked_at: Date | null }>(
      "SELECT id, revoked_at FROM agent_grants WHERE api_key_id = $1",
      [keyId],
    );
  let row = (await find()).rows[0];
  if (!row) {
    await pool.query(
      `INSERT INTO agent_grants
         (user_id, kind, client_id, client_name, name, access, team_ids,
          personal, toolsets, api_key_id)
       VALUES ($1, 'legacy', $2, 'Personal API key', $3, 'write', NULL, true,
               '{core}', $4)
       ON CONFLICT (api_key_id) WHERE api_key_id IS NOT NULL DO NOTHING`,
      [userId, LEGACY_KEY_CLIENT_ID, keyName, keyId],
    );
    row = (await find()).rows[0];
  }
  return { id: row.id, revoked: !!row.revoked_at };
}

/** One connection's activity, newest first (only the person's own). */
export async function grantActivity(
  db: Queryable,
  userId: string,
  grantId: string,
): Promise<AgentActivity[]> {
  const owns = (
    await db.query(
      "SELECT 1 FROM agent_grants WHERE id = $1 AND user_id = $2",
      [grantId, userId],
    )
  ).rowCount;
  if (!owns) fail(404, "Connection not found");
  return (
    await db.query<{
      id: string;
      at: Date;
      tool: string;
      outcome: AgentOutcome;
      summary: string;
      calls: number;
      target_ids: string[];
    }>(
      `SELECT id::text, at, tool, outcome, summary, calls, target_ids
         FROM agent_activity WHERE grant_id = $1 AND user_id = $2
        ORDER BY at DESC, id DESC LIMIT 100`,
      [grantId, userId],
    )
  ).rows.map((a) => ({ ...a, at: a.at.toISOString() }));
}
