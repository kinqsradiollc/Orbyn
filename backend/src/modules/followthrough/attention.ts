import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addDays,
  attentionBudgetInput,
  attentionCheckInput,
  dayTime,
  fail,
  localDateKey,
  weekStartOf,
  type AttentionCheck,
  type TeamAttention,
} from "@orbyn/core";
import { pool, reader, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { calendarEntries, loadPrefs } from "../planner/calendar.js";
import { teamMembers } from "../teams/service.js";

/**
 * Minutes of meetings someone has between `from` and `to`: timed, busy
 * events that are a team's or have people invited. Never what they are.
 */
async function meetingMinutes(
  db: Queryable,
  userId: string,
  from: Date,
  to: Date,
  skipItemId?: string,
) {
  const entries = await calendarEntries(db, userId, from, to);
  let minutes = 0;
  for (const e of entries) {
    if (e.kind !== "event" || e.all_day || e.busy === false || !e.end_at)
      continue;
    if (!e.team_id && !e.attendee_count) continue;
    if (skipItemId && e.item_id === skipItemId) continue;
    const start = Math.max(Date.parse(e.start_at), from.getTime());
    const end = Math.min(Date.parse(e.end_at), to.getTime());
    if (end > start) minutes += (end - start) / 60_000;
  }
  return Math.round(minutes);
}

async function budgetOf(db: Queryable, teamId: string) {
  return (
    (
      await db.query<{ meeting_budget_minutes: number | null }>(
        "SELECT meeting_budget_minutes FROM teams WHERE id = $1",
        [teamId],
      )
    ).rows[0]?.meeting_budget_minutes ?? null
  );
}

/** The Monday-to-Monday week around `day`, in the viewer's zone. */
async function weekOf(db: Queryable, userId: string, day?: string) {
  const { timezone } = await loadPrefs(db, userId);
  const start = weekStartOf(day ?? localDateKey(new Date(), timezone));
  return {
    start,
    from: dayTime(start, 0, timezone),
    to: dayTime(addDays(start, 7), 0, timezone),
  };
}

/**
 * Team attention budget: how much of each person's week meetings take,
 * against the team's budget, and who a new meeting would push over it.
 */
export async function attentionRoutes(app: FastifyInstance) {
  app.get("/teams/:id/attention", async (r): Promise<TeamAttention> => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const q = z
      .object({
        week: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .strict()
      .parse(r.query);
    await requireTeam(teamId, u, "items:read");
    const db = reader(r.headers);
    const week = await weekOf(db, u.id, q.week);
    const budget = await budgetOf(db, teamId);
    const members = (await teamMembers(teamId)).slice(0, 50);
    return {
      week_start: week.start,
      budget_minutes: budget,
      members: await Promise.all(
        members.map(async (m) => {
          const minutes = await meetingMinutes(
            db,
            m.user_id,
            week.from,
            week.to,
          );
          return {
            user_id: m.user_id,
            name: m.name,
            meeting_minutes: minutes,
            over: budget !== null && minutes > budget,
          };
        }),
      ),
    };
  });

  app.put("/teams/:id/attention", async (r) => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const d = attentionBudgetInput.parse(r.body);
    const { effective } = await requireTeam(teamId, u, "items:read");
    if (effective !== "owner" && effective !== "admin")
      fail(403, "Only a team's owners and admins set its meeting budget.");
    await pool.query(
      "UPDATE teams SET meeting_budget_minutes = $2 WHERE id = $1",
      [teamId, d.meeting_budget_minutes],
    );
    return d;
  });

  // Before a team meeting is saved: whose week would it take over budget?
  app.post("/teams/:id/attention/check", async (r): Promise<AttentionCheck> => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const d = attentionCheckInput.parse(r.body);
    await requireTeam(teamId, u, "items:read");
    const db = reader(r.headers);
    const budget = await budgetOf(db, teamId);
    if (budget === null) return { budget_minutes: null, over: [] };
    const start = new Date(d.start_at);
    const end = new Date(d.end_at);
    const length = (end.getTime() - start.getTime()) / 60_000;
    const week = await weekOf(
      db,
      u.id,
      localDateKey(start, (await loadPrefs(db, u.id)).timezone),
    );
    const members = (await teamMembers(teamId))
      .filter((m) => !d.user_ids || d.user_ids.includes(m.user_id))
      .slice(0, 50);
    const over: AttentionCheck["over"] = [];
    for (const m of members) {
      const now = await meetingMinutes(
        db,
        m.user_id,
        week.from,
        week.to,
        d.item_id,
      );
      if (now + length > budget)
        over.push({
          user_id: m.user_id,
          name: m.name,
          meeting_minutes: Math.round(now + length),
        });
    }
    return { budget_minutes: budget, over };
  });
}
