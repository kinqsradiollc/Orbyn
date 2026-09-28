import { randomUUID } from "node:crypto";
import {
  addDays,
  agentJobText,
  clockMinutes,
  docInput,
  dayTime,
  localDateKey,
  mergeAgentKinds,
  parseDoc,
  type AgendaEntry,
  type DigestPrefs,
} from "@orbyn/core";
import { pool, transaction } from "../db/pool.js";
import { keptOutFor } from "../lib/assistant-off.js";
import type { UserRow } from "../lib/auth.js";
import { namedThings } from "../lib/named-things.js";
import {
  agendaEntries,
  calendarEntries,
  loadPrefs,
  timeBlocks,
} from "../modules/planner/calendar.js";
import { habitBlocksIn } from "../modules/planner/habits.js";
import { reviewFor } from "../modules/planner/plans.js";
import { LIVE_CARDS } from "../modules/study/service.js";
import { appLink } from "../modules/booking/service.js";
import { emailEnabled, sendEmail } from "./channels/email.js";
import { chatFor, postChat } from "../modules/chat/channel.js";
import { createDoc } from "../modules/docs/service.js";

/** "9:00 am" in the person's zone. */
function clockOf(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  })
    .format(new Date(iso))
    .toLowerCase();
}

const bullet = (s: string) => `• ${s}`;

function linkText(title: string) {
  return (
    title
      .replace(/[\[\]\r\n]/g, " ")
      .trim()
      .slice(0, 180) || "Open item"
  );
}

