import { randomBytes } from "node:crypto";
import {
  AGENT_INBOX_KINDS,
  MAX_AGENT_RULES,
  agentInboxMutesInput,
  agentRuleInput,
  agentWakeInput,
  fail,
  type AgentInboxKind,
  type AgentInboxMutesInput,
  type AgentInboxSettings,
  type AgentRule,
  type AgentRuleInput,
  type AgentWakeInput,
  type NewAgentWake,
} from "@orbyn/core";
import { transaction, type Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { assertPublicUrl } from "../../lib/netguard.js";
import { encryptSecret } from "../../lib/secrets.js";

/**
 * Settings → Connected agents, for the inbox (H0): which kinds each
 * connection is sent, its wake-up address, and the person's standing rules
 * (plain words the agent follows; H8's profile page extends them).
 */

type SettingsRow = {
  inbox_mutes: string[];
  wake_url: string | null;
  last_status: number | null;
  last_error: string | null;
  sent_at: Date | null;
  unread: number;
};

/** A connection's inbox settings, or null when it isn't the person's. */
export async function inboxSettings(
  db: Queryable,
  userId: string,
  grantId: string,
): Promise<AgentInboxSettings | null> {
  const row = (
    await db.query<SettingsRow>(
      `SELECT g.inbox_mutes, g.wake_url, w.last_status, w.last_error, w.sent_at,
              (SELECT count(*)::int FROM agent_inbox i
                WHERE i.grant_id = g.id AND ${OPEN_ITEM("i")}) AS unread
         FROM agent_grants g
         LEFT JOIN agent_wakes w ON w.grant_id = g.id
        WHERE g.id = $1 AND g.user_id = $2 AND g.revoked_at IS NULL`,
      [grantId, userId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    muted: AGENT_INBOX_KINDS.filter((k) => row.inbox_mutes.includes(k)),
    wake_url: row.wake_url,
    wake_last_status: row.last_status,
    wake_last_error: row.last_error,
    wake_last_sent_at: row.sent_at?.toISOString() ?? null,
    unread: row.unread,
  };
}

/** SQL: an item not yet dealt with (new, or snoozed until now). */
export const OPEN_ITEM = (alias: string) =>
  `(${alias}.state = 'new' OR (${alias}.state = 'snoozed' AND ${alias}.snooze_until <= now()))`;

/** Locks the person's own connection for a change, or fails with 404. */
async function ownGrant(db: Queryable, userId: string, grantId: string) {
  const row = (
    await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM agent_grants
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL FOR UPDATE`,
      [grantId, userId],
    )
  ).rows[0];
  if (!row) fail(404, "Connection not found");
  return row;
}

/** Which kinds a connection is not sent ("Send to this agent" off). */
export async function setInboxMutes(
  userId: string,
  grantId: string,
  input: AgentInboxMutesInput,
  requestId?: string,
): Promise<AgentInboxSettings> {
  const d = agentInboxMutesInput.parse(input);
  const muted: AgentInboxKind[] = AGENT_INBOX_KINDS.filter((k) =>
    d.muted.includes(k),
  );
  return transaction(async (db) => {
    const g = await ownGrant(db, userId, grantId);
    await db.query("UPDATE agent_grants SET inbox_mutes = $2 WHERE id = $1", [
      g.id,
      muted,
    ]);
    await audit(
      {
        actorId: userId,
        action: "agent_grant.inbox_mutes",
        targetType: "agent_grant",
        targetId: g.id,
        details: { name: g.name, muted },
        requestId,
      },
      db,
    );
    return (await inboxSettings(db, userId, g.id))!;
  });
}

/**
 * The wake-up address ("Wake this agent when something happens"): an https
 * address on the public internet, checked like a webhook's. A new signing
 * secret is made each time and shown once.
 */
export async function setWake(
  userId: string,
  grantId: string,
  input: AgentWakeInput,
  requestId?: string,
): Promise<NewAgentWake> {
  const d = agentWakeInput.parse(input);
  await assertPublicUrl(d.url);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const sealed = await encryptSecret(secret);
  return transaction(async (db) => {
    const g = await ownGrant(db, userId, grantId);
    await db.query(
      `UPDATE agent_grants SET wake_url = $2, wake_secret_encrypted = $3
        WHERE id = $1`,
      [g.id, d.url, sealed],
    );
    await db.query(
      `INSERT INTO agent_wakes (grant_id) VALUES ($1)
       ON CONFLICT (grant_id) DO UPDATE SET due_at = NULL, attempts = 0,
         last_status = NULL, last_error = NULL`,
      [g.id],
    );
    await audit(
      {
        actorId: userId,
        action: "agent_grant.wake_set",
        targetType: "agent_grant",
        targetId: g.id,
        details: { name: g.name, host: new URL(d.url).host },
        requestId,
      },
      db,
    );
    return { settings: (await inboxSettings(db, userId, g.id))!, secret };
  });
}

/** No more wake-ups for a connection. */
export async function clearWake(
  userId: string,
  grantId: string,
  requestId?: string,
): Promise<AgentInboxSettings> {
  return transaction(async (db) => {
    const g = await ownGrant(db, userId, grantId);
    await db.query(
      `UPDATE agent_grants SET wake_url = NULL, wake_secret_encrypted = NULL
        WHERE id = $1`,
      [g.id],
    );
    await db.query("DELETE FROM agent_wakes WHERE grant_id = $1", [g.id]);
    await audit(
      {
        actorId: userId,
        action: "agent_grant.wake_cleared",
        targetType: "agent_grant",
        targetId: g.id,
        details: { name: g.name },
        requestId,
      },
      db,
    );
    return (await inboxSettings(db, userId, g.id))!;
  });
}

// --- Standing rules ----------------------------------------------------------

type RuleRow = {
  id: string;
  kind: AgentInboxKind | null;
  text: string;
  created_at: Date;
  updated_at: Date;
};

const ruleView = (r: RuleRow): AgentRule => ({
  id: r.id,
  kind: r.kind,
  text: r.text,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

/** The person's standing rules, oldest first. */
export async function listRules(
  db: Queryable,
  userId: string,
): Promise<AgentRule[]> {
  return (
    await db.query<RuleRow>(
      `SELECT id, kind, text, created_at, updated_at FROM agent_rules
        WHERE user_id = $1 ORDER BY created_at, id LIMIT $2`,
      [userId, MAX_AGENT_RULES],
    )
  ).rows.map(ruleView);
}

export async function addRule(
  userId: string,
  input: AgentRuleInput,
): Promise<AgentRule> {
  const d = agentRuleInput.parse(input);
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `agent_rules:${userId}`,
    ]);
    const n = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM agent_rules WHERE user_id = $1",
        [userId],
      )
    ).rows[0].n;
    if (n >= MAX_AGENT_RULES)
      fail(409, `You can have up to ${MAX_AGENT_RULES} rules.`);
    return ruleView(
      (
        await db.query<RuleRow>(
          `INSERT INTO agent_rules (user_id, kind, text) VALUES ($1, $2, $3)
           RETURNING id, kind, text, created_at, updated_at`,
          [userId, d.kind, d.text],
        )
      ).rows[0],
    );
  });
}

export async function updateRule(
  db: Queryable,
  userId: string,
  id: string,
  input: AgentRuleInput,
): Promise<AgentRule> {
  const d = agentRuleInput.parse(input);
  const row = (
    await db.query<RuleRow>(
      `UPDATE agent_rules SET kind = $3, text = $4, updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, kind, text, created_at, updated_at`,
      [id, userId, d.kind, d.text],
    )
  ).rows[0];
  if (!row) fail(404, "Rule not found");
  return ruleView(row);
}

export async function deleteRule(db: Queryable, userId: string, id: string) {
  const gone = await db.query(
    "DELETE FROM agent_rules WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!gone.rowCount) fail(404, "Rule not found");
}
