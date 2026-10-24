import type { Queryable } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { deliveryBindingVisible } from "../../lib/assistant-binding-visibility.js";
import { ensureConversationWindowParent } from "./conversation-windows.js";

type SummaryParent = {
  id: string;
  destination_id: string;
  end_at: Date | null;
};

async function queueParentSummary(
  db: Queryable,
  owner: string,
  windowId: string,
  now: Date,
  parent: SummaryParent,
) {
  if (
    env.ASSISTANT_CONVERSATION_ENABLED !== "true" ||
    !parent.end_at ||
    parent.end_at > now
  )
    return true;
  // The publisher classifies child intents in isolated transactions. Building a
  // summary never retries a child publication inside the notifier's night lock.
  const material = (
    await db.query<{
      id: string;
      state: string;
      payload: { work: { kind: "job" | "page_run"; id: string }; text: string };
    }>(
      `SELECT DISTINCT ON (b.id) b.id,coalesce(j.state,p.state,CASE i.payload->>'event' WHEN 'result' THEN 'done' WHEN 'failure' THEN 'failed' ELSE 'cancelled' END) AS state,i.payload
    FROM assistant_delivery_bindings b JOIN assistant_delivery_intents i ON i.binding_id=b.id
    LEFT JOIN ai_jobs j ON b.work_kind='job' AND j.id=b.work_id
    LEFT JOIN assistant_page_runs p ON b.work_kind='page_run' AND p.id=b.work_id
    WHERE b.owner_id=$1 AND b.summary_id=$2 AND b.work_kind<>'night' AND b.destination_id=$3
      AND i.state='suppressed' AND i.reason='night_summary' AND ${deliveryBindingVisible()}
      ORDER BY b.id,i.completed_at DESC,i.updated_at DESC,i.id DESC`,
      [owner, windowId, parent.destination_id],
    )
  ).rows;
  if (!material.length) return true;
  const done = material.filter((r) => r.state === "done").length;
  const waiting = material.filter((r) => r.state === "waiting").length;
  const failed = material.filter((r) => r.state === "failed").length;
  const active = material.filter(
    (r) => r.state === "queued" || r.state === "running",
  ).length;
  const stopped = material.filter((r) => r.state === "cancelled").length;
  const text = [
    done ? `${done} finished` : null,
    waiting ? `${waiting} need your review` : null,
    failed ? `${failed} could not finish` : null,
    active ? `${active} still working` : null,
    stopped ? `${stopped} stopped` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!text) return true;
  await db.query("DELETE FROM assistant_delivery_sources WHERE binding_id=$1", [
    parent.id,
  ]);
  await db.query(
    `INSERT INTO assistant_delivery_sources(binding_id,source_kind,source_id)
    SELECT DISTINCT $1::uuid,source_kind,source_id FROM assistant_delivery_sources WHERE binding_id=ANY($2::uuid[])
    UNION SELECT $1::uuid,'entry',source_entry_id FROM assistant_delivery_entry_sources WHERE binding_id=ANY($2::uuid[])
    UNION SELECT $1::uuid,'binding',unnest($2::uuid[])`,
    [parent.id, material.map((r) => r.id)],
  );
  const payload = {
    lane: "overnight",
    work: { kind: "night", id: windowId },
    event: "morning_summary",
    text,
    completed_at: parent.end_at.toISOString(),
    execution_chat_id: null,
    waiting_id: null,
    sources: [],
    night_runs: material.slice(0, 50).map((run) => ({
      work: run.payload.work,
      state: run.state,
      text: run.payload.text.slice(0, 4000),
    })),
  };
  await db.query(
    `INSERT INTO assistant_delivery_intents(binding_id,event_key,payload,available_at,completed_at)
    VALUES($1,'morning_summary',$2,$3,$3)
    ON CONFLICT(binding_id,event_key) DO UPDATE SET payload=EXCLUDED.payload,
      state='pending',reason=NULL,revision=assistant_delivery_intents.revision+1,updated_at=clock_timestamp()
    WHERE assistant_delivery_intents.payload IS DISTINCT FROM EXCLUDED.payload OR (assistant_delivery_intents.state='published' AND EXISTS(
      WITH expected(kind,id) AS (
        SELECT source_kind,source_id FROM assistant_delivery_sources WHERE binding_id=$1
        UNION SELECT 'entry',source_entry_id FROM assistant_delivery_entry_sources WHERE binding_id=$1
      ), stored(kind,id) AS (
        SELECT s.source_kind,s.source_id FROM assistant_conversation_entries e
        JOIN assistant_conversation_entry_sources s ON s.entry_id=e.id WHERE e.intent_id=assistant_delivery_intents.id
      )
      (SELECT kind,id FROM expected EXCEPT SELECT kind,id FROM stored)
      UNION ALL (SELECT kind,id FROM stored EXCEPT SELECT kind,id FROM expected)
    ))`,
    [parent.id, payload, parent.end_at],
  );
  return true;
}

