import {
  MAX_QUESTION_CHOICES,
  fail,
  type AgentQuestion,
  type QuestionStatus,
} from "@orbyn/core";
import { transaction, type Db, type Queryable } from "../../db/pool.js";
import { announceTo } from "../presence/live.js";
import { emitInbox } from "./emit.js";

/**
 * Questions an agent asks its person (ask_person, H0). In an app that can
 * show a form the question is answered in the chat; otherwise it waits here
 * as a card in Notifications (web and phone, with the choices as buttons)
 * and a push: a yes/no question carries Approve and Decline, a question
 * with choices opens the app on its card. The answer, the default when it
 * runs out, or its running out becomes an "answer" item in the asking
 * connection's inbox.
 */

/** A connection may have this many questions waiting at once. */
export const MAX_OPEN_QUESTIONS = 20;

export type QuestionRow = {
  id: string;
  grant_id: string;
  user_id: string;
  question: string;
  detail: string | null;
  choices: string[];
  yes_no: boolean;
  default_choice: string | null;
  status: QuestionStatus;
  answer: string | null;
  answered_via: "chat" | "app" | "push" | "default" | null;
  answered_at: Date | null;
  created_at: Date;
  expires_at: Date;
  agent?: string;
};

/** A connection's name as the person knows it: the app's, or the key's. */
const AGENT_NAME = `CASE WHEN g.kind = 'oauth' THEN coalesce(nullif(g.client_name, ''), g.name)
  ELSE g.name END`;

const COLUMNS = `q.id, q.grant_id, q.user_id, q.question, q.detail, q.choices, q.yes_no,
  q.default_choice, q.status, q.answer, q.answered_via, q.answered_at, q.created_at,
  q.expires_at, ${AGENT_NAME} AS agent`;

export const questionView = (q: QuestionRow): AgentQuestion => ({
  id: q.id,
  agent: q.agent ?? "Your agent",
  question: q.question,
  detail: q.detail,
  choices: q.choices,
  yes_no: q.yes_no,
  default_choice: q.default_choice,
  status: q.status,
  answer: q.answer,
  created_at: q.created_at.toISOString(),
  expires_at: q.expires_at.toISOString(),
});

/** What the person's answer (or its end) says, for the agent's inbox. */
function answerTitle(q: QuestionRow): string {
  const asked = `“${q.question.slice(0, 120)}”`;
  if (q.status === "expired") return `No answer in time to ${asked}`;
  if (q.answered_via === "default")
    return `No answer in time to ${asked}, so it's your default: ${q.answer}`;
  return `Answered ${asked}: ${q.answer}`;
}

/** Tells the asking connection how a question ended. */
async function tellAgent(db: Queryable, q: QuestionRow) {
  await emitInbox(db, {
    userId: q.user_id,
    grantId: q.grant_id,
    kind: "answer",
    key: `question:${q.id}`,
    title: answerTitle(q),
    body: q.answer ?? "",
    entity: { type: "question", id: q.id },
  });
  await db.query(
    `UPDATE notifications SET read = true
      WHERE user_id = $1 AND kind = 'question' AND ref IN ($2, $2 || ':yes_no')`,
    [q.user_id, `question:${q.id}`],
  );
  await announceTo(db as never, { user_id: q.user_id }, "changed");
}

/**
 * Files a question for the person: its card and a push to their phones.
 * Runs in the calling tool's transaction.
 */
