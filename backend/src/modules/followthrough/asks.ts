import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import {
  actionSchema,
  askReplyInput,
  askSettleInput,
  dateLabel,
  fail,
  itemBody,
  type TaskAsk,
} from "@orbyn/core";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { loadItem, mutate } from "../items/service.js";
import { announceTo } from "../presence/live.js";

const COLUMNS = `a.id, a.item_id, i.title AS item_title, a.asked_by, b.name AS asked_by_name,
  a.asked_of, o.name AS asked_of_name, a.status, a.due_at, a.estimate_minutes,
  a.counter_due_at, a.counter_estimate_minutes, a.message, a.reply,
  a.created_at, a.updated_at`;
const FROM = `task_asks a JOIN items i ON i.id = a.item_id
  JOIN users b ON b.id = a.asked_by JOIN users o ON o.id = a.asked_of`;

type AskRow = Omit<
  TaskAsk,
  "due_at" | "counter_due_at" | "created_at" | "updated_at"
> & {
  due_at: Date | null;
  counter_due_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const toAsk = (r: AskRow): TaskAsk => ({
  ...r,
  due_at: r.due_at?.toISOString() ?? null,
  counter_due_at: r.counter_due_at?.toISOString() ?? null,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

const when = (d: Date | string | null) =>
  d ? dateLabel(typeof d === "string" ? d : d.toISOString()) : "no date";

/** Tell someone in the app (and on their phone) about an ask. */
async function notify(
  db: Queryable,
  userId: string,
  itemId: string,
  askId: string,
  title: string,
  body: string,
) {
  await db.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref)
     SELECT $1::uuid, $2::uuid, 0, c.channel, c.destination, $3, $4,
       CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'ask', $5
     FROM users u
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
     ) c
     WHERE u.id = $1::uuid AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [userId, itemId, title.slice(0, 200), body.slice(0, 2000), askId],
  );
  await announceTo(db, { user_id: userId }, "changed");
}

/**
 * A team task handed to someone else becomes an ask: they can take it on,
 * suggest another date or length, or say they can't. Called when a task is
 * created with, or changed to, an assignee other than the person saving.
 */
export async function openAsk(
  db: Db,
  actorId: string,
  item: {
    id: string;
    title: string;
    assignee_id?: string | null;
    due_at: string | null;
    estimate_minutes?: number | null;
  },
) {
  if (!item.assignee_id || item.assignee_id === actorId) return;
  // Whatever was in play for this task is overtaken by the new ask.
  await db.query(
    `UPDATE task_asks SET status = 'withdrawn', updated_at = now()
      WHERE item_id = $1 AND status IN ('open', 'countered')`,
    [item.id],
  );
  const ask = (
    await db.query<{ id: string; name: string }>(
      `INSERT INTO task_asks (item_id, asked_by, asked_of, due_at, estimate_minutes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, (SELECT name FROM users WHERE id = $2) AS name`,
      [
        item.id,
        actorId,
        item.assignee_id,
        item.due_at,
        item.estimate_minutes ?? null,
      ],
    )
  ).rows[0];
  await notify(
    db,
    item.assignee_id,
    item.id,
    ask.id,
    `${ask.name} asked you: ${item.title}`,
    item.due_at
      ? `By ${when(item.due_at)}. Take it on, suggest another date, or say you can't.`
      : "Take it on, suggest a date, or say you can't.",
  );
}

