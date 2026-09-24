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
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { digest } from "../../lib/auth.js";
import { settings } from "../../lib/settings.js";

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
  prefix: string | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  suspended_at: Date | null;
  created_at: Date;
};

const GRANT_COLUMNS = `g.id, g.kind, g.name, g.client_name, g.access, g.personal,
  g.team_ids, g.toolsets, g.flags, g.expires_at, g.last_used_at, g.suspended_at,
  g.created_at,
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
                   created_at, NULL AS prefix`,
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
