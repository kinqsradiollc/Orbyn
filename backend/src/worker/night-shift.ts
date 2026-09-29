import {
  nightShiftInput,
  nextOccurrence,
  parseRrule,
  NIGHT_SHIFT_KINDS,
  weekdayOf,
  dayTime,
  type NightShiftSettings,
} from "@orbyn/core";
import { pool, transaction, type Queryable, type Db } from "../db/pool.js";
import { resolveAi } from "../modules/ai/providers/resolve.js";
import type { ResolvedAi } from "../modules/ai/providers/adapters.js";
import { assistantPrincipal } from "../modules/agents/assistant.js";
import { startAssistantAutomation } from "../modules/ai/agent/run.js";
import { assistantNightWindow } from "./night-window.js";
import { LEAD_TOKEN_BUDGET } from "../modules/ai/agent/lead.js";
import { agendaEntries } from "../modules/planner/calendar.js";
import { upcomingExams } from "../modules/study/service.js";
import { visibleDocs, visibleItems } from "../lib/visibility.js";
import { queueOvernightNotices } from "./overnight-notices.js";

type Candidate = {
  kind: string;
  title: string;
  message: string;
  id?: string;
  source?: "task" | "goal" | "routine";
  week?: string;
  next?: string | null;
};
type NightPlan = {
  candidates: Candidate[];
  cursor: number;
  end_at: string;
  not_done: { title: string; reason: string }[];
};
const work: Record<
  (typeof NIGHT_SHIFT_KINDS)[number],
  { title: string; instruction: string }
> = {
  plan: {
    title: "Tomorrow's plan",
    instruction:
      "Plan tomorrow in the free time around my calendar. Roll unfinished sessions forward, resolve clashes, and leave buffers. Keep fixed events where they are.",
  },
  deadlines: {
    title: "Upcoming deadlines",
    instruction:
      "Find upcoming deadlines and exams with too little time booked. Book useful sessions before each deadline. Split tasks with no checklist into concrete steps with estimates and an order.",
  },
  study: {
    title: "Study preparation",
    instruction:
      "Prepare revision for upcoming exams and deadlines. Read relevant lecture and study notes added today, propose useful flashcards in their source pages even when there is no exam yet, and line up tomorrow's due cards within study time. Link every proposed card and session to its source.",
  },
  meetings: {
    title: "Meeting preparation",
    instruction:
      "Prepare a private Agent note for each upcoming meeting, linked to its calendar event, with an agenda, relevant project notes, open promises and questions. Never notify attendees.",
  },
  tidy: {
    title: "Tidy the inbox",
    instruction:
      "Triage unfinished inbox tasks into suitable lists. Propose useful priorities, due dates, links and checklists. Identify duplicates without deleting anything.",
  },
  handed: {
    title: "Handed tasks",
    instruction: "Work on tasks I explicitly handed to you for tonight.",
  },
  follow_through: {
    title: "Follow through",
    instruction:
      "Check due goals, routines, unresolved promises and work-record follow-through. On Friday prepare a weekly review. Propose concrete next steps and link them to their sources.",
  },
};

let afterPerson: string | null = null;

async function available(
  db: Queryable,
  userId: string,
  next: Candidate,
): Promise<boolean> {
  if (!next.source) return true;
  const sql =
    next.source === "task"
      ? `SELECT 1 FROM items i JOIN agent_grants g ON g.id = i.agent_grant_id
       WHERE i.id = $1 AND g.user_id = $2 AND i.agent_when = 'tonight' AND i.agent_state = 'queued'
         AND i.status NOT IN ('done', 'cancelled') AND i.agent_attempts < 3
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = i.project_id AND p.assistant_off)`
      : next.source === "goal"
        ? `SELECT 1 FROM goals g WHERE g.id = $1 AND g.user_id = $2 AND g.status = 'active'
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.assistant_off AND (p.id = g.project_id OR EXISTS(SELECT 1 FROM docs d WHERE d.id = g.plan_doc_id AND d.project_id = p.id)))
         AND NOT EXISTS(SELECT 1 FROM goals_checkins c WHERE c.goal_id = g.id AND c.week_of = $3::date AND c.status = 'done')`
        : `SELECT 1 FROM agent_routines WHERE id = $1 AND user_id = $2 AND NOT paused AND current_job_id IS NULL`;
  const values =
    next.source === "goal" ? [next.id, userId, next.week] : [next.id, userId];
  return !!(await db.query(sql, values)).rowCount;
}

