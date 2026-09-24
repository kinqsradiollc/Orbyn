import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  TEAM_AGENT_ACCESS,
  agentSettingsUpdate,
  type AgentSettings,
  type AgentsOverview,
  type NewAgentKey,
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
  createAgentKey,
  grantActivity,
  listGrants,
  restoreGrant,
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

  /** Admin: the switches for outside agents (kill switches L2-L4). */
  app.get("/admin/agents", async (r): Promise<AgentSettings> => {
    await authorize(r, "system:manage");
    invalidateSettings();
    return (await settings()).agents;
  });

  app.put("/admin/agents", async (r): Promise<AgentSettings> => {
    const u = await authorize(r, "system:manage");
    const d = agentSettingsUpdate.parse(r.body);
    const current = (await settings()).agents;
    await transaction(async (db) => {
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
}
