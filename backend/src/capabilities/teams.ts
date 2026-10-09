import { z } from "zod";
import { busyIntervals, loadPrefs } from "../modules/planner/calendar.js";
import { freeSpans, workingSpans } from "../modules/planner/plans.js";
import { teamAttention } from "../modules/followthrough/attention.js";
import { teamCapacity } from "../modules/teams/capacity.js";
import {
  intersect,
  memberFree,
  suggestTimes,
  teamAnalytics,
  teamWorkload,
} from "../modules/teams/planning.js";
import { teamMembers, teamSummary } from "../modules/teams/service.js";
import { READ, minutesText } from "./common.js";
import { both, cleanTitle, provenanceOf, titleFor } from "./format.js";
import { refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { itemSourceSql } from "./sources.js";
import { idField, isoTime } from "./write.js";

/**
 * The teams toolset: reading a team (members and roles, workload,
 * capacity, meeting budget) and finding times, with no changes to how a
 * team is made up. Team data follows the person's role: emails and hours
 * only for owners and admins, and teammates only ever show as busy time.
 */

/** A team this connection reaches, with the person's role in it. */
function reachTeam(ctx: CapabilityContext, id: string) {
  const team = ctx.principal.teams.find((t) => t.id === id.toLowerCase());
  if (!team)
    throw new CapabilityError(
      "NOT_FOUND",
      "No team with that id is reachable from this connection.",
      "get_context lists the connection's teams.",
    );
  return team;
}

const span = z.object({ at: z.string(), local: z.string() });

// --- get_team ---------------------------------------------------------------

export const getTeam = defineCapability({
  name: "get_team",
  title: "Open a team",
  description:
    "A team: its members and roles (emails only for owners and admins), each member's workload over the next week (capacity, assigned work, tasks at risk), free capacity per day (hours only for owners and admins), and each member's meeting time this week against the team's meeting budget.",
  input: z
    .object({
      team: idField,
      days: z.number().int().min(1).max(14).default(7),
    })
    .strict(),
  output: z.object({
    team: z.object({
      id: z.string(),
      name: z.string(),
      your_role: z.string(),
      agent_policy: z.string(),
    }),
    members: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        email: z.string().nullable(),
        capacity_minutes: z.number().nullable(),
        assigned_minutes: z.number().nullable(),
        load: z.number().nullable(),
        at_risk: z.array(
          z.object({
            task: z.string(),
            title: z.string(),
            provenance: z
              .string()
              .describe(
                'Who wrote it: "you", "teammate:<name>", or where it came from.',
              ),
          }),
        ),
        free_by_day: z.array(
          z.object({
            day: z.string(),
            level: z.number(),
            free_minutes: z.number().nullable(),
          }),
        ),
        meeting_minutes: z.number(),
        planned_minutes_30d: z
          .number()
          .nullable()
          .describe("Owners and admins only."),
      }),
    ),
    meeting_budget_minutes: z.number().nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "teams",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const team = reachTeam(ctx, a.team);
    const me = ctx.principal.user.id;
    const managers = team.role === "owner" || team.role === "admin";
    const db = ctx.db as never;
    const summary = await teamSummary(team.id, me, db);
    const members = await teamMembers(team.id, db);
    const from = ctx.now;
    const to = new Date(ctx.now.getTime() + a.days * 86_400_000);
    const workload = await teamWorkload(
      ctx.db,
      team.id,
      from.toISOString(),
      to.toISOString(),
    );
    const capacity = await teamCapacity(ctx.db, me, team.id, managers, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const attention = await teamAttention(ctx.db, me, team.id);
    const analytics = managers
      ? await teamAnalytics(ctx.db, team.id, 30, ctx.now)
      : null;
    const planned = new Map(
      (analytics?.members ?? []).map((m) => [m.user_id, m.planned_minutes]),
    );
    const byUser = <T extends { user_id: string }>(xs: T[]) =>
      new Map(xs.map((x) => [x.user_id, x]));
    const wl = byUser(workload);
    const cap = byUser(capacity.members);
    const att = byUser(attention.members);
    // Who wrote each task at risk, so its title is shown as every other
    // read shows it (outside text by its neutral name, or hidden).
    const riskIds = workload.flatMap((w) =>
      (w.at_risk_items ?? []).map((t) => t.id),
    );
    const origin = new Map(
      riskIds.length
        ? (
            await ctx.db.query<{
              id: string;
              kind: string;
              user_id: string;
              author_name: string | null;
              source: string | null;
            }>(
              `SELECT i.id, i.kind, i.user_id, au.name AS author_name,
                      ${itemSourceSql("i")} AS source
                 FROM items i JOIN users au ON au.id = i.user_id
                WHERE i.id = ANY ($1::uuid[])`,
              [riskIds],
            )
          ).rows.map((r) => [r.id, r])
        : [],
    );
    const structured = {
      team: {
        id: team.id,
        name: cleanTitle(summary?.name ?? team.name),
        your_role: team.role,
        agent_policy: team.agent_access,
      },
      members: members.map((m) => {
        const w = wl.get(m.user_id);
        const c = cap.get(m.user_id);
        return {
          id: m.user_id,
          name: cleanTitle(m.name),
          role: m.role,
          email: managers ? m.email : null,
          capacity_minutes: w ? w.capacity_minutes : null,
          assigned_minutes: w ? w.assigned_minutes : null,
          load: w ? w.load : null,
          at_risk: (w?.at_risk_items ?? []).map((t) => {
            const o = origin.get(t.id);
            const provenance = o ? provenanceOf(me, o) : "teammate:someone";
            return {
              task: refs({ type: "task", id: t.id }).id,
              title:
                titleFor(
                  t.title,
                  provenance,
                  ctx.principal.flags.hide_outside_content,
                  o?.kind,
                ) || "Untitled",
              provenance,
            };
          }),
          free_by_day: (c?.days ?? []).map((d) => ({
            day: d.day,
            level: d.level,
            free_minutes: d.free_minutes,
          })),
          meeting_minutes: att.get(m.user_id)?.meeting_minutes ?? 0,
          planned_minutes_30d: managers ? (planned.get(m.user_id) ?? 0) : null,
        };
      }),
      meeting_budget_minutes: attention.budget_minutes,
    };
    return {
      structured,
      markdown: [
        `${structured.team.name} (you: ${team.role}; agents: ${team.agent_access}) · ${members.length} member${members.length === 1 ? "" : "s"}.`,
        ...structured.members.map(
          (m) =>
            `- ${m.name} (${m.role})${m.email ? ` <${m.email}>` : ""}: ${m.assigned_minutes === null ? "" : `${minutesText(m.assigned_minutes)} assigned of ${minutesText(m.capacity_minutes ?? 0)} free`}${m.at_risk.length ? `, ${m.at_risk.length} at risk` : ""}; meetings ${minutesText(m.meeting_minutes)} this week`,
        ),
        structured.meeting_budget_minutes !== null
          ? `Meeting budget: ${minutesText(structured.meeting_budget_minutes)} a week each.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  },
});

// --- find_time ----------------------------------------------------------------

export const findTime = defineCapability({
  name: "find_time",
  title: "Find a time",
  description:
    "Finds meeting times inside working hours when the person and up to 10 teammates are all free (people, or a team's members), least disruptive first; or, with no one else, the person's own free stretches of that length. Teammates only ever show as busy or free.",
  input: z
    .object({
      minutes: z.number().int().min(15).max(480),
      team: idField.optional(),
      people: z.array(idField).max(10).optional(),
      from: isoTime.optional(),
      to: isoTime.optional().describe("At most 14 days after from."),
    })
    .strict(),
  output: z.object({
    slots: z.array(
      z.object({
        start: span,
        end: span,
        disruption: z
          .number()
          .nullable()
          .describe("How many people it cuts a focus stretch for."),
      }),
    ),
  }),
  annotations: READ,
  access: "read",
  toolset: "teams",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const me = ctx.principal.user.id;
    const from = a.from ? new Date(a.from) : ctx.now;
    const to = a.to
      ? new Date(a.to)
      : new Date(from.getTime() + 7 * 86_400_000);
    if (to <= from || to.getTime() - from.getTime() > 14 * 86_400_000)
      throw new CapabilityError(
        "INVALID",
        "Look at most 14 days ahead, with to after from.",
      );
    const tz = ctx.timezone;
    const out = (s: {
      start_at: string;
      end_at: string;
      disruption?: number | null;
    }) => ({
      start: both(s.start_at, tz)!,
      end: both(s.end_at, tz)!,
      disruption: s.disruption ?? null,
    });
    let slots: ReturnType<typeof out>[];
    if (a.team) {
      const team = reachTeam(ctx, a.team);
      const found = await suggestTimes(
        ctx.db,
        team.id,
        {
          from: from.toISOString(),
          to: to.toISOString(),
          duration: a.minutes,
          ...(a.people?.length
            ? { user_ids: [...new Set([me, ...a.people])].join(",") }
            : {}),
        },
        ctx.now,
      );
      slots = found.map(out);
    } else if (a.people?.length) {
      // Only people sharing one of this connection's teams.
      const teamIds = ctx.spaces.teamIds ?? [];
      const known = (
        await ctx.db.query<{ user_id: string }>(
          `SELECT DISTINCT user_id FROM team_members
            WHERE team_id = ANY ($1::uuid[]) AND user_id = ANY ($2::uuid[])`,
          [teamIds, a.people],
        )
      ).rows.map((r) => r.user_id);
      if (known.length !== new Set(a.people).size)
        throw new CapabilityError(
          "NOT_FOUND",
          "Someone named isn't in a team this connection reaches.",
          "get_team lists a team's members.",
        );
      const everyone = [me, ...known];
      const free = await Promise.all(
        everyone.map((id) => memberFree(ctx.db, id, from, to)),
      );
      const common = free.reduce((acc, spans) => intersect(acc, spans));
      slots = common
        .filter((s) => s.end - s.start >= a.minutes * 60_000)
        .slice(0, 20)
        .map((s) =>
          out({
            start_at: new Date(
              Math.max(s.start, ctx.now.getTime()),
            ).toISOString(),
            end_at: new Date(
              Math.max(s.start, ctx.now.getTime()) + a.minutes * 60_000,
            ).toISOString(),
          }),
        );
    } else {
      if (!ctx.spaces.personal)
        throw new CapabilityError(
          "FORBIDDEN",
          "Your own free time needs the Personal space.",
        );
      const prefs = await loadPrefs(ctx.db as never, me);
      const busy = await busyIntervals(ctx.db as never, me, from, to, {
        blocks: true,
        derived: true,
      });
      slots = freeSpans(workingSpans(prefs, from, to), busy)
        .filter((s) => s.end - s.start >= a.minutes * 60_000)
        .slice(0, 20)
        .map((s) =>
          out({
            start_at: new Date(s.start).toISOString(),
            end_at: new Date(s.end).toISOString(),
          }),
        );
    }
    return {
      structured: { slots },
      markdown: slots.length
        ? [
            `${slots.length} time${slots.length === 1 ? "" : "s"} for ${minutesText(a.minutes)}:`,
            ...slots.map((s) => `- ${s.start.local}–${s.end.local.slice(-5)}`),
          ].join("\n")
        : "No free time that long in that window.",
    };
  },
});