function plainText(value: string, max = 500) {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\[\]()*_#`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function linked(title: string, path: string) {
  return `[${linkText(title)}](${appLink(path)})`;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type BriefInputs = {
  userId: string;
  day: string;
  timezone: string;
  events: AgendaEntry[];
  tasks: { id: string; title: string; start_at: string }[];
  blocks: {
    item_id: string;
    title: string;
    start_at: string;
    end_at: string;
  }[];
  conflicts: {
    block: { item_id: string; title: string; start_at: string };
    entry: AgendaEntry;
  }[];
  atRisk: { item_id: string; title: string; deadline_at?: string | null }[];
  unfinished: { item_id: string; title: string }[];
};

/** Create one private Agent brief per local day, safely across worker replicas. */
async function writeMorningBrief(input: BriefInputs): Promise<{
  docId: string;
  events: number;
  tasks: number;
  sessions: number;
  clashes: number;
  slipping: number;
  goals: number;
  ideas: number;
  questions: number;
}> {
  const keptOut = await keptOutFor(pool, input.userId);
  const hiddenIds = new Set([...keptOut.ids, ...keptOut.projects]);
  const hiddenTerms = keptOut.projects.size
    ? (
        await pool.query<{ term: string }>(
          `SELECT name AS term FROM projects WHERE id = ANY($1::uuid[])
           UNION SELECT title FROM items WHERE project_id = ANY($1::uuid[])
           UNION SELECT title FROM docs WHERE project_id = ANY($1::uuid[])
           UNION SELECT title FROM work_records WHERE project_id = ANY($1::uuid[])`,
          [[...keptOut.projects]],
        )
      ).rows
        .map(({ term }) => term.trim().toLocaleLowerCase())
        .filter((term) => term.length >= 3)
    : [];
  const mentionsKeptOut = (value: unknown): boolean => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/[0-9a-f-]{36}/gi))
        if (hiddenIds.has(match[0].toLowerCase())) return true;
      const text = value.toLocaleLowerCase();
      if (hiddenTerms.some((term) => text.includes(term))) return true;
      return false;
    }
    if (Array.isArray(value)) return value.some(mentionsKeptOut);
    if (value && typeof value === "object")
      return Object.values(value).some(mentionsKeptOut);
    return false;
  };
  const visibleEvents = input.events.filter(
    (event) =>
      (!event.item_id || !keptOut.items.has(event.item_id)) &&
      !mentionsKeptOut(event.title),
  );
  const visibleTasks = input.tasks.filter(
    (task) =>
      !keptOut.items.has(task.id) && !mentionsKeptOut(task.title),
  );
  const visibleBlocks = input.blocks.filter(
    (block) =>
      !keptOut.items.has(block.item_id) && !mentionsKeptOut(block.title),
  );
  const visibleConflicts = input.conflicts.filter(
    ({ block, entry }) =>
      !keptOut.items.has(block.item_id) &&
      (!entry.item_id || !keptOut.items.has(entry.item_id)) &&
      !mentionsKeptOut([block.title, entry.title]),
  );
  const visibleAtRisk = input.atRisk.filter(
    (task) =>
      !keptOut.items.has(task.item_id) && !mentionsKeptOut(task.title),
  );
  const visibleUnfinished = input.unfinished.filter(
    (block) =>
      !keptOut.items.has(block.item_id) && !mentionsKeptOut(block.title),
  );
  const [goals, ideas, questions, jobs] = await Promise.all([
    pool.query<{
      id: string;
      title: string;
      target_date: string | null;
      project_id: string | null;
      plan_doc_id: string | null;
      progress: Record<string, unknown> | null;
      checkin: string | null;
      week_of: string | null;
    }>(
      `SELECT g.id, g.title, g.target_date::text, g.project_id, g.plan_doc_id,
              g.progress, recent.summary AS checkin, recent.week_of::text
         FROM goals g
         LEFT JOIN LATERAL (
           SELECT c.summary, c.week_of FROM goals_checkins c
            WHERE c.goal_id = g.id AND c.status = 'done'
            ORDER BY c.week_of DESC LIMIT 1
         ) recent ON true
        WHERE g.user_id = $1 AND g.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM projects hidden
             WHERE hidden.assistant_off AND (
               hidden.id = g.project_id OR EXISTS (
                 SELECT 1 FROM docs plan
                  WHERE plan.id = g.plan_doc_id AND plan.project_id = hidden.id
               )
             )
          )
        ORDER BY g.target_date NULLS LAST, g.updated_at DESC LIMIT 12`,
      [input.userId],
    ),
    pool.query<{
      title: string;
      summary: string;
      proposal_id: string;
      changes: unknown;
    }>(
      `SELECT i.title, i.summary, i.proposal_id, p.changes
         FROM assistant_ideas i JOIN proposals p ON p.id = i.proposal_id
        WHERE i.user_id = $1 AND p.status = 'pending'
        ORDER BY i.created_at DESC LIMIT 3`,
      [input.userId],
    ),
    pool.query<{ id: string; question: string; detail: string | null }>(
      `SELECT id, question, detail FROM agent_questions
        WHERE user_id = $1 AND status = 'open' AND expires_at > now()
        ORDER BY created_at LIMIT 12`,
      [input.userId],
    ),
    pool.query<{ run_state: unknown }>(
      `SELECT run_state FROM ai_jobs
        WHERE user_id = $1 AND state = 'waiting' AND run_state IS NOT NULL
          AND run_state->'state'->'waiting'->>'kind' IN ('person', 'approval')
        ORDER BY created_at DESC LIMIT 12`,
      [input.userId],
    ),
  ]);

  const sections: string[] = [`# ${input.day} — Morning brief`, "## Today"];
  const today: string[] = [];
  for (const event of visibleEvents.slice(0, 20)) {
    const when = event.all_day
      ? "All day"
      : clockOf(event.start_at, input.timezone);
    const path = event.item_id ? `/app/task/${event.item_id}` : "/app/today";
    today.push(
      `- ${when} — ${linked(event.title, path)}${event.calendar ? ` (${event.calendar})` : ""}`,
    );
  }
  for (const task of visibleTasks.slice(0, 12))
    today.push(
      `- Due ${clockOf(task.start_at, input.timezone)} — ${linked(task.title, `/app/task/${task.id}`)}`,
    );
  for (const block of visibleBlocks.slice(0, 20))
    today.push(
      `- Session ${clockOf(block.start_at, input.timezone)}–${clockOf(block.end_at, input.timezone)} — ${linked(block.title, `/app/task/${block.item_id}`)}`,
    );
  sections.push(
    ...(today.length ? today : ["- Nothing scheduled for the rest of today."]),
  );

  sections.push("## Clashes");
  const conflicts = visibleConflicts.slice(0, 12).map(({ block, entry }) => {
    const eventPath = entry.item_id
      ? `/app/task/${entry.item_id}`
      : "/app/today";
    return `- ${linked(block.title, `/app/task/${block.item_id}`)} overlaps ${linked(entry.title, eventPath)} at ${clockOf(block.start_at, input.timezone)}.`;
  });
  sections.push(
    ...(conflicts.length ? conflicts : ["- No calendar clashes today."]),
  );

  sections.push("## Slipping work");
  const slipping = new Map<string, string>();
  for (const task of visibleAtRisk)
    slipping.set(
      task.item_id,
      `- At risk — ${linked(task.title, `/app/task/${task.item_id}`)}${task.deadline_at ? ` (deadline ${clockOf(task.deadline_at, input.timezone)})` : ""}`,
    );
  for (const block of visibleUnfinished)
    slipping.set(
      block.item_id,
      `- Still open after a planned session — ${linked(block.title, `/app/task/${block.item_id}`)}`,
    );
  sections.push(
    ...([...slipping.values()].slice(0, 12).length
      ? [...slipping.values()].slice(0, 12)
      : ["- No slipping work flagged."]),
  );

  sections.push("## Goal progress");
  const goalLines = goals.rows
    .filter(
      (goal) =>
        !mentionsKeptOut(goal.title) &&
        !mentionsKeptOut(goal.progress) &&
        !mentionsKeptOut(goal.checkin),
    )
    .map((goal) => {
    const progress = objectValue(goal.progress);
    const summary =
      goal.checkin ??
      (typeof progress.summary === "string"
        ? progress.summary
        : "No weekly check-in yet.");
    const path = goal.plan_doc_id
      ? `/app/doc/${goal.plan_doc_id}`
      : goal.project_id
        ? `/app/project/${goal.project_id}`
        : "/app/assistant";
    return `- ${linked(goal.title, path)}${goal.target_date ? ` · target ${goal.target_date}` : ""}: ${plainText(summary) || "No weekly check-in yet."}`;
    });
  sections.push(...(goalLines.length ? goalLines : ["- No active goals."]));

  sections.push("## Ideas ready to review");
  const ideaLines = ideas.rows
    .filter(
      (idea) =>
        !mentionsKeptOut(idea.title) &&
        !mentionsKeptOut(idea.summary) &&
        !mentionsKeptOut(idea.changes),
    )
    .map(
      (idea) =>
        `- ${linked(idea.title, `/app/review/${idea.proposal_id}`)} — ${plainText(idea.summary)}`,
    );
  sections.push(
    ...(ideaLines.length ? ideaLines : ["- No new ideas waiting for review."]),
  );

  sections.push("## Questions and approvals");
  const questionLines = questions.rows
    .filter((question) => !mentionsKeptOut([question.question, question.detail]))
    .map(
      (question) =>
        `- ${linked(question.question, "/app/review")}${question.detail ? ` — ${plainText(question.detail)}` : ""}`,
    );
  for (const job of jobs.rows) {
    if (mentionsKeptOut(job.run_state)) continue;
    const envelope = objectValue(job.run_state);
    const state = objectValue(envelope.state);
    const waiting = objectValue(state.waiting);
    const question =
      typeof waiting.question === "string" ? waiting.question.trim() : "";
    if (question)
      questionLines.push(
        `- ${linked(question, "/app/assistant")}${waiting.kind === "approval" ? " — plan approval needed" : " — your answer is needed"}`,
      );
  }
  sections.push(
    ...(questionLines.length
      ? questionLines.slice(0, 12)
      : ["- No questions or approvals waiting."]),
  );
  sections.push(
    "## Open your day",
    `- [Today in Orbyn](${appLink("/app/today")})`,
  );

  const markdown = sections.join("\n\n");
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `assistant-brief:${input.userId}:${input.day}`,
    ]);
    const existing = (
      await db.query<{ doc_id: string | null }>(
        "SELECT doc_id FROM assistant_briefs WHERE user_id = $1 AND local_day = $2::date FOR UPDATE",
        [input.userId, input.day],
      )
    ).rows[0];
    if (existing?.doc_id)
      return {
        docId: existing.doc_id,
        events: visibleEvents.length,
        tasks: visibleTasks.length,
        sessions: visibleBlocks.length,
        clashes: visibleConflicts.length,
        slipping: new Set([
          ...visibleAtRisk.map((task) => task.item_id),
          ...visibleUnfinished.map((block) => block.item_id),
        ]).size,
        goals: goalLines.length,
        ideas: ideaLines.length,
        questions: Math.min(questionLines.length, 12),
      };
    const user = (
      await db.query<UserRow>(
        "SELECT * FROM users WHERE id = $1 AND disabled = false",
        [input.userId],
      )
    ).rows[0];
    if (!user) throw new Error("The brief owner is no longer active.");
    const doc = await createDoc(
      db,
      user,
      docInput.parse({
        title: `Assistant brief — ${input.day}`,
        kind: "agent",
        content: parseDoc(markdown),
      }),
    );
    await db.query(
      `INSERT INTO assistant_briefs (user_id, local_day, doc_id)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (user_id, local_day) DO UPDATE SET doc_id = EXCLUDED.doc_id, created_at = now()`,
      [input.userId, input.day, doc.id],
    );
    return {
      docId: doc.id,
      events: visibleEvents.length,
      tasks: visibleTasks.length,
      sessions: visibleBlocks.length,
      clashes: visibleConflicts.length,
      slipping: new Set([
        ...visibleAtRisk.map((task) => task.item_id),
        ...visibleUnfinished.map((block) => block.item_id),
      ]).size,
      goals: goalLines.length,
      ideas: ideaLines.length,
      questions: Math.min(questionLines.length, 12),
    };
  });
}

