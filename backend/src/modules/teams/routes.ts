import type { FastifyInstance } from "fastify";
import {
  memberInput,
  memberRoleInput,
  teamInput,
  type Team,
} from "@orbyn/core";
import { z } from "zod";
import { reader, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { syncTeamPages } from "../study/service.js";
import {
  addMember,
  changeRole,
  createTeam,
  removeMember,
  renameTeam,
} from "./admin.js";
import { TEAM_COLUMNS, teamMembers, teamSummary } from "./service.js";

export async function teamRoutes(app: FastifyInstance) {
  app.get("/teams", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<Team>(
        `SELECT ${TEAM_COLUMNS}, m.role FROM teams t
         JOIN team_members m ON m.team_id=t.id AND m.user_id=$1
         ORDER BY lower(t.name), t.id`,
        [u.id],
      )
    ).rows;
  });

  app.post("/teams", async (r, reply) => {
    const u = await authenticate(r);
    const d = teamInput.parse(r.body);
    const team = await transaction((db) => createTeam(db, u, d.name));
    reply.code(201);
    return team;
  });

  app.get("/teams/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await requireTeam(id, u, "team:view");
    return { ...(await teamSummary(id, u.id)), members: await teamMembers(id) };
  });

  app.put("/teams/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = teamInput.parse(r.body);
    return transaction(async (db) => {
      await renameTeam(db, u, id, d.name);
      return teamSummary(id, u.id, db);
    });
  });

  app.delete("/teams/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      const team = await requireTeam(id, u, "team:delete", db);
      await db.query("DELETE FROM teams WHERE id=$1", [id]);
      await audit(
        {
          actorId: u.id,
          action: "team.deleted",
          targetType: "team",
          targetId: id,
          details: { name: team.name },
        },
        db,
      );
    });
    return reply.code(204).send();
  });

  app.post("/teams/:id/members", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = memberInput.parse(r.body);
    const added = await transaction((db) => addMember(db, u, id, d));
    // Study: the team's pages' cards are theirs to learn now.
    await syncTeamPages(id);
    reply.code(201);
    return added;
  });

  app.put("/teams/:id/members/:userId", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const userId = idParam(r, "userId");
    const d = memberRoleInput.parse(r.body);
    return transaction(async (db) => {
      const { was: _was, ...changed } = await changeRole(
        db,
        u,
        id,
        userId,
        d.role,
      );
      return changed;
    });
  });

  app.delete("/teams/:id/members/:userId", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const userId = z.uuid().parse(idParam(r, "userId"));
    await transaction((db) => removeMember(db, u, id, userId));
    await syncTeamPages(id);
    return reply.code(204).send();
  });
}
