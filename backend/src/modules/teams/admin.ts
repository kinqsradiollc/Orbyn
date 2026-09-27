import { z } from "zod";
import {
  MAX_AGENT_INSTRUCTIONS,
  canChangeTeamMember,
  fail,
  TEAM_ROLES,
  type TeamRole,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import type { UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { announceAuthChange } from "../agents/service.js";
import { emitInbox } from "../agent-inbox/emit.js";
import { setInstructions } from "../agent-context/service.js";
import { LAST_OWNER, member, ownerCount, teamSummary } from "./service.js";

/**
 * Running a team, in the caller's transaction: making and renaming one,
 * adding, removing and re-roling members, and its meeting budget. The
 * routes and agents (organize, H6b, always asked about first) share these,
 * so the same role checks and audit lines hold either way. Deleting a team
 * and its agent policy stay the routes' own (people only).
 */

/** Make a team with `u` as its owner. */
export async function createTeam(db: Db, u: UserRow, name: string) {
  const t = (
    await db.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id",
      [name, u.id],
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
      details: { name },
    },
    db,
  );
  return teamSummary(t.id, u.id, db);
}

/** Rename a team; the name it had. */
export async function renameTeam(
  db: Db,
  u: UserRow,
  id: string,
  name: string,
): Promise<string> {
  const team = await requireTeam(id, u, "team:update", db);
  await db.query("UPDATE teams SET name=$1 WHERE id=$2", [name, id]);
  await audit(
    {
      actorId: u.id,
      action: "team.renamed",
      targetType: "team",
      targetId: id,
      details: { from: team.name, to: name },
    },
    db,
  );
  return team.name;
}

/** Add someone with an Orbyn account to a team, by email. */
export async function addMember(
  db: Db,
  u: UserRow,
  id: string,
  d: { email: string; role: TeamRole },
) {
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
}

/** Change a member's role; the role they had. */
export async function changeRole(
  db: Db,
  u: UserRow,
  id: string,
  userId: string,
  role: TeamRole,
) {
  const { effective } = await requireTeam(id, u, "members:manage", db);
  const target = await member(id, userId, db);
  if (!canChangeTeamMember(effective, target.role, role))
    fail(403, "Only owners can change admins or grant admin or owner.");
  if (
    target.role === "owner" &&
    role !== "owner" &&
    (await ownerCount(id, db)) <= 1
  )
    fail(409, LAST_OWNER);
  await db.query(
    "UPDATE team_members SET role=$1 WHERE team_id=$2 AND user_id=$3",
    [role, id, userId],
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
        to: role,
      },
    },
    db,
  );
  return { ...target, role, was: target.role as TeamRole };
}

/** Take someone out of a team (or leave it); who they were in it. */
export async function removeMember(
  db: Db,
  u: UserRow,
  id: string,
  userId: string,
) {
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
  await db.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    id,
    userId,
  ]);
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
  return target;
}

/** A team's meeting budget per person per week (null: none); the old one. */
export async function setMeetingBudget(
  db: Db,
  u: UserRow,
  id: string,
  minutes: number | null,
): Promise<number | null> {
  const { effective } = await requireTeam(id, u, "items:read", db);
  if (effective !== "owner" && effective !== "admin")
    fail(403, "Only a team's owners and admins set its meeting budget.");
  const was = (
    await db.query<{ meeting_budget_minutes: number | null }>(
      "SELECT meeting_budget_minutes FROM teams WHERE id = $1",
      [id],
    )
  ).rows[0]?.meeting_budget_minutes;
  await db.query("UPDATE teams SET meeting_budget_minutes = $2 WHERE id = $1", [
    id,
    minutes,
  ]);
  return was ?? null;
}

/** One change to how a team is run, as an agent asks for it (H6b). */
export const teamAdminInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), name: z.string().trim().min(1).max(80) }),
  z.object({
    op: z.literal("rename"),
    team_id: z.uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.object({
    op: z.literal("invite"),
    team_id: z.uuid(),
    email: z.string().max(320),
    role: z.enum(TEAM_ROLES),
  }),
  z.object({ op: z.literal("remove"), team_id: z.uuid(), user_id: z.uuid() }),
  z.object({
    op: z.literal("role"),
    team_id: z.uuid(),
    user_id: z.uuid(),
    role: z.enum(TEAM_ROLES),
  }),
  z.object({
    op: z.literal("budget"),
    team_id: z.uuid(),
    minutes: z.number().int().min(30).max(2400).nullable(),
  }),
  // What the team's agents are told (H8): every member's agents follow it.
  z.object({
    op: z.literal("instructions"),
    team_id: z.uuid(),
    text: z.string().trim().max(MAX_AGENT_INSTRUCTIONS),
  }),
]);
export type TeamAdmin = z.output<typeof teamAdminInput>;

/**
 * Make one team change as `u`, through the functions above (so the same
 * role checks hold); what it changed, and how to take it back when that is
 * possible (a new team isn't: deleting a team is people only).
 */
export async function runTeamAdmin(db: Db, u: UserRow, c: TeamAdmin) {
  switch (c.op) {
    case "create": {
      const t = await createTeam(db, u, c.name);
      return { team_id: t.id, title: c.name, undo: null };
    }
    case "rename": {
      const was = await renameTeam(db, u, c.team_id, c.name);
      return {
        team_id: c.team_id,
        title: c.name,
        undo: { op: "team.set" as const, id: c.team_id, name: was },
      };
    }
    case "invite": {
      const m = await addMember(db, u, c.team_id, {
        email: c.email,
        role: c.role,
      });
      return {
        team_id: c.team_id,
        title: m.name ?? c.email,
        undo: {
          op: "team.member" as const,
          id: c.team_id,
          user_id: m.user_id,
          role: null,
        },
      };
    }
    case "remove": {
      const m = await removeMember(db, u, c.team_id, c.user_id);
      return {
        team_id: c.team_id,
        title: m.name ?? "a member",
        undo: {
          op: "team.member" as const,
          id: c.team_id,
          user_id: c.user_id,
          role: m.role as string,
        },
      };
    }
    case "role": {
      const m = await changeRole(db, u, c.team_id, c.user_id, c.role);
      return {
        team_id: c.team_id,
        title: m.name ?? "a member",
        undo: {
          op: "team.member" as const,
          id: c.team_id,
          user_id: c.user_id,
          role: m.was as string,
        },
      };
    }
    case "instructions": {
      const r = await setInstructions(db, u, c.team_id, { text: c.text });
      return {
        team_id: c.team_id,
        title: "Instructions for agents",
        undo: { op: "team.set" as const, id: c.team_id, instructions: r.was },
      };
    }
    case "budget": {
      const was = await setMeetingBudget(db, u, c.team_id, c.minutes);
      return {
        team_id: c.team_id,
        title: "Meeting budget",
        undo: {
          op: "team.set" as const,
          id: c.team_id,
          meeting_budget_minutes: was,
        },
      };
    }
  }
}
