import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AGENT_KEY_CLIENT_ID,
  LEGACY_KEY_CLIENT_ID,
  TEAM_AGENT_ACCESS,
  agentSettingsUpdate,
  fail,
  hasTeamPermission,
  type AdminAgentClient,
  type AdminAgentUsage,
  type AgentSettings,
  type AgentsOverview,
  type NewAgentKey,
  type TeamAgentsView,
  type TeamRole,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { reader, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authenticate, authorize } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import {
  AGENT_SETTING_KEYS,
  invalidateSettings,
  settings,
} from "../../lib/settings.js";
import { requireTeam } from "../../lib/teams.js";
import {
  announceAuthChange,
  createAgentKey,
  grantActivity,
  listGrants,
  restoreGrant,
  revokeConnections,
  revokeGrant,
} from "./service.js";

/**
 * Settings → Connected agents (the person's own connections), the admin's
 * switches for outside agents, and a team's agent policy. Only a signed-in
 * person reaches these: personal API keys are refused (KEY_BLOCKED) and
 * agent credentials never authenticate here.
 */
export async function agentRoutes(app: FastifyInstance) {
  app.get("/me/agents", async (r): Promise<AgentsOverview> => {
    const u = await authenticate(r);
    const s = await settings();
    const until = s.legacy_keys_until;
    return {
      mcp_url: env.MCP_PUBLIC_URL,
      legacy_keys_until: until && Date.parse(until) > Date.now() ? until : null,
      grants: await listGrants(reader(r.headers), u.id),
    };
  });

  // The key is shown once; only its hash is kept.
  app.post(
    "/me/agent-keys",
    strictRateLimit,
    async (r, reply): Promise<NewAgentKey> => {
      const u = await authenticate(r);
      const made = await createAgentKey(u.id, r.body as never, r.id);
      reply.code(201);
      return made;
    },
  );

  app.delete("/me/agents/:id", async (r, reply) => {
    const u = await authenticate(r);
    await revokeGrant(u.id, idParam(r), u.id, "revoked", r.id);
    return reply.code(204).send();
  });

  // A connection Orbyn paused for misbehaving works again.
  app.post("/me/agents/:id/restore", async (r, reply) => {
    const u = await authenticate(r);
    await restoreGrant(u.id, idParam(r), r.id);
    return reply.code(204).send();
  });

  app.get("/me/agents/:id/activity", async (r) => {
    const u = await authenticate(r);
    return grantActivity(reader(r.headers), u.id, idParam(r));
  });

  /** A team's cap on outside agents: owners and admins set it. */
  app.put("/teams/:id/agent-access", async (r) => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const { agent_access } = z
      .object({ agent_access: z.enum(TEAM_AGENT_ACCESS) })
      .strict()
      .parse(r.body);
    await transaction(async (db) => {
      await requireTeam(teamId, u, "team:update", db);
      await db.query("UPDATE teams SET agent_access = $2 WHERE id = $1", [
        teamId,
        agent_access,
      ]);
      // Every copy re-reads the team's policy on the next call anyway; this
      // clears anything held for it at once.
      await announceAuthChange(db, { teams: [teamId], reason: "team_policy" });
      await audit(
        {
          actorId: u.id,
          action: "team.agent_access",
          targetType: "team",
          targetId: teamId,
          details: { agent_access },
        },
        db,
      );
    });
    return { id: teamId, agent_access };
  });

  /**
   * Team settings → Outside agents: the team's policy for everyone in it;
   * for owners and admins also which members' agents can reach it (by name
   * and app only) and when an agent first used it.
   */
  app.get("/teams/:id/agents", async (r): Promise<TeamAgentsView> => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const db = reader(r.headers);
    const team = (
      await db.query<{
        agent_access: TeamAgentsView["agent_access"];
        agent_first_used_at: Date | null;
        role: TeamRole | null;
      }>(
        `SELECT t.agent_access, t.agent_first_used_at,
                (SELECT m.role FROM team_members m WHERE m.team_id = t.id AND m.user_id = $2) AS role
           FROM teams t WHERE t.id = $1`,
        [teamId, u.id],
      )
    ).rows[0];
    if (!team?.role) fail(404, "Team not found");
    const manager = hasTeamPermission(team.role, "team:update");
    const connections = manager
      ? (
          await db.query<{
            member: string;
            app: string;
            kind: "oauth" | "key" | "legacy";
            last_used_at: Date | null;
          }>(
            `SELECT u.name AS member,
                    CASE WHEN g.kind = 'key' THEN 'Agent key “' || g.name || '”'
                         WHEN g.kind = 'legacy' THEN 'API key “' || g.name || '”'
                         ELSE coalesce(nullif(g.client_name, ''), 'An app') END AS app,
                    g.kind, g.last_used_at
               FROM agent_grants g
               JOIN users u ON u.id = g.user_id
               JOIN team_members m ON m.team_id = $1 AND m.user_id = g.user_id
              WHERE g.revoked_at IS NULL
                AND (g.expires_at IS NULL OR g.expires_at > now())
                AND (g.kind <> 'oauth' OR g.authorized_at IS NOT NULL)
                AND (g.team_ids IS NULL OR g.team_ids @> ARRAY[$1::uuid])
              ORDER BY g.last_used_at DESC NULLS LAST, lower(u.name) LIMIT 100`,
            [teamId],
          )
        ).rows.map((c) => ({
          ...c,
          last_used_at: c.last_used_at?.toISOString() ?? null,
        }))
      : null;
    return {
      agent_access: team.agent_access,
      first_used_at: team.agent_first_used_at?.toISOString() ?? null,
      connections,
    };
  });

  /** Admin: the switches for outside agents (kill switches L2-L4). */
  app.get("/admin/agents", async (r): Promise<AgentSettings> => {
    await authorize(r, "system:manage");
    invalidateSettings();
    return (await settings()).agents;
  });

  app.put("/admin/agents", async (r): Promise<AgentSettings> => {
    const u = await authorize(r, "system:manage");
    const d = agentSettingsUpdate.parse(r.body);
    invalidateSettings();
    const current = (await settings()).agents;
    // Apps blocked now: their sign-ins end at once. Agent keys and old API
    // keys are refused while blocked but kept (unblocking brings them back).
    const pseudo = new Set([AGENT_KEY_CLIENT_ID, LEGACY_KEY_CLIENT_ID]);
    const newlyBlocked = (d.blocked_client_ids ?? []).filter(
      (id) => !current.blocked_client_ids.includes(id) && !pseudo.has(id),
    );
    await transaction(async (db) => {
      if (d.blocked_client_ids) {
        await db.query(
          "UPDATE oauth_clients SET blocked = (id = ANY ($1::text[]))",
          [d.blocked_client_ids],
        );
        for (const id of newlyBlocked)
          await revokeConnections(
            db,
            { clientId: id },
            "client_blocked",
            u.id,
            r.id,
          );
        if (
          d.blocked_client_ids.length !== current.blocked_client_ids.length ||
          newlyBlocked.length
        )
          await announceAuthChange(db, {
            clients: d.blocked_client_ids,
            reason: "client_blocked",
          });
      }
      for (const key of AGENT_SETTING_KEYS) {
        if (d[key] === undefined) continue;
        const value =
          key === "agent_limits"
            ? { ...current.agent_limits, ...d.agent_limits }
            : d[key];
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by)
             VALUES ($1, $2, now(), $3)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now(), updated_by = $3`,
          [key, JSON.stringify(value), u.id],
        );
      }
      await audit(
        {
          actorId: u.id,
          action: "agents.settings_changed",
          targetType: "system",
          details: d,
        },
        db,
      );
    });
    invalidateSettings();
    return (await settings()).agents;
  });

  /** Admin → Agents: the apps that have signed in, and how many use each. */
  app.get("/admin/agents/clients", async (r): Promise<AdminAgentClient[]> => {
    await authorize(r, "system:manage");
    const { agents } = await settings();
    return (
      await reader(r.headers).query<
        Omit<AdminAgentClient, "created_at" | "last_used_at"> & {
          created_at: Date;
          last_used_at: Date | null;
        }
      >(
        `SELECT c.id, c.kind, c.name, c.host, c.blocked, c.created_at, c.last_used_at,
                (SELECT count(*) FROM agent_grants g
                  WHERE g.client_id = c.id AND g.revoked_at IS NULL
                    AND g.authorized_at IS NOT NULL
                    AND (g.expires_at IS NULL OR g.expires_at > now()))::int AS connections
           FROM oauth_clients c
          ORDER BY c.last_used_at DESC NULLS LAST, c.created_at DESC LIMIT 200`,
      )
    ).rows.map((c) => ({
      ...c,
      blocked: c.blocked || agents.blocked_client_ids.includes(c.id),
      created_at: c.created_at.toISOString(),
      last_used_at: c.last_used_at?.toISOString() ?? null,
    }));
  });

  /**
   * Admin → Agents: usage by app over the last `days` (1-90). People who
   * turned usage analytics off aren't counted.
   */
  app.get("/admin/agents/usage", async (r): Promise<AdminAgentUsage> => {
    await authorize(r, "analytics:read");
    const { days } = z
      .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
      .parse(r.query ?? {});
    const apps = (
      await reader(r.headers).query<AdminAgentUsage["apps"][number]>(
        `SELECT CASE WHEN g.kind = 'key' THEN 'Agent keys'
                     WHEN g.kind = 'legacy' THEN 'Personal API keys'
                     ELSE coalesce(nullif(g.client_name, ''), 'An app') END AS app,
                g.kind,
                count(DISTINCT g.id)::int AS connections,
                count(DISTINCT g.user_id)::int AS people,
                coalesce(sum(d.calls), 0)::int AS calls,
                coalesce(sum(d.writes), 0)::int AS writes,
                coalesce(sum(d.denied), 0)::int AS denied,
                coalesce(sum(d.limited), 0)::int AS limited
           FROM agent_usage_daily d
           JOIN agent_grants g ON g.id = d.grant_id
           JOIN users u ON u.id = g.user_id
          WHERE d.day > current_date - $1::int AND NOT u.analytics_opt_out
          GROUP BY 1, 2
          ORDER BY calls DESC LIMIT 50`,
        [days],
      )
    ).rows;
    return { days, apps };
  });
}
