import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  availabilityQuery,
  fail,
  rangeQuery,
  suggestQuery,
  type MeetingSlot,
  type MemberAvailability,
  type MemberWorkload,
  type TeamAtRiskItem,
  type UserAvailability,
} from "@orbyn/core";
import { reader, type Queryable as Db } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { busyIntervals, loadPrefs } from "../planner/calendar.js";
import { freeSpans, workingSpans } from "../planner/plans.js";
import { DEFAULT_ESTIMATE_MINUTES } from "../planner/scheduler.js";
import { teamMembers } from "./routes.js";

/**
 * Team time: who is busy when, who is overloaded, and when everyone can
 * meet. Teammates only ever see busy intervals, never what the time is for.
 */
const MAX_MEMBERS = 50;

type Span = { start: number; end: number };

/** Busy time teammates see: busy frames count, like events. */
const TEAM_BUSY = { blocks: true, derived: true, frames: true };

/** Free working time for one person in [from, to). */
async function memberFree(db: Db, userId: string, from: Date, to: Date) {
  const prefs = await loadPrefs(db, userId);
  const busy = await busyIntervals(db, userId, from, to, TEAM_BUSY);
  return freeSpans(workingSpans(prefs, from, to), busy);
}

/** Spans free for everyone. */
function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

const STEP_MS = 15 * 60_000;
/** Free time shorter than this on either side of a meeting isn't worth protecting. */
const FOCUS_MS = 45 * 60_000;

/** Most people one overlay request can ask about. */
const MAX_OVERLAY = 10;