export async function createQuestion(
  db: Queryable,
  q: {
    grantId: string;
    userId: string;
    question: string;
    detail: string | null;
    choices: string[];
    yesNo: boolean;
    defaultChoice: string | null;
    expiresAt: Date;
  },
): Promise<QuestionRow> {
  if (q.choices.length < 2 || q.choices.length > MAX_QUESTION_CHOICES)
    fail(422, `Give 2 to ${MAX_QUESTION_CHOICES} choices.`);
  const open = (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_questions
        WHERE grant_id = $1 AND status = 'open' AND expires_at > now()`,
      [q.grantId],
    )
  ).rows[0].n;
  if (open >= MAX_OPEN_QUESTIONS)
    fail(
      429,
      `This connection already has ${MAX_OPEN_QUESTIONS} questions waiting. Wait for answers first.`,
    );
  const row = (
    await db.query<QuestionRow>(
      `INSERT INTO agent_questions (grant_id, user_id, question, detail, choices,
         yes_no, default_choice, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, grant_id, user_id, question, detail, choices, yes_no,
         default_choice, status, answer, answered_via, answered_at, created_at, expires_at`,
      [
        q.grantId,
        q.userId,
        q.question,
        q.detail,
        q.choices,
        q.yesNo,
        q.defaultChoice,
        q.expiresAt,
      ],
    )
  ).rows[0];
  const who =
    (
      await db.query<{ agent: string }>(
        `SELECT ${AGENT_NAME} AS agent FROM agent_grants g WHERE g.id = $1`,
        [q.grantId],
      )
    ).rows[0]?.agent?.trim() || "Your agent";
  await db.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref)
     SELECT u.id, NULL, 0, c.channel, c.destination, $2, $3,
       CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'question', $4
     FROM users u
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
     ) c
     WHERE u.id = $1 AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [
      q.userId,
      `${who} asks: ${q.question}`.slice(0, 200),
      (q.yesNo
        ? "Approve for yes, Decline for no."
        : `Choose: ${q.choices.join(" · ")}`
      ).slice(0, 2000),
      // A yes/no question's push carries Approve and Decline.
      `question:${row.id}${q.yesNo ? ":yes_no" : ""}`,
    ],
  );
  await announceTo(db as never, { user_id: q.userId }, "changed");
  return { ...row, agent: who };
}

/** One of this connection's questions, or null. */
export async function questionFor(
  db: Queryable,
  grantId: string,
  userId: string,
  id: string,
): Promise<QuestionRow | null> {
  return (
    (
      await db.query<QuestionRow>(
        `SELECT ${COLUMNS} FROM agent_questions q
           JOIN agent_grants g ON g.id = q.grant_id
          WHERE q.id = $1 AND q.grant_id = $2 AND q.user_id = $3`,
        [id, grantId, userId],
      )
    ).rows[0] ?? null
  );
}

/** A question answered in the chat, kept so its status can be looked up. */
export async function recordChatAnswer(
  db: Queryable,
  q: {
    grantId: string;
    userId: string;
    question: string;
    detail: string | null;
    choices: string[];
    yesNo: boolean;
    defaultChoice: string | null;
    answer: string;
  },
): Promise<QuestionRow> {
  return (
    await db.query<QuestionRow>(
      `INSERT INTO agent_questions (grant_id, user_id, question, detail, choices,
         yes_no, default_choice, status, answer, answered_via, answered_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'answered', $8, 'chat', now(), now())
       RETURNING id, grant_id, user_id, question, detail, choices, yes_no,
         default_choice, status, answer, answered_via, answered_at, created_at, expires_at`,
      [
        q.grantId,
        q.userId,
        q.question,
        q.detail,
        q.choices,
        q.yesNo,
        q.defaultChoice,
        q.answer,
      ],
    )
  ).rows[0];
}

/** Questions waiting for the person, newest first (Notifications). */
export async function openQuestions(
  db: Queryable,
  userId: string,
): Promise<AgentQuestion[]> {
  return (
    await db.query<QuestionRow>(
      `SELECT ${COLUMNS} FROM agent_questions q
         JOIN agent_grants g ON g.id = q.grant_id AND g.revoked_at IS NULL
        WHERE q.user_id = $1 AND q.status = 'open' AND q.expires_at > now()
        ORDER BY q.created_at DESC LIMIT 50`,
      [userId],
    )
  ).rows.map(questionView);
}

/** The choice `answer` names (any case; yes/no also from Approve/Decline). */
export function matchChoice(q: QuestionRow, answer: string): string | null {
  const a = answer.trim().toLowerCase();
  if (q.yes_no) {
    if (["yes", "approve", "y", "true"].includes(a)) return q.choices[0];
    if (["no", "decline", "n", "false"].includes(a)) return q.choices[1];
  }
  return q.choices.find((c) => c.toLowerCase() === a) ?? null;
}

/**
 * The person answers a question (its card's buttons, or the push's Approve
 * and Decline). Answering one already answered says how it ended.
 */
export async function answerQuestion(
  userId: string,
  id: string,
  answer: string,
  via: "app" | "push",
): Promise<AgentQuestion> {
  return transaction(async (db) => {
    const q = (
      await db.query<QuestionRow>(
        `SELECT ${COLUMNS} FROM agent_questions q
           JOIN agent_grants g ON g.id = q.grant_id
          WHERE q.id = $1 AND q.user_id = $2 FOR UPDATE OF q`,
        [id, userId],
      )
    ).rows[0];
    if (!q) fail(404, "That question isn't here any more.");
    if (q.status !== "open") return questionView(q);
    if (q.expires_at <= new Date()) {
      const ended = await endQuestion(db, q);
      return questionView(ended);
    }
    const choice = matchChoice(q, answer);
    if (!choice) fail(422, `Answer with one of: ${q.choices.join(", ")}.`);
    const done = {
      ...q,
      status: "answered" as const,
      answer: choice,
      answered_via: via,
    };
    await db.query(
      `UPDATE agent_questions SET status = 'answered', answer = $2,
         answered_via = $3, answered_at = now() WHERE id = $1`,
      [q.id, choice, via],
    );
    await tellAgent(db, done);
    return questionView(done);
  });
}

/** A question past its time: its default, or no answer. */
async function endQuestion(db: Db, q: QuestionRow): Promise<QuestionRow> {
  const ended: QuestionRow = q.default_choice
    ? {
        ...q,
        status: "answered",
        answer: q.default_choice,
        answered_via: "default",
      }
    : { ...q, status: "expired" };
  await db.query(
    `UPDATE agent_questions SET status = $2, answer = $3, answered_via = $4,
       answered_at = CASE WHEN $2 = 'answered' THEN now() END
     WHERE id = $1`,
    [q.id, ended.status, ended.answer, ended.answered_via],
  );
  await tellAgent(db, ended);
  return ended;
}

/**
 * Questions whose time ran out (the worker, each cycle): each gets its
 * default or ends unanswered, and its agent hears. Returns how many.
 */
export async function expireQuestions(limit = 100): Promise<number> {
  return transaction(async (db) => {
    const due = (
      await db.query<QuestionRow>(
        `SELECT ${COLUMNS} FROM agent_questions q
           JOIN agent_grants g ON g.id = q.grant_id
          WHERE q.status = 'open' AND q.expires_at <= now()
          ORDER BY q.expires_at LIMIT $1
          FOR UPDATE OF q SKIP LOCKED`,
        [limit],
      )
    ).rows;
    for (const q of due) await endQuestion(db, q);
    return due.length;
  });
}