async function lockAsk(db: Db, id: string) {
  const row = (
    await db.query<AskRow>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE a.id = $1 FOR UPDATE OF a`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Ask not found");
  return row;
}

/** Change the task through the usual path, so its rules and history hold. */
async function changeItem(
  db: Db,
  actor: { id: string; role: "admin" | "member" },
  itemId: string,
  patch: Record<string, unknown>,
) {
  const item = await loadItem(db, itemId);
  const { progress: _progress, version: _version, ...body } = itemBody(item);
  await mutate(
    db,
    actor,
    actionSchema.parse({
      operation: "update",
      item_id: itemId,
      version: item.version,
      data: { ...body, ...patch },
    }),
  );
}

/** Asks waiting on `userId`, waiting on others, and lately settled. */
export async function listAsks(db: Queryable, userId: string) {
  const rows = (
    await db.query<AskRow>(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE (a.asked_of = $1 OR a.asked_by = $1)
          AND (a.status IN ('open', 'countered')
               OR a.updated_at > now() - interval '7 days')
        ORDER BY a.updated_at DESC LIMIT 100`,
      [userId],
    )
  ).rows.map(toAsk);
  return {
    /** Waiting for your answer. */
    to_me: rows.filter(
      (a) =>
        (a.asked_of === userId && a.status === "open") ||
        (a.asked_by === userId && a.status === "countered"),
    ),
    /** Waiting for someone else's. */
    from_me: rows.filter(
      (a) =>
        (a.asked_by === userId && a.status === "open") ||
        (a.asked_of === userId && a.status === "countered"),
    ),
    recent: rows.filter((a) => a.status !== "open" && a.status !== "countered"),
  };
}

/** The ask on a task, for its detail: the one in play, else the last one. */
export async function askOnItem(
  db: Queryable,
  userId: string,
  itemId: string,
): Promise<TaskAsk | null> {
  const row = (
    await db.query<AskRow>(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE a.item_id = $1 AND (a.asked_by = $2 OR a.asked_of = $2)
        ORDER BY (a.status IN ('open', 'countered')) DESC, a.updated_at DESC
        LIMIT 1`,
      [itemId, userId],
    )
  ).rows[0];
  return row ? toAsk(row) : null;
}

/** One ask `userId` is part of (404 otherwise), for checks before a change. */
export async function askFor(db: Queryable, userId: string, askId: string) {
  const row = (
    await db.query<AskRow>(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE a.id = $1 AND (a.asked_by = $2 OR a.asked_of = $2)`,
      [askId, userId],
    )
  ).rows[0];
  if (!row) fail(404, "Ask not found");
  return toAsk(row);
}

/** The person asked answers: take it on, suggest another plan, or decline. */
export async function replyToAsk(
  db: Db,
  u: { id: string; name: string; role: "admin" | "member" },
  askId: string,
  input: z.input<typeof askReplyInput>,
): Promise<TaskAsk> {
  const d = askReplyInput.parse(input);
  const ask = await lockAsk(db, askId);
  if (ask.asked_of !== u.id) fail(404, "Ask not found");
  if (ask.status !== "open") fail(409, "This ask has already been answered.");
  if (d.action === "accept") {
    await db.query(
      `UPDATE task_asks SET status = 'accepted', reply = $2, updated_at = now()
        WHERE id = $1`,
      [ask.id, d.message],
    );
    await notify(
      db,
      ask.asked_by,
      ask.item_id,
      ask.id,
      `${ask.asked_of_name} took on ${ask.item_title}`,
      d.message || `By ${when(ask.due_at)}.`,
    );
  } else if (d.action === "counter") {
    await db.query(
      `UPDATE task_asks SET status = 'countered', counter_due_at = $2,
         counter_estimate_minutes = $3, reply = $4, updated_at = now()
        WHERE id = $1`,
      [
        ask.id,
        d.due_at === undefined ? ask.due_at : d.due_at,
        d.estimate_minutes === undefined
          ? ask.estimate_minutes
          : d.estimate_minutes,
        d.message,
      ],
    );
    await notify(
      db,
      ask.asked_by,
      ask.item_id,
      ask.id,
      `${ask.asked_of_name} suggests another plan for ${ask.item_title}`,
      [
        d.due_at !== undefined ? `By ${when(d.due_at)} instead.` : "",
        d.estimate_minutes ? `About ${d.estimate_minutes} min.` : "",
        d.message,
      ]
        .filter(Boolean)
        .join(" "),
    );
  } else {
    await db.query(
      `UPDATE task_asks SET status = 'declined', reply = $2, updated_at = now()
        WHERE id = $1`,
      [ask.id, d.message],
    );
    // Not theirs any more: it goes back unassigned.
    await changeItem(db, u, ask.item_id, { assignee_id: null });
    await notify(
      db,
      ask.asked_by,
      ask.item_id,
      ask.id,
      `${ask.asked_of_name} can't take on ${ask.item_title}`,
      d.message,
    );
  }
  return toAsk(await lockAsk(db, ask.id));
}