export async function teamPlanningRoutes(app: FastifyInstance) {
  // Busy times of people you share a team with, to lay over your own
  // calendar. Anyone else (or an unknown id) is simply left out.
  app.get("/availability", async (r): Promise<UserAvailability[]> => {
    const u = await authenticate(r);
    const q = availabilityQuery.parse(r.query);
    const ids = [
      ...new Set(
        q.user_ids
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length > MAX_OVERLAY)
      fail(422, `Ask for ${MAX_OVERLAY} people or fewer at a time.`);
    if (ids.some((id) => !z.uuid().safeParse(id).success))
      fail(422, "Those aren't user ids.");
    const db = reader(r.headers);
    const people = (
      await db.query<{ id: string; name: string }>(
        `SELECT x.id, x.name FROM users x
         WHERE x.id = ANY ($2::uuid[]) AND NOT x.disabled
           AND (x.id = $1 OR EXISTS (
             SELECT 1 FROM team_members a JOIN team_members b ON b.team_id = a.team_id
             WHERE a.user_id = $1 AND b.user_id = x.id))`,
        [u.id, ids],
      )
    ).rows;
    const from = new Date(q.from);
    const to = new Date(q.to);
    return Promise.all(
      ids
        .flatMap((id) => people.filter((p) => p.id === id))
        .map(async (p) => ({
          user_id: p.id,
          name: p.name,
          timezone: (await loadPrefs(db, p.id)).timezone,
          busy: await busyIntervals(db, p.id, from, to, TEAM_BUSY),
        })),
    );
  });

  app.get(
    "/teams/:id/availability",
    async (r): Promise<MemberAvailability[]> => {
      const u = await authenticate(r);
      const teamId = idParam(r);
      const q = rangeQuery.parse(r.query);
      const db = reader(r.headers);
      await requireTeam(teamId, u, "items:read");
      const from = new Date(q.from);
      const to = new Date(q.to);
      const members = (await teamMembers(teamId)).slice(0, MAX_MEMBERS);
      return Promise.all(
        members.map(async (m) => {
          const prefs = await loadPrefs(db, m.user_id);
          return {
            user_id: m.user_id,
            name: m.name,
            timezone: prefs.timezone,
            work_days: prefs.work_days,
            work_start: prefs.work_start,
            work_end: prefs.work_end,
            busy: await busyIntervals(db, m.user_id, from, to, TEAM_BUSY),
          };
        }),
      );
    },
  );

  app.get("/teams/:id/workload", async (r): Promise<MemberWorkload[]> => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const q = rangeQuery.parse(r.query);
    const db = reader(r.headers);
    await requireTeam(teamId, u, "items:read");
    const from = new Date(q.from);
    const to = new Date(q.to);
    const members = (await teamMembers(teamId)).slice(0, MAX_MEMBERS);
    return Promise.all(
      members.map(async (m) => {
        const prefs = await loadPrefs(db, m.user_id);
        // Capacity leaves out their time blocks: those are for the work counted here.
        const busy = await busyIntervals(db, m.user_id, from, to, {
          blocks: false,
          derived: true,
        });
        const free = freeSpans(workingSpans(prefs, from, to), busy);
        const capacity = Math.round(
          free.reduce((sum, s) => sum + (s.end - s.start) / 60_000, 0),
        );
        const tasks = (
          await db.query<{
            id: string;
            title: string;
            due_at: Date | null;
            estimate_minutes: number | null;
            spent_minutes: number;
          }>(
            `SELECT id, title, due_at, estimate_minutes, spent_minutes FROM items
             WHERE team_id = $1 AND assignee_id = $2 AND kind = 'task' AND status <> 'done'
               AND (due_at IS NULL OR due_at < $3)`,
            [teamId, m.user_id, to],
          )
        ).rows;
        let assigned = 0;
        let atRisk = 0;
        const remainingOf = (t: (typeof tasks)[number]) =>
          Math.max(
            0,
            (t.estimate_minutes ?? DEFAULT_ESTIMATE_MINUTES) - t.spent_minutes,
          );
        // Tasks due soonest take the free time first.
        const sorted = [...tasks].sort(
          (a, b) =>
            (a.due_at?.getTime() ?? Infinity) -
            (b.due_at?.getTime() ?? Infinity),
        );
        let used = 0;
        const atRiskItems: TeamAtRiskItem[] = [];
        for (const t of sorted) {
          const remaining = remainingOf(t);
          assigned += remaining;
          if (!t.due_at) continue;
          const due = t.due_at.getTime();
          const before = free.reduce(
            (sum, s) =>
              sum + Math.max(0, Math.min(s.end, due) - s.start) / 60_000,
            0,
          );
          used += remaining;
          if (used > before && remaining > 0) {
            atRisk++;
            atRiskItems.push({
              id: t.id,
              title: t.title,
              assignee_id: m.user_id,
              assignee_name: m.name,
              due_at: t.due_at.toISOString(),
              remaining_minutes: Math.round(remaining),
            });
          }
        }
        const load = capacity ? assigned / capacity : assigned ? 9.99 : 0;
        return {
          user_id: m.user_id,
          name: m.name,
          capacity_minutes: capacity,
          assigned_minutes: Math.round(assigned),
          open_tasks: tasks.length,
          unestimated_tasks: tasks.filter((t) => t.estimate_minutes == null)
            .length,
          load: Math.round(load * 100) / 100,
          overloaded: load > 1,
          at_risk: atRisk,
          at_risk_items: atRiskItems,
        };
      }),
    );
  });

  // Times everyone chosen is free, least disruptive first.
  app.get("/teams/:id/suggest", async (r): Promise<MeetingSlot[]> => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const q = suggestQuery.parse(r.query);
    const db = reader(r.headers);
    await requireTeam(teamId, u, "items:read");
    const members = await teamMembers(teamId);
    const wanted = q.user_ids
      ? q.user_ids.split(",").map((id) => id.trim())
      : members.map((m) => m.user_id);
    const people = members
      .filter((m) => wanted.includes(m.user_id))
      .slice(0, MAX_MEMBERS);
    if (!people.length) return [];
    const from = new Date(
      Math.max(Date.parse(q.from), Math.ceil(Date.now() / STEP_MS) * STEP_MS),
    );
    const to = new Date(q.to);
    const perPerson = await Promise.all(
      people.map((p) => memberFree(db, p.user_id, from, to)),
    );
    const common = perPerson.reduce((acc, spans) => intersect(acc, spans));
    const need = q.duration * 60_000;
    const slots: MeetingSlot[] = [];
    for (const span of common) {
      for (
        let start = Math.ceil(span.start / STEP_MS) * STEP_MS;
        start + need <= span.end;
        start += STEP_MS
      ) {
        const end = start + need;
        // A meeting that leaves someone a short stub of free time on each
        // side breaks up their focus; one next to other commitments doesn't.
        const disruption = perPerson.filter((spans) => {
          const s = spans.find((x) => x.start <= start && x.end >= end);
          return s && start - s.start >= FOCUS_MS && s.end - end >= FOCUS_MS;
        }).length;
        slots.push({
          start_at: new Date(start).toISOString(),
          end_at: new Date(end).toISOString(),
          disruption,
        });
      }
    }
    return slots
      .sort(
        (a, b) =>
          a.disruption - b.disruption || a.start_at.localeCompare(b.start_at),
      )
      .slice(0, 20)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  });
}
