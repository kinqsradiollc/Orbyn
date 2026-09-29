import { randomUUID } from "node:crypto";
import {
  DEFAULT_REMINDER_NUDGES,
  canSendReminderNudge,
  reminderNudgeSettingsInput,
  localDateKey,
  dayTime,
  addDays,
  zonedParts,
  weekdayOf,
  type ReminderNudgeCard,
  type ReminderNudgeSettings,
} from "@orbyn/core";
import { pool, transaction, type Db } from "../db/pool.js";
import {
  visibleDocs,
  visibleItems,
  visibleProjects,
} from "../lib/visibility.js";
import { upcomingExams } from "../modules/study/service.js";
import { loadPrefs } from "../modules/planner/calendar.js";
import { announceTo } from "../modules/presence/live.js";

export type NudgeCandidate = {
  key: string;
  category:
    | "due"
    | "overdue"
    | "session"
    | "deadline"
    | "promise"
    | "routine"
    | "habit"
    | "waiting";
  entity_kind: ReminderNudgeCard["entity_kind"];
  entity_id: string;
  source_id?: string;
  exam_key?: string;
  text: string;
  actions: ReminderNudgeCard["actions"];
};
async function settings(
  db: Db,
  userId: string,
): Promise<ReminderNudgeSettings | null> {
  const row = (
    await db.query<{ reminder_nudges: unknown }>(
      `SELECT a.reminder_nudges FROM users u JOIN agent_grants g ON g.user_id = u.id AND g.kind = 'assistant'
     LEFT JOIN agent_settings a ON a.user_id = u.id
     WHERE u.id = $1 AND NOT u.disabled AND g.suspended_at IS NULL AND g.revoked_at IS NULL`,
      [userId],
    )
  ).rows[0];
  if (!row) return null;
  const parsed = reminderNudgeSettingsInput.safeParse(row.reminder_nudges);
  return parsed.success ? parsed.data : { ...DEFAULT_REMINDER_NUDGES };
}