/** The asker settles: agree to a suggestion, keep their date, or withdraw. */
export async function settleAsk(
  db: Db,
  u: { id: string; name: string; role: "admin" | "member" },
  askId: string,
  input: z.input<typeof askSettleInput>,
): Promise<TaskAsk> {
  const d = askSettleInput.parse(input);
  const ask = await lockAsk(db, askId);
  if (ask.asked_by !== u.id) fail(404, "Ask not found");
  if (d.action === "withdraw") {
    if (ask.status !== "open" && ask.status !== "countered")
      fail(409, "This ask is already settled.");
    await db.query(
      `UPDATE task_asks SET status = 'withdrawn', updated_at = now() WHERE id = $1`,
      [ask.id],
    );
    await changeItem(db, u, ask.item_id, { assignee_id: null });
    await notify(
      db,
      ask.asked_of,
      ask.item_id,
      ask.id,
      `${ask.asked_by_name} no longer needs you for ${ask.item_title}`,
      d.message,
    );
    return toAsk(await lockAsk(db, ask.id));
  }
  if (ask.status !== "countered") fail(409, "There's no suggestion to answer.");
  if (d.action === "agree") {
    await changeItem(db, u, ask.item_id, {
      due_at: ask.counter_due_at?.toISOString() ?? null,
      ...(ask.counter_estimate_minutes
        ? { estimate_minutes: ask.counter_estimate_minutes }
        : {}),
    });
    await db.query(
      `UPDATE task_asks SET status = 'accepted', due_at = counter_due_at,
         estimate_minutes = coalesce(counter_estimate_minutes, estimate_minutes),
         updated_at = now()
        WHERE id = $1`,
      [ask.id],
    );
    await notify(
      db,
      ask.asked_of,
      ask.item_id,
      ask.id,
      `${ask.asked_by_name} agreed: ${ask.item_title}`,
      `By ${when(ask.counter_due_at)}.`,
    );
  } else {
    // Keep the original: it goes back to them as asked, with a word.
    await db.query(
      `UPDATE task_asks SET status = 'open', counter_due_at = NULL,
         counter_estimate_minutes = NULL, message = $2, updated_at = now()
        WHERE id = $1`,
      [ask.id, d.message],
    );
    await notify(
      db,
      ask.asked_of,
      ask.item_id,
      ask.id,
      `${ask.asked_by_name} still needs ${ask.item_title} by ${when(ask.due_at)}`,
      d.message || "Take it on, or say you can't.",
    );
  }
  return toAsk(await lockAsk(db, ask.id));
}

/**
 * Negotiated plans. A task handed to someone is a question, not an order:
 * "can you do this by Friday?" The answer is yes, "Tuesday would work", or
 * "I can't, because…"; a suggestion goes back to the asker to agree to or
 * keep their date.
 */
export async function askRoutes(app: FastifyInstance) {
  app.get("/asks", async (r) => {
    const u = await authenticate(r);
    return listAsks(reader(r.headers), u.id);
  });

  // The ask on a task, for its detail: the one in play, else the last one.
  app.get("/items/:id/ask", async (r): Promise<TaskAsk | null> => {
    const u = await authenticate(r);
    return askOnItem(reader(r.headers), u.id, idParam(r));
  });

  // The person asked answers.
  app.post("/asks/:id/reply", async (r) => {
    const u = await authenticate(r);
    const d = askReplyInput.parse(r.body);
    return transaction((db) => replyToAsk(db, u, idParam(r), d));
  });

  // The asker settles a suggestion.
  app.post("/asks/:id/settle", async (r) => {
    const u = await authenticate(r);
    const d = askSettleInput.parse(r.body);
    return transaction((db) => settleAsk(db, u, idParam(r), d));
  });
}
