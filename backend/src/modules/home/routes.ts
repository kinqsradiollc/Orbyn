import type { FastifyInstance } from "fastify";
import {
  addDays,
  appendReflection,
  localDateKey,
  reflectionInput,
  reflectionLines,
  weekdayOf,
  type DocBlock,
  type HomeGoal,
  type HomeRoutine,
  type HomeSummary,
} from "@orbyn/core";
import { pool, reader, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { writeRateLimit } from "../../lib/params.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { listGoals } from "../assistant-workspace/goals.js";
import { listAgentRoutines } from "../assistant-workspace/routines.js";
import { dayZoneFor } from "../planner/timezone.js";
import { todaysAgendaIfWritten, writeTodaysAgenda } from "../docs/agenda.js";
import { addToPage } from "../docs/service.js";

/**
 * Home (W1): the panels under the hubs in one read — the person's active
 * goals with how far along each is and its next weekly check-in, the next
 * runs of their assistant routines, today's morning brief, and today's
 * reflection lines — and "How did today go?", which adds a line under
 * Reflection on today's agenda.
 *
 * Goals are read as the assistant sees them: one tied to a project kept
 * out of AI (or whose plan note is in one) is left out, since check-ins
 * and the brief come from the assistant.
 */

const ROUTINES_SHOWN = 5;

/** Ticked and all checklist lines on a page, for a goal measured by its plan. */
function ticks(blocks: DocBlock[] | null) {
  const todos = (blocks ?? []).filter((b) => b.type === "todo");
  return {
    done: todos.filter((b) => (b as { done: boolean }).done).length,
    all: todos.length,
  };
}

async function goalsFor(
  db: Queryable,
  userId: string,
  today: string,
): Promise<HomeGoal[]> {
  const goals = (await listGoals(db, userId, true)).filter(
    (g) => g.status === "active",
  );
  if (!goals.length) return [];
  const ids = goals.map((g) => g.id);
  const projects = [
    ...new Set(goals.flatMap((g) => (g.project_id ? [g.project_id] : []))),
  ];
  const plans = [
    ...new Set(goals.flatMap((g) => (g.plan_doc_id ? [g.plan_doc_id] : []))),
  ];
  const [counts, planDocs, latest] = await Promise.all([
    db.query<{ id: string; done: number; total: number }>(
      `SELECT p.id,
              (SELECT count(*)::int FROM items i WHERE i.project_id = p.id
                 AND i.kind = 'task' AND i.status = 'done') AS done,
              (SELECT count(*)::int FROM items i WHERE i.project_id = p.id
                 AND i.kind = 'task' AND i.status <> 'cancelled') AS total
         FROM projects p WHERE p.id = ANY ($1::uuid[])`,
      [projects],
    ),
    db.query<{ id: string; content: DocBlock[] | null }>(
      `SELECT d.id, d.content FROM docs d
        WHERE d.id = ANY ($2::uuid[]) AND ${docVisibleTo("$1")}`,
      [userId, plans],
    ),
    db.query<{ goal_id: string; week_of: string; status: string }>(
      `SELECT DISTINCT ON (goal_id) goal_id, week_of::text AS week_of, status
         FROM goals_checkins WHERE goal_id = ANY ($1::uuid[])
        ORDER BY goal_id, week_of DESC`,
      [ids],
    ),
  ]);
  const byProject = new Map(counts.rows.map((r) => [r.id, r]));
  const byPlan = new Map(planDocs.rows.map((r) => [r.id, ticks(r.content)]));
  const lastCheckin = new Map(latest.rows.map((r) => [r.goal_id, r]));
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  return goals.map((g) => {
    const project = g.project_id ? byProject.get(g.project_id) : undefined;
    const plan = g.plan_doc_id ? byPlan.get(g.plan_doc_id) : undefined;
    let progress: number | null = null;
    let label: string | null = null;
    if (project && project.total > 0) {
      progress = project.done / project.total;
      label = `${project.done} of ${project.total} tasks`;
    } else if (plan && plan.all > 0) {
      progress = plan.done / plan.all;
      label = `${plan.done} of ${plan.all} steps`;
    }
    const last = lastCheckin.get(g.id);
    const next =
      last?.week_of === monday && ["done", "running"].includes(last.status)
        ? addDays(monday, 7)
        : monday;
    return {
      id: g.id,
      title: g.title,
      progress,
      progress_label: label,
      next_checkin: next,
      target_date: g.target_date,
    };
  });
}

async function routinesFor(
  db: Queryable,
  userId: string,
): Promise<HomeRoutine[]> {
  return (await listAgentRoutines(db, userId))
    .filter((r) => !r.paused)
    .slice(0, ROUTINES_SHOWN)
    .map((r) => ({
      id: r.id,
      name: r.instruction,
      next_run_at: r.next_run_at,
      timezone: r.timezone,
    }));
}

export async function homeRoutes(app: FastifyInstance) {
  app.get("/me/home", async (r): Promise<HomeSummary> => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const timezone = await dayZoneFor(pool, u.id);
    const now = new Date();
    const today = localDateKey(now, timezone);
    const [goals, routines, brief, agenda] = await Promise.all([
      goalsFor(db, u.id, today),
      routinesFor(db, u.id),
      db.query<{ doc_id: string; title: string; content: DocBlock[] }>(
        `SELECT d.id AS doc_id, d.title, d.content FROM assistant_briefs b
           JOIN docs d ON d.id = b.doc_id
          WHERE b.user_id = $1 AND b.local_day = $2::date
            AND ${docVisibleTo("$1")}`,
        [u.id, today],
      ),
      todaysAgendaIfWritten(u.id, now),
    ]);
    return {
      today,
      timezone,
      goals,
      routines,
      brief: brief.rows[0]
        ? {
            doc_id: brief.rows[0].doc_id,
            title: brief.rows[0].title,
            overnight:
              brief.rows[0].content?.flatMap((block) =>
                "text" in block && block.text.startsWith("Overnight:")
                  ? [block.text]
                  : [],
              )[0] ?? null,
          }
        : null,
      agenda_doc_id: agenda?.id ?? null,
      reflection: agenda ? reflectionLines(agenda.content ?? []) : [],
    };
  });

  /**
   * "How did today go?": the line goes under Reflection on today's agenda
   * (the page is written first if it hasn't been), as one save of the
   * person's own — history keeps the state before, open editors take it in.
   */
  app.post("/me/home/reflection", writeRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const { text } = reflectionInput.parse(r.body ?? {});
    const { doc } = await writeTodaysAgenda(u.id);
    let lines: string[] = [];
    await addToPage(u, doc.id, (content) => {
      const next = appendReflection(content, text);
      lines = reflectionLines(next);
      return next;
    });
    reply.code(201);
    return { doc_id: doc.id, reflection: lines };
  });
}