/** Atomically reserve frequency limits, save a private card and queue chosen channels. */
export async function postReminderNudge(
  userId: string,
  timezone: string,
  candidate: NudgeCandidate,
  now = new Date(),
): Promise<boolean> {
  return transaction(async (db) => {
    const lock = (
      await db.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('assistant-nudge:' || $1)) AS locked",
        [userId],
      )
    ).rows[0];
    if (!lock.locked) return false;
    const prefs = await settings(db, userId);
    if (!prefs) return false;
    const current = (
      await reminderNudgeCandidates(userId, timezone, now, db)
    ).find(
      (row) =>
        row.entity_kind === candidate.entity_kind &&
        row.entity_id === candidate.entity_id,
    );
    if (!current) return false;
    candidate = current;
    const day = localDateKey(now, timezone);
    const history = (
      await db.query<{
        sent_today: number;
        last_sent_at: Date | null;
        stopped: boolean;
      }>(
        `SELECT (SELECT count(*)::int FROM assistant_nudges WHERE user_id = $1 AND local_day = $3::date) AS sent_today,
       max(sent_at) AS last_sent_at, coalesce(bool_or(stopped), false) AS stopped
       FROM assistant_nudges WHERE user_id = $1 AND nudge_key = $2`,
        [userId, candidate.key, day],
      )
    ).rows[0];
    if (!canSendReminderNudge(now, timezone, prefs, history)) return false;
    const email =
      prefs.email && ["overdue", "deadline"].includes(candidate.category);
    if (!prefs.chat && !prefs.push && !email) return false;
    const id = randomUUID();
    await db.query(
      `INSERT INTO assistant_nudges(id, user_id, nudge_key, entity_kind, entity_id, local_day, sent_at)
     VALUES($1, $2, $3, $4, $5, $6::date, $7)`,
      [
        id,
        userId,
        candidate.key,
        candidate.entity_kind,
        candidate.entity_id,
        day,
        now,
      ],
    );
    let chatId: string | null = null;
    if (prefs.chat) {
      chatId = (
        await db.query<{ id: string }>(
          `INSERT INTO ai_chats(id, user_id, title, pinned, origin) VALUES($2, $1, 'Reminders', true, 'reminders')
       ON CONFLICT(user_id) WHERE origin = 'reminders' DO UPDATE SET pinned = true RETURNING id`,
          [userId, randomUUID()],
        )
      ).rows[0].id;
      const row = (
        await db.query<{ turns: unknown[] }>(
          "SELECT turns FROM ai_chats WHERE id = $1 FOR UPDATE",
          [chatId],
        )
      ).rows[0];
      const card = {
        role: "assistant",
        text: candidate.text,
        turn_id: id,
        outcome: "info",
        nudge: {
          id,
          key: candidate.key,
          entity_kind: candidate.entity_kind,
          entity_id: candidate.entity_id,
          actions: candidate.actions,
          ...(candidate.source_id ? { source_id: candidate.source_id } : {}),
          ...(candidate.exam_key ? { exam_key: candidate.exam_key } : {}),
        },
      };
      await db.query(
        "UPDATE ai_chats SET turns = $2::jsonb, last_used_at = $3, swept_at = NULL WHERE id = $1",
        [chatId, JSON.stringify([...row.turns, card].slice(-200)), now],
      );
    }
    const ref = chatId ? `chat:${chatId}:nudge:${id}` : `nudge:${id}`;
    await db.query(
      `INSERT INTO notifications(user_id, item_id, item_version, channel, destination, title, body, state, kind, ref)
     SELECT u.id, $2::uuid, coalesce(i.version, 0), delivery.channel, delivery.destination, 'Reminder', $3,
       CASE WHEN delivery.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'reminder_nudge', $4
     FROM users u LEFT JOIN items i ON i.id = $2
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id AND $5
       UNION ALL SELECT 'email', u.email WHERE $6
     ) delivery WHERE u.id = $1 ON CONFLICT DO NOTHING`,
      [
        userId,
        candidate.entity_kind === "task" ? candidate.entity_id : null,
        candidate.text.slice(0, 2000),
        ref,
        prefs.push,
        email,
      ],
    );
    await announceTo(db, { user_id: userId }, "changed", { area: "assistant" });
    return true;
  });
}