/** "9:00 am — Lecture (Uni timetable)", or "All day — Exam (Exams)". */
function agendaLine(e: AgendaEntry, tz: string) {
  const when = e.all_day ? "All day" : clockOf(e.start_at, tz);
  return bullet(`${when} — ${e.title}${e.calendar ? ` (${e.calendar})` : ""}`);
}

/** The most things by name the agents section lists. */
const AGENT_TOP_ITEMS = 5;

/**
 * "What your agents did" (H7): since yesterday's digest, per connected
 * agent what it changed in plain words, the top things it touched with
 * their links, questions and suggestions still waiting for the person, and
 * where to undo any of it. Empty (no section) when no agent changed or
 * suggested anything.
 */
export async function buildAgentSection(
  userId: string,
  now: Date,
): Promise<string[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const rows = (
    await pool.query<{
      grant_id: string | null;
      agent: string;
      team: string | null;
      team_id: string | null;
      outcome: string;
      changes: number;
      kinds: Record<string, number> | null;
      target_ids: string[];
    }>(
      `SELECT a.grant_id, coalesce(nullif(g.client_name, ''), g.name,
                nullif(a.client_name, ''), 'An agent') AS agent,
              t.name AS team, a.team_id, a.outcome, a.changes, a.kinds,
              a.target_ids
         FROM agent_activity a
         LEFT JOIN agent_grants g ON g.id = a.grant_id
         LEFT JOIN teams t ON t.id = a.team_id
        WHERE a.user_id = $1 AND a.tier <> 'R' AND a.at >= $2 AND a.at < $3
          AND a.undone_at IS NULL AND a.tool <> 'apply_plan'
          AND (a.changes > 0 OR a.outcome = 'proposed')
        ORDER BY a.at DESC
        LIMIT 1000`,
      [userId, since, now],
    )
  ).rows;
  if (!rows.length) return [];
  // Per agent: what it changed, and the one team it was all in, if one.
  const agents = new Map<
    string,
    {
      name: string;
      kinds: Record<string, number>[];
      teams: Set<string | null>;
      proposed: number;
    }
  >();
  for (const r of rows) {
    const key = r.grant_id ?? r.agent;
    const a = agents.get(key) ?? {
      name: r.agent,
      kinds: [],
      teams: new Set<string | null>(),
      proposed: 0,
    };
    if (r.changes > 0) {
      a.kinds.push(r.kinds ?? {});
      a.teams.add(r.team);
    }
    if (r.outcome === "proposed") a.proposed++;
    agents.set(key, a);
  }
  const lines = ["What your agents did:"];
  for (const a of agents.values()) {
    const kinds = mergeAgentKinds(a.kinds);
    const space = a.teams.size === 1 ? [...a.teams][0] : null;
    const did = Object.keys(kinds).length
      ? agentJobText(a.name, kinds, space)
      : "";
    const asked = a.proposed
      ? `${a.name} suggested ${a.proposed === 1 ? "a change" : `${a.proposed} changes`} for your review.`
      : "";
    lines.push(bullet([did, asked].filter(Boolean).join(" ")));
  }
  // The things touched most recently, by name, that still open.
  const seen = new Set<string>();
  const wanted: { kind: "task" | "doc" | "project"; id: string }[] = [];
  for (const r of rows)
    for (const t of r.target_ids ?? []) {
      const m = /^(task|event|doc|project):([0-9a-f-]{36})/i.exec(t);
      if (!m || wanted.length >= AGENT_TOP_ITEMS * 3) continue;
      const kind = (
        m[1].toLowerCase() === "event" ? "task" : m[1].toLowerCase()
      ) as "task" | "doc" | "project";
      const key = `${kind}:${m[2].toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push({ kind, id: m[2].toLowerCase() });
    }
  const titles = await namedThings(pool, userId, wanted);
  const top = wanted
    .filter((w) => titles.has(`${w.kind}:${w.id}`))
    .slice(0, AGENT_TOP_ITEMS);
  if (top.length) {
    lines.push("Things they touched:");
    lines.push(
      ...top.map((w) =>
        bullet(
          `${titles.get(`${w.kind}:${w.id}`)} — ${appLink(`/app/${w.kind}/${w.id}`)}`,
        ),
      ),
    );
  }
  const waiting = (
    await pool.query<{ reviews: number; questions: number }>(
      `SELECT (SELECT count(*)::int FROM proposals
                WHERE user_id = $1 AND source = 'agent' AND status = 'pending'
                  AND expires_at > $2) AS reviews,
              (SELECT count(*)::int FROM agent_questions
                WHERE user_id = $1 AND status = 'open' AND expires_at > $2) AS questions`,
      [userId, now],
    )
  ).rows[0];
  const waits = [
    waiting.questions
      ? `${waiting.questions} question${waiting.questions === 1 ? "" : "s"}`
      : "",
    waiting.reviews
      ? `${waiting.reviews} suggestion${waiting.reviews === 1 ? "" : "s"} to review`
      : "",
  ].filter(Boolean);
  if (waits.length)
    lines.push(
      `Waiting for you: ${waits.join(" and ")} — ${appLink("/app/review")}`,
    );
  lines.push(
    `Something not right? Undo any change, or a whole job, in Settings → Connected agents: ${appLink("/app/agents")}`,
  );
  return lines;
}

/** The morning agenda: today's events, due tasks, set-aside time and habits. */
export async function buildMorning(
  userId: string,
  name: string,
  now: Date,
  tz: string,
  options: { agents?: boolean } = {},
): Promise<{ subject: string; lines: string[] }> {
  const today = localDateKey(now, tz);
  const dayEnd = dayTime(addDays(today, 1), 0, tz);
  const [entries, agenda, blocks, habits, review, identity] = await Promise.all(
    [
      calendarEntries(pool, userId, now, dayEnd),
      agendaEntries(pool, userId, dayTime(today, 0, tz), dayEnd),
      timeBlocks(pool, userId, now, dayEnd),
      habitBlocksIn(pool, userId, now, dayEnd),
      reviewFor(pool, userId, now),
      pool.query<{ name: string }>(
        "SELECT name FROM agent_settings WHERE user_id = $1",
        [userId],
      ),
    ],
  );
  const agentName = identity.rows[0]?.name ?? "Orbyn";
  // Your events and your subscribed calendars' (classes, shifts, exams),
  // all-day ones first. Timed ones already over are left out.
  const nowIso = now.toISOString();
  const events = agenda
    .filter((e) => e.all_day || e.end_at > nowIso)
    .sort((a, b) => Number(b.all_day) - Number(a.all_day));
  const dueTasks = entries
    .filter(
      (e) =>
        e.kind === "task" && e.status !== "done" && e.status !== "cancelled",
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const lines = [
    `Good morning, ${name}. ${agentName} here with your day ahead.`,
  ];
  if (!events.length && !dueTasks.length && !blocks.length && !habits.length)
    lines.push("Nothing scheduled today — a clear page.");
  if (events.length) {
    lines.push("Today’s events:");
    lines.push(...events.slice(0, 20).map((e) => agendaLine(e, tz)));
  }
  if (dueTasks.length) {
    lines.push("Due today:");
    lines.push(...dueTasks.slice(0, 12).map((t) => bullet(t.title)));
  }
  if (blocks.length) {
    lines.push("Your sessions:");
    lines.push(
      ...blocks
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .map((b) =>
          bullet(
            `${clockOf(b.start_at, tz)}–${clockOf(b.end_at, tz)} — ${b.title}`,
          ),
        ),
    );
  }
  // Cards due today, which the "Review cards" habit (made by Study) names.
  const cardsDue = (
    await pool.query<{ due: number }>(
      `SELECT count(*) FILTER (WHERE c.reps > 0 AND c.due_at < $2)::int AS due
         FROM ${LIVE_CARDS} WHERE c.user_id = $1`,
      [userId, dayEnd],
    )
  ).rows[0].due;
  const isReview = (name: string) => /^review cards$/i.test(name.trim());
  // A review habit says how many cards wait, and nothing when none do.
  const habitLines = habits
    .filter((h) => !isReview(h.name) || cardsDue > 0)
    .map((h) =>
      bullet(
        `${clockOf(h.start_at, tz)} — ${h.name}${
          isReview(h.name)
            ? ` (${cardsDue} card${cardsDue === 1 ? "" : "s"} due)`
            : ""
        }`,
      ),
    );
  if (habitLines.length) {
    lines.push("Habits:");
    lines.push(...habitLines);
  }
  if (review.at_risk.length) {
    lines.push("Heads up — at risk of being late:");
    lines.push(...review.at_risk.slice(0, 3).map((t) => bullet(t.title)));
  }
  if (cardsDue)
    lines.push(
      `Study: ${cardsDue} card${cardsDue === 1 ? "" : "s"} to review today.`,
    );
  // What connected agents did since yesterday's digest, unless turned off.
  if (options.agents !== false)
    lines.push(...(await buildAgentSection(userId, now)));
  const todayConflicts = review.conflicts.filter(
    ({ block }) => block.start_at < dayEnd.toISOString(),
  );
  const brief = await writeMorningBrief({
    userId,
    day: today,
    timezone: tz,
    events,
    tasks: dueTasks.map((task) => ({
      id: task.item_id!,
      title: task.title,
      start_at: task.start_at,
    })),
    blocks: blocks.map((block) => ({
      item_id: block.item_id,
      title: block.title,
      start_at: block.start_at,
      end_at: block.end_at,
    })),
    conflicts: todayConflicts,
    atRisk: review.at_risk,
    unfinished: review.unfinished,
  });
  lines.push(
    `Your private Assistant brief: ${appLink(`/app/doc/${brief.docId}`)}`,
  );
  lines.push(
    `Brief summary: ${brief.events} ${brief.events === 1 ? "event" : "events"}, ${brief.tasks} ${brief.tasks === 1 ? "task" : "tasks"} due, ${brief.sessions} ${brief.sessions === 1 ? "session" : "sessions"}, ${brief.clashes} ${brief.clashes === 1 ? "clash" : "clashes"}, ${brief.slipping} ${brief.slipping === 1 ? "item" : "items"} at risk, ${brief.goals} active goals, ${brief.ideas} ideas to review, and ${brief.questions} questions or approvals waiting.`,
  );
  lines.push(`Open your day: ${appLink("/app")}`);
  return { subject: "Your day ahead", lines };
}

/** The evening review: what’s still open, and a look at tomorrow. */
export async function buildEvening(
  userId: string,
  name: string,
  now: Date,
  tz: string,
  _options: { agents?: boolean } = {},
): Promise<{ subject: string; lines: string[] }> {
  const today = localDateKey(now, tz);
  const tomorrow = addDays(today, 1);
  const tomStart = dayTime(tomorrow, 0, tz);
  const tomEnd = dayTime(addDays(tomorrow, 1), 0, tz);
  const [review, done, tomorrowEntries, tomorrowAgenda, identity] =
    await Promise.all([
      reviewFor(pool, userId, now),
      pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM items
         WHERE user_id = $1 AND status = 'done'
           AND updated_at >= $2 AND updated_at < $3`,
        [userId, dayTime(today, 0, tz).toISOString(), tomStart.toISOString()],
      ),
      calendarEntries(pool, userId, tomStart, tomEnd),
      agendaEntries(pool, userId, tomStart, tomEnd),
      pool.query<{ name: string }>(
        "SELECT name FROM agent_settings WHERE user_id = $1",
        [userId],
      ),
    ]);
  const agentName = identity.rows[0]?.name ?? "Orbyn";
  const finished = done.rows[0].n;
  const tomorrowEvents = tomorrowAgenda.sort(
    (a, b) => Number(b.all_day) - Number(a.all_day),
  );
  const tomorrowTasks = tomorrowEntries.filter(
    (e) => e.kind === "task" && e.status !== "done" && e.status !== "cancelled",
  );

  const lines = [
    `Winding down, ${name}. ${agentName} here with today's wrap-up.`,
  ];
  lines.push(
    finished
      ? `You finished ${finished} thing${finished === 1 ? "" : "s"} today. Nice work.`
      : "A quieter day — that’s fine too.",
  );
  if (review.unfinished.length) {
    lines.push("Still open from earlier:");
    lines.push(...review.unfinished.slice(0, 8).map((b) => bullet(b.title)));
  }
  if (tomorrowEvents.length || tomorrowTasks.length) {
    lines.push("Tomorrow:");
    lines.push(...tomorrowEvents.slice(0, 12).map((e) => agendaLine(e, tz)));
    lines.push(...tomorrowTasks.slice(0, 8).map((t) => bullet(t.title)));
  } else lines.push("Nothing on the calendar for tomorrow yet.");
  const reviewed = (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM study_reviews WHERE user_id = $1 AND at >= $2",
      [userId, dayTime(today, 0, tz).toISOString()],
    )
  ).rows[0].n;
  if (reviewed)
    lines.push(
      `You reviewed ${reviewed} card${reviewed === 1 ? "" : "s"} today.`,
    );
  lines.push(`Plan tomorrow: ${appLink("/app")}`);
  return { subject: "Today’s wrap-up", lines };
}