async function candidates(
  db: Db,
  userId: string,
  prefs: NightShiftSettings,
  now: Date,
): Promise<Candidate[]> {
  const result: Candidate[] = [];
  if (prefs.kinds.handed) {
    const tasks = (
      await db.query<{ id: string; title: string; notes: string }>(
        `SELECT i.id, i.title, i.notes FROM items i JOIN agent_grants g ON g.id = i.agent_grant_id
       WHERE g.user_id = $1 AND g.kind = 'assistant' AND i.agent_when = 'tonight' AND i.agent_state = 'queued'
         AND i.status NOT IN ('done', 'cancelled')
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = i.project_id AND p.assistant_off)
       ORDER BY i.updated_at, i.id LIMIT 50`,
        [userId],
      )
    ).rows;
    result.push(
      ...tasks.map((task) => ({
        kind: "handed",
        source: "task" as const,
        id: task.id,
        title: task.title,
        message: `Work on the task I handed to you for tonight: ${task.title}. Task id: ${task.id}.\n${task.notes ?? ""}\nRead its checklist and linked context before working. Report what you completed or what needs me.`,
      })),
    );
  }
  if (prefs.kinds.follow_through) {
    const goals = (
      await db.query<{
        id: string;
        title: string;
        target: string;
        week: string;
      }>(
        `SELECT g.id, g.title, g.target, date_trunc('week', $2::timestamptz AT TIME ZONE $3)::date::text AS week
       FROM goals g LEFT JOIN goals_checkins c ON c.goal_id = g.id AND c.week_of = date_trunc('week', $2::timestamptz AT TIME ZONE $3)::date
       WHERE g.user_id = $1 AND g.status = 'active' AND (c.id IS NULL OR c.status <> 'done')
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.assistant_off AND (p.id = g.project_id OR EXISTS(SELECT 1 FROM docs d WHERE d.id = g.plan_doc_id AND d.project_id = p.id)))
       ORDER BY g.updated_at, g.id LIMIT 50`,
        [userId, now, prefs.timezone],
      )
    ).rows;
    result.push(
      ...goals.map((goal) => ({
        kind: "goal",
        source: "goal" as const,
        id: goal.id,
        week: goal.week,
        title: `Goal: ${goal.title}`,
        message: `Review my active goal ${goal.title} (${goal.id}), target ${goal.target}, for the week ${goal.week}. Read its plan, tasks and booked sessions; record progress and propose the useful next steps.`,
      })),
    );
    const routines = (
      await db.query<{
        id: string;
        instruction: string;
        rrule: string;
        timezone: string;
        next_run_at: Date;
      }>(
        `SELECT id, instruction, rrule, timezone, next_run_at FROM agent_routines
       WHERE user_id = $1 AND NOT paused AND next_run_at <= $2 AND current_job_id IS NULL
       ORDER BY next_run_at, id LIMIT 50`,
        [userId, now],
      )
    ).rows;
    for (const routine of routines) {
      let next: Date | null;
      try {
        if (!parseRrule(routine.rrule))
          throw new Error("Invalid routine schedule");
        next = nextOccurrence(
          routine.next_run_at,
          routine.rrule,
          routine.timezone,
          now,
        );
      } catch {
        await db.query(
          `UPDATE agent_routines SET paused = true, claimed_at = NULL,
           last_result = $2::jsonb, updated_at = now() WHERE id = $1`,
          [
            routine.id,
            JSON.stringify({
              error:
                "This routine's schedule could not be read, so it was paused. Edit its schedule to resume it.",
            }),
          ],
        );
        continue;
      }
      result.push({
        kind: "routine",
        source: "routine",
        id: routine.id,
        title: "Scheduled routine",
        message: `Run my scheduled routine ${routine.id}: ${routine.instruction}`,
        next: next?.toISOString() ?? null,
      });
    }
  }
  const hasWork = (
    await db.query<{
      items: boolean;
      deadlines: boolean;
      study: boolean;
      meetings: boolean;
      follow_through: boolean;
    }>(
      `SELECT EXISTS(SELECT 1 FROM items i WHERE i.user_id = $1 AND i.status NOT IN ('done', 'cancelled')
       AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = i.project_id AND p.assistant_off)) AS items,
       (EXISTS(SELECT 1 FROM items i WHERE i.user_id = $1 AND i.kind = 'task'
         AND i.due_at <= $2::timestamptz + interval '14 days' AND i.status NOT IN ('done', 'cancelled')
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = i.project_id AND p.assistant_off))
        OR EXISTS(SELECT 1 FROM study_exams e WHERE e.user_id = $1 AND e.starts_at > $2
         AND e.starts_at <= $2::timestamptz + interval '14 days'
         AND NOT EXISTS(SELECT 1 FROM docs d JOIN projects p ON p.id = d.project_id
          WHERE d.id = ANY(e.doc_ids) AND p.assistant_off))) AS deadlines,
       (EXISTS(SELECT 1 FROM study_cards c JOIN docs d ON d.id = c.doc_id WHERE c.user_id = $1
         AND c.due_at <= $2::timestamptz + interval '1 day'
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = d.project_id AND p.assistant_off))
        OR EXISTS(SELECT 1 FROM study_exams e WHERE e.user_id = $1 AND e.starts_at > $2
         AND e.starts_at <= $2::timestamptz + interval '14 days'
         AND NOT EXISTS(SELECT 1 FROM docs d JOIN projects p ON p.id = d.project_id
          WHERE d.id = ANY(e.doc_ids) AND p.assistant_off))) AS study,
       EXISTS(SELECT 1 FROM work_records r WHERE (r.owner_id = $1 OR (r.created_by = $1 AND r.team_id IS NULL))
         AND r.status IN ('open', 'proposed')
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.assistant_off AND
          (p.id = r.project_id OR EXISTS(SELECT 1 FROM docs d WHERE d.id = r.source_doc_id AND d.project_id = p.id)))) AS follow_through,
       EXISTS(SELECT 1 FROM items i WHERE i.user_id = $1 AND i.kind = 'event' AND i.due_at > $2
         AND i.due_at < $2::timestamptz + interval '2 days' AND i.status NOT IN ('done', 'cancelled')
         AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = i.project_id AND p.assistant_off)) AS meetings`,
      [userId, now],
    )
  ).rows[0];
  // Calendar-only exams and subscribed meetings are work even before Study
  // or the reminder scanner has materialized an exam row.
  const [calendarExams, meetings] = await Promise.all([
    upcomingExams(db, userId, now, { horizonDays: 14, limit: null }),
    agendaEntries(db, userId, now, new Date(now.getTime() + 2 * 86_400_000)),
  ]);
  const itemIds = [
    ...new Set([
      ...calendarExams.flatMap((exam) =>
        exam.key.startsWith("item:") ? [exam.key.slice(5).split("|")[0]] : [],
      ),
      ...meetings.flatMap((entry) => (entry.item_id ? [entry.item_id] : [])),
    ]),
  ];
  const visible = new Set(
    (
      await db.query<{ id: string }>(
        `SELECT i.id FROM items i WHERE i.id = ANY($2::uuid[]) AND ${visibleItems("i", { user: "$1", ai: true })}`,
        [userId, itemIds],
      )
    ).rows.map((row) => row.id),
  );
  const blockedExamKeys = new Set(
    (
      await db.query<{ exam_key: string }>(
        `SELECT e.exam_key FROM study_exams e WHERE e.user_id=$1
     AND EXISTS(SELECT 1 FROM docs d WHERE d.id=ANY(e.doc_ids) AND NOT ${visibleDocs("d", { user: "$1", ai: true })})`,
        [userId],
      )
    ).rows.map((row) => row.exam_key),
  );
  const hasCalendarExam = calendarExams
    .filter((exam) => !blockedExamKeys.has(exam.key))
    .some(
      (exam) =>
        !exam.key.startsWith("item:") ||
        visible.has(exam.key.slice(5).split("|")[0]),
    );
  hasWork.deadlines ||= hasCalendarExam;
  hasWork.study ||= hasCalendarExam;
  hasWork.study ||= !!(
    await db.query(
      `SELECT 1 FROM docs d WHERE d.user_id=$1 AND d.kind='doc'
     AND d.updated_at >= $2 AND d.updated_at <= $3
     AND d.content <> '[]'::jsonb AND ${visibleDocs("d", { user: "$1", ai: true })} LIMIT 1`,
      [
        userId,
        dayTime(assistantNightWindow(now, prefs)!.localDay, 0, prefs.timezone),
        now,
      ],
    )
  ).rowCount;
  hasWork.meetings ||= meetings.some(
    (entry) =>
      entry.calendar_kind !== "holidays" &&
      Date.parse(entry.start_at) > now.getTime() &&
      (!entry.item_id || visible.has(entry.item_id)),
  );
  const fridayReview =
    weekdayOf(assistantNightWindow(now, prefs)!.localDay) === 5;
  for (const kind of NIGHT_SHIFT_KINDS) {
    if (!prefs.kinds[kind] || kind === "handed") continue;
    if (
      kind === "deadlines"
        ? !hasWork.deadlines
        : kind === "follow_through"
          ? !hasWork.follow_through && !fridayReview
          : kind === "study"
            ? !hasWork.study
            : kind === "meetings"
              ? !hasWork.meetings
              : !hasWork.items
    )
      continue;
    result.push({
      kind,
      title: work[kind].title,
      message: work[kind].instruction,
    });
  }
  return result;
}