/** One window can return work to several explicitly captured conversations. */
async function queueConversationWindow(
  db: Queryable,
  owner: string,
  windowId: string,
  now: Date,
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") return;
  const destinations = (
    await db.query<{ destination_id: string; timezone: string }>(
      `SELECT DISTINCT ON (b.destination_id) b.destination_id,b.timezone
     FROM assistant_delivery_bindings b JOIN assistant_conversation_streams s ON s.id=b.destination_id
     WHERE b.owner_id=$1 AND b.summary_id=$2 AND b.work_kind<>'night' AND s.retired_at IS NULL
     ORDER BY b.destination_id,b.created_at,b.id`,
      [owner, windowId],
    )
  ).rows;
  for (const destination of destinations)
    await ensureConversationWindowParent(
      db,
      owner,
      windowId,
      destination.destination_id,
      destination.timezone,
    );
  const parents = (
    await db.query<SummaryParent>(
      `SELECT b.id,b.destination_id,b.not_before AS end_at FROM assistant_delivery_bindings b
     JOIN assistant_conversation_streams s ON s.id=b.destination_id AND s.retired_at IS NULL
     JOIN ai_chats c ON c.id=s.chat_id AND c.swept_at IS NULL
     WHERE b.owner_id=$1 AND b.work_kind='night' AND b.summary_id=$2 ORDER BY b.id FOR UPDATE OF b`,
      [owner, windowId],
    )
  ).rows;
  for (const parent of parents)
    await queueParentSummary(db, owner, windowId, now, parent);
}

/** True means the admitted execution night owns unified delivery, even while rollout is parked. */
export async function queueConversationNightSummary(
  db: Queryable,
  owner: string,
  nightId: string,
  now: Date,
) {
  const window = (
    await db.query<{ id: string }>(
      `SELECT id FROM assistant_delivery_windows WHERE owner_id=$1 AND (execution_night_id=$2 OR id=$2)`,
      [owner, nightId],
    )
  ).rows[0];
  if (!window)
    return Boolean(
      (
        await db.query(
          `SELECT 1 FROM assistant_delivery_bindings WHERE owner_id=$1 AND work_kind='night' AND work_id=$2`,
          [owner, nightId],
        )
      ).rowCount,
    );
  await queueConversationWindow(db, owner, window.id, now);
  return true;
}

/** Bounded worker pass also handles explicit Overnight handoffs without an execution night. */
export async function queueDueConversationWindows(
  db: Queryable,
  owner: string | null,
  now: Date,
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") return;
  const windows = (
    await db.query<{ id: string; owner_id: string }>(
      `SELECT w.id,w.owner_id FROM assistant_delivery_windows w
     WHERE ($1::uuid IS NULL OR w.owner_id=$1) AND w.window_end<=$2
       AND EXISTS(SELECT 1 FROM assistant_delivery_bindings b JOIN assistant_delivery_intents i ON i.binding_id=b.id
         WHERE b.summary_id=w.id AND b.work_kind<>'night' AND i.state='suppressed' AND i.reason='night_summary'
           AND (w.checked_at IS NULL OR i.updated_at>w.checked_at OR
             (w.window_end>$2::timestamptz-interval '1 day' AND w.checked_at<$2::timestamptz-interval '1 minute')))
     ORDER BY w.checked_at NULLS FIRST,w.window_end,w.id LIMIT 25 FOR UPDATE OF w SKIP LOCKED`,
      [owner, now],
    )
  ).rows;
  for (const window of windows) {
    await queueConversationWindow(db, window.owner_id, window.id, now);
    await db.query(
      "UPDATE assistant_delivery_windows SET checked_at=$2 WHERE id=$1",
      [window.id, now],
    );
  }
}