const build = {
  morning: buildMorning,
  evening: buildEvening,
} as const;
type Kind = keyof typeof build;

/** Local minutes past midnight, in `tz`. */
function localMinutes(now: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).formatToParts(now);
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0");
  const m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/**
 * Send any digest that has come due. A person gets each digest once a day,
 * claimed by inserting a digest_sends row before sending, so several notifier
 * replicas never send twice. Runs only when a mail server is configured.
 */
export async function scanDigests(now = new Date()) {
  const mailOn = await emailEnabled();
  const rows = (
    await pool.query<{
      user_id: string;
      email: string;
      name: string;
      timezone: string;
      digest: Partial<DigestPrefs> | null;
      has_chat: boolean;
    }>(
      `SELECT p.user_id, u.email, u.name, p.timezone, p.digest,
              u.chat_webhook_kind IS NOT NULL AS has_chat
         FROM planner_prefs p JOIN users u ON u.id = p.user_id
        WHERE u.disabled = false
          AND ((p.digest->>'morning')::boolean OR (p.digest->>'evening')::boolean)`,
    )
  ).rows;
  // Nothing can be delivered without at least one channel.
  if (!mailOn && !rows.some((r) => r.has_chat)) return;
  for (const row of rows) {
    const tz = row.timezone || "UTC";
    const mins = localMinutes(now, tz);
    const on = localDateKey(now, tz);
    for (const kind of ["morning", "evening"] as Kind[]) {
      const d = row.digest ?? {};
      if (!d[kind]) continue;
      const at = clockMinutes(
        d[`${kind}_time`] ?? (kind === "morning" ? "07:00" : "17:00"),
      );
      if (mins < at) continue;
      // Claim the send; only the replica that inserts the row sends the email.
      const won = await pool.query(
        `INSERT INTO digest_sends (user_id, kind, on_date) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING RETURNING user_id`,
        [row.user_id, kind, on],
      );
      if (!won.rowCount) continue;
      try {
        const { subject, lines } = await build[kind](
          row.user_id,
          row.name,
          now,
          tz,
          { agents: d.agents !== false },
        );
        const text = lines.filter(Boolean).join("\n\n");
        if (mailOn)
          await sendEmail({
            id: randomUUID(),
            destination: row.email,
            title: subject,
            body: text,
          });
        if (row.has_chat) {
          const chat = await chatFor(row.user_id);
          if (chat)
            await postChat(chat.kind, chat.url, `*${subject}*\n\n${text}`);
        }
      } catch {
        // A failed send isn't retried today; a missed digest beats a repeat.
      }
    }
  }
}