async function claimSource(
  db: Queryable,
  userId: string,
  next: Candidate,
  jobId: string,
  now: Date,
) {
  if (next.source === "task") {
    const changed = await db.query(
      `UPDATE items i SET agent_job_id = $3, agent_state = 'working', agent_claimed_at = $4,
      agent_attempts = agent_attempts + 1, agent_result = NULL, updated_at = now()
      FROM agent_grants g WHERE i.id = $1 AND g.id = i.agent_grant_id AND g.user_id = $2
        AND i.agent_when = 'tonight' AND i.agent_state = 'queued'`,
      [next.id, userId, jobId, now],
    );
    if (!changed.rowCount)
      throw new Error("This Tonight task is no longer available.");
  } else if (next.source === "goal") {
    const changed = await db.query(
      `INSERT INTO goals_checkins(goal_id, user_id, week_of, summary, progress, status, job_id, claimed_at, attempts)
      VALUES($1, $2, $3::date, 'Night review in progress', '{}'::jsonb, 'running', $4, $5, 1)
      ON CONFLICT(goal_id, week_of) DO UPDATE SET status = 'running', job_id = EXCLUDED.job_id,
        claimed_at = EXCLUDED.claimed_at, attempts = goals_checkins.attempts + 1 WHERE goals_checkins.status <> 'done'
      RETURNING goal_id`,
      [next.id, userId, next.week, jobId, now],
    );
    if (!changed.rowCount)
      throw new Error("This goal has already been reviewed.");
  } else if (next.source === "routine") {
    const changed = await db.query(
      `UPDATE agent_routines SET current_job_id = $3, claimed_at = $4,
      next_run_at = coalesce($5::timestamptz, next_run_at), paused = ($5::timestamptz IS NULL), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND NOT paused AND current_job_id IS NULL AND next_run_at <= $4`,
      [next.id, userId, jobId, now, next.next],
    );
    if (!changed.rowCount) throw new Error("This routine is no longer due.");
  }
}