/** Select personal unfinished work; no prompt or model is involved. */
export async function reminderNudgeCandidates(
  userId: string,
  timezone: string,
  now = new Date(),
  db: Pick<Db, "query"> = pool,
): Promise<NudgeCandidate[]> {
  const today = localDateKey(now, timezone);
  const dayStart = dayTime(today, 0, timezone);
  const dayEnd = dayTime(addDays(today, 1), 0, timezone);
  const afternoon = zonedParts(now, timezone).hour >= 14;
  const tasks = (
    await db.query<{
      id: string;
      title: string;
      category: NudgeCandidate["category"];
    }>(
      `SELECT i.id, i.title, CASE
       WHEN i.due_at < $2::timestamptz - interval '1 day' THEN 'overdue'
       WHEN EXISTS(SELECT 1 FROM time_blocks b WHERE b.item_id = i.id AND b.user_id = $1
         AND b.end_at BETWEEN $3 AND $2 AND b.outcome IS NULL) THEN 'session'
       WHEN $5 AND i.due_at >= $3 AND i.due_at < $4 AND i.status = 'todo' AND i.spent_minutes = 0 AND NOT EXISTS(SELECT 1 FROM time_blocks started WHERE started.item_id = i.id AND started.user_id = $1 AND started.started_at IS NOT NULL) THEN 'due'
       ELSE 'deadline' END AS category
     FROM items i WHERE i.user_id = $1 AND i.kind = 'task' AND i.status NOT IN ('done', 'cancelled')
       AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = i.project_id AND p.assistant_off)
       AND (i.due_at < $2::timestamptz - interval '1 day'
         OR EXISTS(SELECT 1 FROM time_blocks b WHERE b.item_id = i.id AND b.user_id = $1 AND b.end_at BETWEEN $3 AND $2 AND b.outcome IS NULL)
         OR $5 AND i.due_at >= $3 AND i.due_at < $4 AND i.status = 'todo' AND i.spent_minutes = 0 AND NOT EXISTS(SELECT 1 FROM time_blocks started WHERE started.item_id = i.id AND started.user_id = $1 AND started.started_at IS NOT NULL)
         OR i.due_at > $2 AND i.due_at <= $2::timestamptz + interval '7 days' AND i.estimate_minutes IS NOT NULL
          AND greatest(i.estimate_minutes - i.spent_minutes, 0) > coalesce((SELECT sum(extract(epoch FROM (b.end_at - b.start_at)) / 60) FROM time_blocks b WHERE b.item_id = i.id AND b.user_id = $1 AND b.start_at > $2 AND b.end_at <= i.due_at), 0))
     ORDER BY i.due_at NULLS LAST, i.id LIMIT 50`,
      [userId, now, dayStart, dayEnd, afternoon],
    )
  ).rows;
  const texts = {
    overdue: "is more than a day overdue.",
    session: "had a planned session end without a check-in.",
    due: "is due today and has not been started.",
    deadline: "has a deadline coming up with too little time booked.",
  };
  const result: NudgeCandidate[] = tasks.map((task) => ({
    key: `task:${task.id}`,
    category: task.category,
    entity_kind: "task",
    entity_id: task.id,
    text: `${task.title} ${texts[task.category as keyof typeof texts]} Done, move it, skip this reminder, or book time?`,
    actions: ["done", "move", "skip", "book"],
  }));
  const promises = (
    await db.query<{ id: string; title: string }>(
      `SELECT r.id, r.title FROM work_records r
   WHERE r.kind = 'promise' AND r.status IN ('open', 'proposed') AND r.due_at <= $2
     AND (r.owner_id = $1 OR r.owner_id IS NULL AND r.created_by = $1 AND r.team_id IS NULL)
     AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.assistant_off AND (p.id = r.project_id OR EXISTS(SELECT 1 FROM docs d WHERE d.id = r.source_doc_id AND d.project_id = p.id)))
   ORDER BY r.due_at, r.id LIMIT 20`,
      [userId, now],
    )
  ).rows;
  result.push(
    ...promises.map((record): NudgeCandidate => ({
      key: `record:${record.id}`,
      category: "promise",
      entity_kind: "record",
      entity_id: record.id,
      text: `Your promise “${record.title}” is due and still open.`,
      actions: ["done", "move", "skip"],
    })),
  );
  const routines = (
    await db.query<{ id: string; instruction: string }>(
      `SELECT id, instruction FROM agent_routines
   WHERE user_id = $1 AND NOT paused AND next_run_at < $2::timestamptz - interval '1 day' AND current_job_id IS NULL
   ORDER BY next_run_at, id LIMIT 20`,
      [userId, now],
    )
  ).rows;
  result.push(
    ...routines.map((routine): NudgeCandidate => ({
      key: `routine:${routine.id}`,
      category: "routine",
      entity_kind: "routine",
      entity_id: routine.id,
      text: `Your routine “${routine.instruction.slice(0, 160)}” missed its scheduled time.`,
      actions: ["move", "skip"],
    })),
  );
  const waiting = (
    await db.query<{ id: string; title: string }>(
      `SELECT j.id, coalesce(c.title, 'Assistant request') AS title FROM ai_jobs j
   LEFT JOIN ai_chats c ON c.id = j.chat_id AND c.user_id = j.user_id
   WHERE j.user_id = $1 AND j.state = 'waiting' AND j.heartbeat_at < $2::timestamptz - interval '3 hours'
   AND (j.chat_id IS NULL OR c.id IS NOT NULL)
   AND (c.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id = c.project_id AND ${visibleProjects("p", { user: "$1", ai: true })}))
   AND (c.scope_kind IS DISTINCT FROM 'task' OR EXISTS(SELECT 1 FROM items i WHERE i.id = c.scope_id AND ${visibleItems("i", { user: "$1", ai: true })}))
   ORDER BY j.heartbeat_at, j.id LIMIT 20`,
      [userId, now],
    )
  ).rows;
  result.push(
    ...waiting.map((job): NudgeCandidate => ({
      key: `job:${job.id}`,
      category: "waiting",
      entity_kind: "job",
      entity_id: job.id,
      text: `“${job.title}” has been waiting for your answer for several hours.`,
      actions: ["skip"],
    })),
  );

  const goals = (
    await db.query<{ id: string; title: string }>(
      `SELECT g.id, g.title FROM goals g
      WHERE g.user_id = $1 AND g.status = 'active' AND g.target_date >= $3::date AND g.target_date <= $4::date
        AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.assistant_off AND (p.id = g.project_id OR EXISTS(SELECT 1 FROM docs d WHERE d.id = g.plan_doc_id AND d.project_id = p.id)))
        AND (NOT EXISTS(SELECT 1 FROM items i WHERE i.user_id = $1 AND i.kind = 'task' AND i.status NOT IN ('done','cancelled') AND (i.project_id = g.project_id OR EXISTS(SELECT 1 FROM doc_task_links l WHERE l.doc_id = g.plan_doc_id AND l.item_id = i.id)))
          OR EXISTS(SELECT 1 FROM items i WHERE i.user_id = $1 AND i.kind = 'task' AND i.status NOT IN ('done','cancelled') AND i.estimate_minutes > i.spent_minutes
            AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id = i.project_id AND p.assistant_off)
            AND (i.project_id = g.project_id OR EXISTS(SELECT 1 FROM doc_task_links l WHERE l.doc_id = g.plan_doc_id AND l.item_id = i.id))
            AND i.estimate_minutes - i.spent_minutes > coalesce((SELECT sum(extract(epoch FROM(b.end_at-b.start_at))/60) FROM time_blocks b WHERE b.item_id=i.id AND b.user_id=$1 AND b.start_at > $2 AND b.end_at <= ((g.target_date + 1)::timestamp AT TIME ZONE $5)),0)))
      ORDER BY g.target_date,g.id LIMIT 20`,
      [userId, now, today, addDays(today, 7), timezone],
    )
  ).rows;
  result.push(
    ...goals.map((goal): NudgeCandidate => ({
      key: `goal:${goal.id}`,
      category: "deadline",
      entity_kind: "goal",
      entity_id: goal.id,
      text: `Your goal “${goal.title}” is due soon with work still to plan or too little time booked.`,
      actions: ["done", "move", "skip"],
    })),
  );
  const comments = (
    await db.query<{ id: string; doc_id: string; title: string }>(
      `SELECT c.id,c.doc_id,d.title FROM doc_comments c JOIN docs d ON d.id=c.doc_id
      WHERE c.resolved_at IS NULL AND c.created_at < $2::timestamptz - interval '1 day'
        AND ${visibleDocs("d", { user: "$1", ai: true })}
        AND EXISTS(SELECT 1 FROM doc_comment_mentions m WHERE m.comment_id=c.id AND m.user_id=$1)
        AND NOT EXISTS(SELECT 1 FROM doc_comments reply WHERE reply.parent_id=c.id AND reply.user_id=$1)
        AND NOT EXISTS(SELECT 1 FROM doc_comments parent WHERE parent.id=c.parent_id AND parent.resolved_at IS NOT NULL)
      ORDER BY c.created_at,c.id LIMIT 20`,
      [userId, now],
    )
  ).rows;
  result.push(
    ...comments.map((comment): NudgeCandidate => ({
      key: `comment:${comment.id}`,
      category: "promise",
      entity_kind: "comment",
      entity_id: comment.id,
      source_id: comment.doc_id,
      text: `A comment mentioning you on “${comment.title}” is still waiting for your reply.`,
      actions: ["done", "skip"],
    })),
  );
  const upcoming = await upcomingExams(db, userId, now, {
    horizonDays: 7,
    limit: null,
  });
  const itemIds = upcoming.flatMap((e) => {
    const match = /^item:([0-9a-f-]{36})\|/i.exec(e.key);
    return match ? [match[1]] : [];
  });
  const allowedItems = new Set(
    (
      await db.query<{ id: string }>(
        `SELECT i.id FROM items i WHERE i.id = ANY($2::uuid[]) AND ${visibleItems("i", { user: "$1", ai: true })}`,
        [userId, itemIds],
      )
    ).rows.map((row) => row.id),
  );
  const currentExams = upcoming.filter((e) => {
    const match = /^item:([0-9a-f-]{36})\|/i.exec(e.key);
    return !match || allowedItems.has(match[1]);
  });
  // A calendar exam gets the same saved identity Study uses. Never replace its notes or target.
  for (const exam of currentExams) {
    await db.query(
      `INSERT INTO study_exams(user_id,exam_key,title,starts_at,all_day)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,exam_key) DO UPDATE
       SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, all_day=EXCLUDED.all_day, updated_at=now()
       WHERE NOT study_exams.own AND (study_exams.title,study_exams.starts_at,study_exams.all_day)
         IS DISTINCT FROM (EXCLUDED.title,EXCLUDED.starts_at,EXCLUDED.all_day)`,
      [userId, exam.key, exam.title, exam.starts_at, exam.all_day],
    );
  }
  const exams = (
    await db.query<{ id: string; exam_key: string; title: string }>(
      `SELECT e.id,e.exam_key,e.title FROM study_exams e WHERE e.user_id=$1 AND e.starts_at>$2 AND e.starts_at<=$2::timestamptz+interval '7 days'
      AND (e.own OR e.exam_key=ANY($3::text[]))
      AND NOT EXISTS(SELECT 1 FROM docs d WHERE d.id=ANY(e.doc_ids) AND NOT ${visibleDocs("d", { user: "$1", ai: true })})
      AND coalesce((SELECT sum(extract(epoch FROM(b.end_at-b.start_at))/60) FROM time_blocks b JOIN items i ON i.id=b.item_id WHERE b.user_id=$1 AND i.user_id=$1 AND i.status NOT IN ('done','cancelled') AND (i.study_exam_id=e.id OR (i.study_exam_id IS NULL AND i.title='Revise for '||e.title)) AND b.start_at>$2 AND b.end_at<=e.starts_at),0) < greatest(30,(SELECT count(*)*2 FROM study_cards card WHERE card.user_id=$1 AND card.doc_id=ANY(e.doc_ids) AND (card.reps=0 OR card.lapses>0)))
      ORDER BY e.starts_at,e.id LIMIT 20`,
      [userId, now, currentExams.map((e) => e.key)],
    )
  ).rows;
  result.push(
    ...exams.map((exam): NudgeCandidate => ({
      key: `exam:${exam.id}`,
      category: "deadline",
      entity_kind: "exam",
      entity_id: exam.id,
      exam_key: exam.exam_key,
      text: `Your exam “${exam.title}” is coming up with little or no revision time booked before it.`,
      actions: ["skip", "book"],
    })),
  );
  const habits = (
    await db.query<{ id: string; name: string; block_id: string }>(
      `SELECT DISTINCT ON(h.id) h.id,h.name,b.id AS block_id FROM habits h JOIN habit_blocks b ON b.habit_id=h.id AND b.user_id=h.user_id
      WHERE h.user_id=$1 AND h.active AND b.outcome IS NULL AND b.end_at<$2 AND b.end_at>=$3
      ORDER BY h.id,b.end_at DESC LIMIT 20`,
      [userId, now, dayStart],
    )
  ).rows;
  result.push(
    ...habits.map((habit): NudgeCandidate => ({
      key: `habit:${habit.id}`,
      category: "habit",
      entity_kind: "habit",
      entity_id: habit.id,
      source_id: habit.block_id,
      text: `Your planned “${habit.name}” habit session ended without a check-in. Did you do it?`,
      actions: ["done", "skip", "book"],
    })),
  );
  const previousWeek = addDays(today, -((weekdayOf(today) + 6) % 7) - 7);
  const missed = (
    await db.query<{
      id: string;
      name: string;
      period: "day" | "week";
      cadence: number;
      completed: number;
      block_id: string | null;
    }>(
      `WITH periods AS (
       SELECT h.*, CASE WHEN h.period = 'week' THEN $4::date ELSE (
         SELECT max(day::date) FROM generate_series($3::date - 7, $3::date - 1, interval '1 day') day
         WHERE extract(dow FROM day)::int = ANY(h.days)
       ) END AS period_day FROM habits h WHERE h.user_id = $1 AND h.active
     ), windows AS (
       SELECT p.*, p.period_day::timestamp AT TIME ZONE $5 AS period_start,
         (p.period_day + CASE WHEN p.period = 'week' THEN 7 ELSE 1 END)::timestamp AT TIME ZONE $5 AS period_end
       FROM periods p
     )
     SELECT w.id, w.name, w.period, w.cadence,
       (SELECT count(*)::int FROM habit_blocks b WHERE b.habit_id = w.id AND b.user_id = $1
         AND b.start_at >= w.period_start AND b.end_at <= w.period_end AND b.outcome = 'done') AS completed,
       (SELECT b.id FROM habit_blocks b WHERE b.habit_id = w.id AND b.user_id = $1
         AND b.start_at >= w.period_start AND b.end_at <= w.period_end AND b.outcome IS NULL
         ORDER BY b.end_at DESC, b.id LIMIT 1) AS block_id
     FROM windows w WHERE w.created_at <= w.period_start AND w.period_end <= $2::timestamptz
       AND (SELECT count(*) FROM habit_blocks b WHERE b.habit_id = w.id AND b.user_id = $1
         AND b.start_at >= w.period_start AND b.end_at <= w.period_end AND b.outcome = 'done') < w.cadence
     ORDER BY w.id LIMIT 20`,
      [userId, now, today, previousWeek, timezone],
    )
  ).rows;
  const alreadyReminded = new Set(habits.map((h) => h.id));
  result.push(
    ...missed
      .filter((h) => !alreadyReminded.has(h.id))
      .map((habit): NudgeCandidate => ({
        key: `habit:${habit.id}`,
        category: "habit",
        entity_kind: "habit",
        entity_id: habit.id,
        ...(habit.block_id ? { source_id: habit.block_id } : {}),
        text: `Your “${habit.name}” habit has ${habit.completed} of ${habit.cadence} sessions checked in for the last ${habit.period === "week" ? "week" : "scheduled day"}.`,
        actions: habit.block_id ? ["done", "skip", "book"] : ["skip", "book"],
      })),
  );
  return result;
}

/** Scan every eligible person in bounded batches without delaying later people another quarter hour. */
export async function scanReminderNudges(now = new Date(), only?: string[]) {
  let afterPerson: string | null = null;
  let sent = 0;
  for (;;) {
    const people: { id: string }[] = (
      await pool.query<{ id: string }>(
        `SELECT u.id FROM users u JOIN agent_grants g ON g.user_id = u.id AND g.kind = 'assistant'
         WHERE NOT u.disabled AND g.suspended_at IS NULL AND g.revoked_at IS NULL
           AND ($1::uuid[] IS NULL OR u.id = ANY($1)) AND ($2::uuid IS NULL OR u.id > $2)
         ORDER BY u.id LIMIT 200`,
        [only ?? null, afterPerson],
      )
    ).rows;
    for (const person of people) {
      const prefs = await loadPrefs(pool, person.id);
      const candidates = await reminderNudgeCandidates(
        person.id,
        prefs.timezone,
        now,
      );
      for (const candidate of candidates)
        if (await postReminderNudge(person.id, prefs.timezone, candidate, now))
          sent++;
    }
    if (people.length < 200) return sent;
    afterPerson = people.at(-1)!.id;
  }
}
