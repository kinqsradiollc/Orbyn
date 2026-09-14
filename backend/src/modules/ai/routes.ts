import type { FastifyInstance } from "fastify";
import { actionSchema, chatRequest, fail } from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { audit } from "../../lib/audit.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { mutate } from "../items/service.js";
import { askProvider } from "./provider.js";
import { resolveAi } from "./providers/resolve.js";

/**
 * Propose-then-approve assistant. `/ai/chat` stores a proposal; nothing changes
 * until the user calls `/ai/proposals/:id/apply`, which runs atomically.
 */
export async function aiRoutes(app: FastifyInstance) {
  app.post("/ai/chat", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    const d = chatRequest.parse(r.body);
    const ai = await resolveAi();
    if (!ai)
      fail(
        503,
        "AI is not configured. An admin can choose a provider in the admin console, or set AI_BASE_URL, AI_MODEL and AI_API_KEY on the server.",
      );
    const items = (
      await reader(r.headers).query(
        `SELECT i.*, t.name AS team_name FROM items i LEFT JOIN teams t ON t.id=i.team_id
         WHERE ${VISIBLE_ITEMS} ORDER BY i.updated_at DESC LIMIT 100`,
        [u.id],
      )
    ).rows;
    const response = await askProvider(
      ai,
      d.message,
      d.timezone,
      items,
      d.history,
      r.log,
    );
    const p = (
      await pool.query(
        "INSERT INTO proposals(user_id,actions) VALUES($1,$2) RETURNING id",
        [u.id, JSON.stringify(response.actions)],
      )
    ).rows[0];
    return { id: p.id, ...response };
  });

  app.post("/ai/proposals/:id/apply", async (r) => {
    const u = await authenticate(r);
    return transaction(async (db) => {
      const p = (
        await db.query(
          "SELECT * FROM proposals WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [idParam(r), u.id],
        )
      ).rows[0];
      if (!p) fail(404, "Proposal not found");
      if (p.applied) return { applied: true };
      if (p.expires_at <= new Date())
        fail(409, "Proposal expired. Ask the assistant again.");
      for (const raw of p.actions) await mutate(db, u, actionSchema.parse(raw));
      await db.query("UPDATE proposals SET applied=true WHERE id=$1", [p.id]);
      await audit(
        {
          actorId: u.id,
          action: "ai.proposal_applied",
          targetType: "proposal",
          targetId: p.id,
          details: { actions: p.actions.length },
        },
        db,
      );
      return { applied: true };
    });
  });
}