/** Queue one ordinary durable job per person's night, with a serialized claim. */
export async function scanNightShift(
  now = new Date(),
  options: { only?: string[]; ai?: ResolvedAi | null } = {},
): Promise<number> {
  // Close elapsed windows even when the provider or person has since gone offline.
  await pool.query(
    `UPDATE assistant_nights SET status = 'done',
    summary = jsonb_set(summary, '{not_done}', coalesce(summary->'not_done', '[]'::jsonb) || coalesce((SELECT jsonb_agg(jsonb_build_object('title', candidate->>'title', 'reason', 'Not done tonight: the night window ended'))
      FROM jsonb_array_elements(summary->'candidates') WITH ORDINALITY AS c(candidate, position)
      WHERE position > coalesce((summary->>'cursor')::int, 0)), '[]'::jsonb)), updated_at = now()
    WHERE status = 'running' AND summary->>'end_at' IS NOT NULL AND (summary->>'end_at')::timestamptz <= $1`,
    [now],
  );
  await queueOvernightNotices(now, options.only);
  const ai = options.ai === undefined ? await resolveAi() : options.ai;
  if (!ai) return 0;
  const people = (
    await pool.query<{
      id: string;
      name: string;
      role: "admin" | "member";
      night_shift: unknown;
    }>(
      `SELECT u.id, u.name, u.role, a.night_shift FROM users u JOIN agent_settings a ON a.user_id = u.id
     WHERE NOT u.disabled AND a.night_shift->>'enabled' = 'true'
       AND ($1::uuid[] IS NULL OR u.id = ANY($1::uuid[]))
       AND ($2::uuid IS NULL OR u.id > $2::uuid) ORDER BY u.id LIMIT 200`,
      [options.only ?? null, options.only ? null : afterPerson],
    )
  ).rows;
  if (!options.only) afterPerson = people.at(-1)?.id ?? null;
  let queued = 0;
  for (const person of people) {
    const parsed = nightShiftInput.safeParse(person.night_shift);
    if (!parsed.success) continue;
    const prefs = parsed.data;
    const window = assistantNightWindow(now, prefs);
    if (!window) continue;
    await assistantPrincipal(person);
    queued += await transaction(async (db) => {
      const lock = (
        await db.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock(hashtext('assistant-night:' || $1)) AS locked",
          [person.id],
        )
      ).rows[0];
      if (!lock.locked) return 0;
      const eligible = await db.query(
        `SELECT 1 FROM users u JOIN agent_settings a ON a.user_id = u.id
        JOIN agent_grants g ON g.user_id = u.id AND g.kind = 'assistant'
        WHERE u.id = $1 AND NOT u.disabled AND a.night_shift->>'enabled' = 'true'
          AND g.suspended_at IS NULL AND g.revoked_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM presence p WHERE p.user_id = u.id AND p.active AND p.seen_at > $2::timestamptz - interval '15 minutes')
          AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.last_seen_at > $2::timestamptz - interval '15 minutes')`,
        [person.id, now],
      );
      if (!eligible.rowCount) return 0;
      await db.query(
        "INSERT INTO assistant_nights(user_id, local_day) VALUES($1, $2::date) ON CONFLICT DO NOTHING",
        [person.id, window.localDay],
      );
      const night = (
        await db.query<{
          id: string;
          status: string;
          runs: number;
          budget_used: number;
          summary: Partial<NightPlan>;
        }>(
          "SELECT * FROM assistant_nights WHERE user_id = $1 AND local_day = $2::date FOR UPDATE",
          [person.id, window.localDay],
        )
      ).rows[0];
      if (night.status !== "running") return 0;
      const plan: NightPlan = night.summary.candidates
        ? (night.summary as NightPlan)
        : {
            candidates: await candidates(db, person.id, prefs, now),
            cursor: 0,
            end_at: window.end.toISOString(),
            not_done: [],
          };
      const active = await db.query(
        "SELECT 1 FROM ai_jobs WHERE user_id = $1 AND state IN ('queued', 'running', 'waiting') LIMIT 1",
        [person.id],
      );
      if (active.rowCount) {
        await db.query(
          "UPDATE assistant_nights SET summary = $2::jsonb, updated_at = now() WHERE id = $1",
          [night.id, JSON.stringify(plan)],
        );
        return 0;
      }
      const budget = (
        await db.query<{ night_token_budget: number }>(
          "SELECT night_token_budget FROM ai_settings WHERE id",
        )
      ).rows[0].night_token_budget;
      let next = plan.candidates[plan.cursor];
      while (
        next &&
        (!(next.source === "goal" || next.source === "routine"
          ? prefs.kinds.follow_through
          : prefs.kinds[next.kind as (typeof NIGHT_SHIFT_KINDS)[number]]) ||
          !(await available(db, person.id, next)))
      ) {
        plan.not_done.push({
          title: next.title,
          reason: "Not done tonight: this work is no longer available",
        });
        next = plan.candidates[++plan.cursor];
      }
      if (!next || night.runs >= 10 || night.budget_used >= budget) {
        const reason =
          night.runs >= 10
            ? "Not done tonight: the ten-run limit was reached"
            : "Not done tonight: the token budget was reached";
        plan.not_done.push(
          ...plan.candidates
            .slice(plan.cursor)
            .map((candidate) => ({ title: candidate.title, reason })),
        );
        await db.query(
          "UPDATE assistant_nights SET status = 'done', summary = $2::jsonb, updated_at = now() WHERE id = $1",
          [night.id, JSON.stringify(plan)],
        );
        return 0;
      }
      const job = await startAssistantAutomation({
        userId: person.id,
        timezone: prefs.timezone,
        title: next.title,
        message: `${next.message}\n\nThis is my night shift. Respect kept-out projects and existing trust. Summarize the sources, useful results, questions and unfinished work for my morning review.`,
        automation: {
          kind: "night",
          night_id: night.id,
          night_kind: next.kind,
          source_kind: next.source,
          id: next.id,
          week_of: next.week,
          wait_for_ok: prefs.wait_for_ok,
          token_budget: Math.min(LEAD_TOKEN_BUDGET, budget - night.budget_used),
          end_at: plan.end_at,
        },
        db,
        onQueued: async (inside, id) => {
          await claimSource(inside, person.id, next, id, now);
          await inside.query(
            "INSERT INTO assistant_night_runs(night_id, job_id, kind) VALUES($1, $2, $3)",
            [night.id, id, next.kind],
          );
          plan.cursor++;
          await inside.query(
            "UPDATE assistant_nights SET runs = runs + 1, summary = $2::jsonb, updated_at = now() WHERE id = $1",
            [night.id, JSON.stringify(plan)],
          );
        },
      });
      return job ? 1 : 0;
    });
  }
  return queued;
}
