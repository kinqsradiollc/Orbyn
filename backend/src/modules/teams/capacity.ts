import type { FastifyInstance } from "fastify";
import {
  addDays,
  capacityLevel,
  capacityQuery,
  dayTime,
  localDateKey,
  type CapacityDay,
  type MemberCapacity,
  type TeamCapacity,
} from "@orbyn/core";
import { reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import {
  busyIntervals,
  loadPrefs,
  mergeIntervals,
} from "../planner/calendar.js";
import { CHILD_COLUMNS, freeSpans, workingSpans } from "../planner/plans.js";
import { remainingOf } from "../planner/scheduler.js";
import { teamMembers } from "./service.js";

const MAX_MEMBERS = 50;
/** Busy time teammates see: planned sessions and busy frames count too. */
const TEAM_BUSY = {
  blocks: true,
  derived: true,
  frames: true,
  audience: "others",
} as const;

type Span = { start: number; end: number };

/** Minutes of `spans` that fall inside [from, to). */
const within = (spans: Span[], from: number, to: number) =>
  Math.round(
    spans.reduce(
      (sum, s) =>
        sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)),
      0,
    ) / 60_000,
  );

/**
 * Who has room when: per person, per day, how much working time is free.
 * Everyone on the team sees the shades; owners and admins see the hours.
 */
export async function teamCapacityRoutes(app: FastifyInstance) {
  app.get("/teams/:id/capacity", async (r): Promise<TeamCapacity> => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    const q = capacityQuery.parse(r.query);
    const db = reader(r.headers);
    const { effective } = await requireTeam(teamId, u, "items:read");
    const showHours = effective === "owner" || effective === "admin";
    const { timezone } = await loadPrefs(db, u.id);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const days: string[] = [];
    for (
      let d = localDateKey(from, timezone);
      dayTime(d, 0, timezone) < to && days.length < 31;
      d = addDays(d, 1)
    )
      days.push(d);
    const bounds = days.map((d) => ({
      day: d,
      start: dayTime(d, 0, timezone).getTime(),
      end: dayTime(addDays(d, 1), 0, timezone).getTime(),
    }));
    const span = {
      from: new Date(bounds[0].start),
      to: new Date(bounds[bounds.length - 1].end),
    };

    const members = (await teamMembers(teamId)).slice(0, MAX_MEMBERS);
    const rows = await Promise.all(
      members.map(async (m): Promise<MemberCapacity> => {
        const prefs = await loadPrefs(db, m.user_id);
        const busy = await busyIntervals(
          db,
          m.user_id,
          span.from,
          span.to,
          TEAM_BUSY,
        );
        const working = workingSpans(prefs, span.from, span.to);
        const free = freeSpans(working, busy);
        const booked = mergeIntervals(busy).map((b) => ({
          start: Date.parse(b.start_at),
          end: Date.parse(b.end_at),
        }));
        const teamBlocks = (
          await db.query<{ start_at: Date; end_at: Date }>(
            `SELECT b.start_at, b.end_at FROM time_blocks b
               JOIN items i ON i.id = b.item_id
              WHERE b.user_id = $1 AND i.team_id = $2
                AND b.end_at > $3 AND b.start_at < $4`,
            [m.user_id, teamId, span.from, span.to],
          )
        ).rows.map((b) => ({
          start: b.start_at.getTime(),
          end: b.end_at.getTime(),
        }));

        const out: CapacityDay[] = bounds.map((b) => {
          const workingMinutes = within(working, b.start, b.end);
          const freeMinutes = within(free, b.start, b.end);
          const bookedMinutes = within(booked, b.start, b.end);
          const overMinutes = workingMinutes
            ? Math.max(0, bookedMinutes - workingMinutes)
            : 0;
          const off = workingMinutes === 0;
          return {
            day: b.day,
            level: off ? 0 : capacityLevel(freeMinutes),
            off,
            over: overMinutes >= 15,
            working_minutes: showHours ? workingMinutes : null,
            free_minutes: showHours ? freeMinutes : null,
            team_minutes: showHours ? within(teamBlocks, b.start, b.end) : null,
            over_minutes: showHours ? overMinutes : null,
          };
        });

        let unplaced: number | null = null;
        if (showHours) {
          const tasks = (
            await db.query<{
              estimate_minutes: number | null;
              spent_minutes: number;
              open_children: number;
              children_remaining: number;
              planned: number;
            }>(
              `SELECT i.estimate_minutes, i.spent_minutes, ${CHILD_COLUMNS},
                      coalesce((SELECT sum(extract(epoch FROM b.end_at - b.start_at) / 60)
                                  FROM time_blocks b
                                 WHERE b.item_id = i.id AND b.end_at > now()), 0)::int AS planned
                 FROM items i
                WHERE i.team_id = $1 AND i.assignee_id = $2 AND i.kind = 'task'
                  AND i.parent_id IS NULL
                  AND i.status NOT IN ('done', 'cancelled')
                  AND (i.due_at IS NULL OR i.due_at < $3)`,
              [teamId, m.user_id, span.to],
            )
          ).rows;
          unplaced = Math.round(
            tasks.reduce(
              (sum, t) => sum + Math.max(0, remainingOf(t) - t.planned),
              0,
            ),
          );
        }
        return {
          user_id: m.user_id,
          name: m.name,
          days: out,
          unplaced_minutes: unplaced,
        };
      }),
    );
    return {
      from: span.from.toISOString(),
      to: span.to.toISOString(),
      timezone,
      days,
      show_hours: showHours,
      members: rows,
    };
  });
}
