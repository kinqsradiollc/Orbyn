import { randomUUID } from "node:crypto";
import {
  DEFAULT_REMINDER_NUDGES,
  canSendReminderNudge,
  reminderNudgeSettingsInput,
  localDateKey,
  dayTime,
  addDays,
  zonedParts,
  type ReminderNudgeCard,
  type ReminderNudgeSettings,
} from "@orbyn/core";
import { pool, transaction, type Db } from "../db/pool.js";
import { loadPrefs } from "../modules/planner/calendar.js";

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
