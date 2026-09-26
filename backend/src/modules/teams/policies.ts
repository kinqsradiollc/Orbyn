import type { FastifyInstance } from "fastify";
import { teamPoliciesInput, type TeamPolicies } from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { idParam, writeRateLimit } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";

/**
 * A team's switches (OTH-04), shown together in its settings: publishing to
 * the web (SHR-05's switch), the assistant on team pages, and booking pages
 * for people outside. Every member can read them; owners and admins change
 * them. Each change is written to the audit log.
 */
export async function teamPolicyRoutes(app: FastifyInstance) {
  app.get("/teams/:id/policies", async (r): Promise<TeamPolicies> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { effective } = await requireTeam(id, u, "items:read");
    const row = (
      await pool.query<{
        publishing: boolean;
        assistant: boolean;
        booking: boolean;
      }>(
        `SELECT publishing_allowed AS publishing, assistant_allowed AS assistant,
                booking_allowed AS booking
           FROM teams WHERE id = $1`,
        [id],
      )
    ).rows[0];
    return {
      ...row,
      can_change: effective === "owner" || effective === "admin",
    };
  });

  app.put(
    "/teams/:id/policies",
    writeRateLimit,
    async (r): Promise<TeamPolicies> => {
      const u = await authenticate(r);
      const id = idParam(r);
      const d = teamPoliciesInput.parse(r.body ?? {});
      await requireTeam(id, u, "team:update");
      const row = await transaction(async (db) => {
        const saved = (
          await db.query<{
            publishing: boolean;
            assistant: boolean;
            booking: boolean;
          }>(
            `UPDATE teams SET
             publishing_allowed = coalesce($2, publishing_allowed),
             assistant_allowed = coalesce($3, assistant_allowed),
             booking_allowed = coalesce($4, booking_allowed)
           WHERE id = $1
           RETURNING publishing_allowed AS publishing,
                     assistant_allowed AS assistant, booking_allowed AS booking`,
            [id, d.publishing ?? null, d.assistant ?? null, d.booking ?? null],
          )
        ).rows[0];
        for (const key of ["publishing", "assistant", "booking"] as const)
          if (d[key] !== undefined)
            await audit(
              {
                actorId: u.id,
                action: `team.${key}_${d[key] ? "on" : "off"}`,
                targetType: "team",
                targetId: id,
                details: {},
              },
              db,
            );
        return saved;
      });
      return { ...row, can_change: true };
    },
  );
}
