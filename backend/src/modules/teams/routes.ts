import type { FastifyInstance } from "fastify";
import {
  canChangeTeamMember,
  fail,
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
import { announceAuthChange } from "../agents/service.js";
import { emitInbox } from "../agent-inbox/emit.js";
import {
  LAST_OWNER,
  TEAM_COLUMNS,
  member,
  ownerCount,
  teamMembers,
  teamSummary,
} from "./service.js";

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
    const team = await transaction(async (db) => {
      const t = (
        await db.query<{ id: string }>(
          "INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id",
          [d.name, u.id],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
        [t.id, u.id],
      );
      await audit(
        {
          actorId: u.id,
          action: "team.created",
          targetType: "team",
          targetId: t.id,
          details: { name: d.name },
        },
        db,
      );
      return teamSummary(t.id, u.id, db);
    });
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
      const team = await requireTeam(id, u, "team:update", db);
      await db.query("UPDATE teams SET name=$1 WHERE id=$2", [d.name, id]);
      await audit(
        {
          actorId: u.id,
          action: "team.renamed",
          targetType: "team",
          targetId: id,
          details: { from: team.name, to: d.name },
        },
        db,
      );
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
    const added = await transaction(async (db) => {
      const { effective } = await requireTeam(id, u, "members:manage", db);
      if (!canChangeTeamMember(effective, null, d.role))
        fail(403, "Only owners can add admins or owners.");
      const target = (
        await db.query<{ id: string }>(
          "SELECT id FROM users WHERE email=$1 AND NOT disabled",
          [d.email],
        )
      ).rows[0];
      if (!target) fail(404, "No active Orbyn account uses that email.");
      const inserted = await db.query(
        "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, target.id, d.role],
      );
      if (!inserted.rowCount) fail(409, "They're already in this team.");
      // Their agents hear of it (H0), unless the team keeps agents out.
      const joined = (
        await db.query<{ name: string; agent_access: string }>(
          "SELECT name, agent_access FROM teams WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (target.id !== u.id && joined && joined.agent_access !== "off")
        await emitInbox(db, {
          userId: target.id,
          kind: "invite",
          key: `team:${id}:${target.id}`,
          title: `${u.name} added you to the team ${joined.name} as ${d.role}`,
          body: "get_context lists your teams; connect this agent to the team in Settings → Connected agents if it should work there.",
          entity: { type: "team", id },
        });
      await audit(
        {
          actorId: u.id,
          action: "team.member_added",
          targetType: "team",
          targetId: id,
          details: { user_id: target.id, email: d.email, role: d.role },
        },
        db,
      );
      return member(id, target.id, db);
    });
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
      const { effective } = await requireTeam(id, u, "members:manage", db);
      const target = await member(id, userId, db);
      if (!canChangeTeamMember(effective, target.role, d.role))
        fail(403, "Only owners can change admins or grant admin or owner.");
      if (
        target.role === "owner" &&
        d.role !== "owner" &&
        (await ownerCount(id, db)) <= 1
      )
        fail(409, LAST_OWNER);
      await db.query(
        "UPDATE team_members SET role=$1 WHERE team_id=$2 AND user_id=$3",
        [d.role, id, userId],
      );
      // Their agents' open streams check again what the new role reaches.
      await announceAuthChange(db, { users: [userId], reason: "team_role" });
      await audit(
        {
          actorId: u.id,
          action: "team.member_role_changed",
          targetType: "team",
          targetId: id,
          details: {
            user_id: userId,
            email: target.email,
            from: target.role,
            to: d.role,
          },
        },
        db,
      );
      return { ...target, role: d.role };
    });
  });

  app.delete("/teams/:id/members/:userId", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const userId = z.uuid().parse(idParam(r, "userId"));
    await transaction(async (db) => {
      const leaving = userId === u.id;
      const { effective } = await requireTeam(
        id,
        u,
        leaving ? "team:view" : "members:manage",
        db,
      );
      const target = await member(id, userId, db);
      if (!leaving && !canChangeTeamMember(effective, target.role, null))
        fail(403, "Only owners can remove admins or owners.");
      if (target.role === "owner" && (await ownerCount(id, db)) <= 1)
        fail(409, LAST_OWNER);
      await db.query(
        "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
        [id, userId],
      );
      await announceAuthChange(db, { users: [userId], reason: "team_left" });
      await audit(
        {
          actorId: u.id,
          action: leaving ? "team.member_left" : "team.member_removed",
          targetType: "team",
          targetId: id,
          details: { user_id: userId, email: target.email, role: target.role },
        },
        db,
      );
    });
    await syncTeamPages(id);
    return reply.code(204).send();
  });
}
