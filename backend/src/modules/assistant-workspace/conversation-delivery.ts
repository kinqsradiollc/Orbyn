import { routineQuietDeliveryProof } from "./routine-quiet-checks.js";
import {
  admitConversationWindow,
  conversationWindowForNight,
  ensureConversationWindowParent,
} from "./conversation-windows.js";
import { queueDueConversationWindows } from "./conversation-night.js";
import { z } from "zod";
import {
  assistantConversationEntry,
  assistantConversationSource,
  fail,
  type AssistantConversationSource,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { conversationWaitingKind } from "./conversation-questions.js";
import {
  conversationDestination,
  registerOriginConversation,
} from "./conversation-storage.js";
import {
  conversationAttention,
  conversationChangeFingerprint,
} from "./conversation-attention.js";

export { deliveryBindingVisible } from "../../lib/assistant-binding-visibility.js";
import { deliveryBindingVisible } from "../../lib/assistant-binding-visibility.js";

/** An accepted handoff inherits the producer's lifetime, never the current home. */
export async function conversationHandoffRoute(
  db: Queryable,
  owner: string,
  producer: string,
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") return {};
  const row = (
    await db.query<{
      chat_id: string;
      binding_id: string | null;
      destination_id: string | null;
      visible: boolean;
      reason: string | null;
    }>(
      `
    SELECT j.chat_id,b.id binding_id,b.destination_id,b.reason,
      CASE WHEN b.id IS NULL THEN true ELSE ${deliveryBindingVisible("b", "$1")} END visible
    FROM ai_jobs j LEFT JOIN assistant_delivery_bindings b ON b.owner_id=j.user_id AND b.work_kind='job' AND b.work_id=j.id
    WHERE j.user_id=$1 AND j.id=$2`,
      [owner, producer],
    )
  ).rows[0];
  if (!row || !row.visible)
    fail(404, "The handoff conversation is unavailable.");
  if (row.binding_id) {
    if (
      !row.destination_id ||
      !(await conversationDestination(db, owner, row.destination_id))
    )
      fail(404, "The handoff conversation is unavailable.");
    return {
      deliveryDestinationId: row.destination_id,
      deliveryPersonalOnly: row.reason === "personal",
    };
  }
  // Newly requested work from legacy results has an explicit origin. It does
  // not adopt every old job or copy that job's history into a new personal home.
  return { deliveryOrigin: { chatId: row.chat_id } };
}

/** Admission only, in the caller's transaction. Missing origins never fall back. */
export async function bindConversationWork(
  db: Queryable,
  input: {
    ownerId: string;
    work: { kind: "job" | "page_run" | "night"; id: string };
    lane: "background" | "overnight";
    timezone: string;
    origin?: { chatId: string; turnId?: string };
    destinationId?: string;
    personalOnly?: boolean;
    sources?: AssistantConversationSource[];
    sourcesChecked?: boolean;
    sourceEntryIds?: string[];
    grantId?: string;
    attentionKey?: string;
    nightId?: string;
    notBefore?: Date;
  },
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") return null;
  const workTable =
    input.work.kind === "job"
      ? "ai_jobs"
      : input.work.kind === "page_run"
        ? "assistant_page_runs"
        : "assistant_nights";
  const owned = (
    await db.query(`SELECT id FROM ${workTable} WHERE id=$1 AND user_id=$2`, [
      input.work.id,
      input.ownerId,
    ])
  ).rowCount;
  if (!owned) fail(404, "Work not found.");
  if (
    input.nightId &&
    !(
      await db.query(
        "SELECT id FROM assistant_nights WHERE id=$1 AND user_id=$2",
        [input.nightId, input.ownerId],
      )
    ).rowCount
  )
    fail(404, "Night not found.");
  let destinationId = input.destinationId;
  let window = input.nightId
    ? await conversationWindowForNight(db, input.ownerId, input.nightId)
    : input.work.kind === "night"
      ? await conversationWindowForNight(db, input.ownerId, input.work.id)
      : null;
  if (
    input.work.kind === "night" &&
    window &&
    !input.origin &&
    !destinationId
  ) {
    if (!window.default_destination_id) return null;
    destinationId = window.default_destination_id;
  }
  if (input.nightId && !input.origin && !destinationId) {
    if (window) {
      if (!window.default_destination_id) return null;
      destinationId = window.default_destination_id;
    } else {
      const parent = (
        await db.query<{ destination_id: string }>(
          `SELECT destination_id FROM assistant_delivery_bindings
      WHERE owner_id=$1 AND work_kind='night' AND work_id=$2`,
          [input.ownerId, input.nightId],
        )
      ).rows[0];
      // A legacy night keeps its original delivery owner. An opened/replaced
      // personal chat must not silently adopt that night's later jobs.
      if (!parent) return null;
      destinationId = parent.destination_id;
    }
  }
  if (input.origin) {
    const destination = await registerOriginConversation(
      db,
      input.ownerId,
      input.origin.chatId,
    );
    if (destinationId && destinationId !== destination.id)
      throw new Error("Conflicting work destination.");
    destinationId = destination.id;
    if (
      input.origin.turnId &&
      !(
        await db.query(
          `SELECT c.id FROM ai_chats c WHERE c.id=$2 AND c.user_id=$1 AND (
        EXISTS(SELECT 1 FROM ai_jobs origin_job WHERE origin_job.chat_id=c.id AND origin_job.user_id=$1 AND origin_job.turn_id=$3)
        OR EXISTS(SELECT 1 FROM assistant_conversation_entries e JOIN assistant_conversation_streams stream ON stream.id=e.destination_id
          WHERE stream.chat_id=c.id AND stream.owner_id=$1 AND e.turn_id=$3)
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.turns) saved WHERE saved->>'turn_id'=$3::text))`,
          [input.ownerId, input.origin.chatId, input.origin.turnId],
        )
      ).rowCount
    )
      fail(404, "The originating turn is unavailable.");
  } else if (!destinationId) {
    destinationId = (
      await db.query<{ id: string }>(
        `SELECT id FROM assistant_conversation_streams WHERE owner_id=$1 AND personal AND retired_at IS NULL`,
        [input.ownerId],
      )
    ).rows[0]?.id;
  }
  // An unopened personal destination remains absent; workers cannot create it.
  if (!destinationId) return null;
  if (!(await conversationDestination(db, input.ownerId, destinationId))) {
    if (input.destinationId || input.origin)
      fail(404, "Conversation not found.");
    return null;
  }
  const grant = (
    await db.query<{ id: string }>(
      `SELECT id FROM agent_grants WHERE user_id=$1 AND
      (($2::uuid IS NOT NULL AND id=$2) OR ($2::uuid IS NULL AND kind='assistant'))
      AND revoked_at IS NULL AND suspended_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,
      [input.ownerId, input.grantId ?? null],
    )
  ).rows[0];
  if (!grant) return null;
  if (input.work.kind === "night" && input.notBefore) {
    window = await admitConversationWindow(db, input.ownerId, input.notBefore, {
      nightId: input.work.id,
      destinationId,
      personalOnly: input.origin
        ? false
        : (input.personalOnly ?? !input.destinationId),
    });
  } else if (!input.nightId && input.lane === "overnight" && input.notBefore) {
    window = await admitConversationWindow(db, input.ownerId, input.notBefore);
  }
  const workId =
    input.work.kind === "night" && window ? window.id : input.work.id;
  const binding = (
    await db.query<{ id: string }>(
      `INSERT INTO assistant_delivery_bindings(owner_id,work_kind,work_id,destination_id,
       origin_chat_id,origin_turn_id,reason,lane,timezone,grant_id,sources_checked,attention_key,night_id,not_before,summary_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(${input.work.kind === "night" ? "owner_id,work_kind,work_id,destination_id) WHERE work_kind='night'" : "owner_id,work_kind,work_id) WHERE work_kind<>'night'"} DO NOTHING RETURNING id`,
      [
        input.ownerId,
        input.work.kind,
        workId,
        destinationId,
        input.origin?.chatId ?? null,
        input.origin?.turnId ?? null,
        input.work.kind === "night" && window
          ? "schedule"
          : input.origin
            ? "origin"
            : input.personalOnly
              ? "personal"
              : input.destinationId
                ? "schedule"
                : "personal",
        input.lane,
        input.timezone,
        grant.id,
        input.sourcesChecked ?? false,
        input.attentionKey ?? null,
        input.nightId ?? null,
        window?.window_end.toISOString() ??
          input.notBefore?.toISOString() ??
          null,
        window?.id ?? null,
      ],
    )
  ).rows[0];
  if (!binding) return null;
  if (input.sourceEntryIds?.length)
    await db.query(
      `INSERT INTO assistant_delivery_entry_sources(binding_id,source_entry_id)
      SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [binding.id, input.sourceEntryIds],
    );
  if (input.origin?.turnId) {
    await db.query(
      `INSERT INTO assistant_delivery_entry_sources(binding_id,source_entry_id)
       SELECT $1,source_entry_id FROM assistant_turn_entry_sources WHERE chat_id=$2 AND turn_id=$3
       ON CONFLICT DO NOTHING`,
      [binding.id, input.origin.chatId, input.origin.turnId],
    );
    if (input.work.kind === "job") {
      await db.query(
        `INSERT INTO assistant_turn_entry_sources(chat_id,turn_id,source_entry_id)
         SELECT j.chat_id,j.turn_id,s.source_entry_id FROM ai_jobs j JOIN assistant_turn_entry_sources s ON s.chat_id=$3 AND s.turn_id=$4
         WHERE j.id=$1 AND j.user_id=$2 AND j.chat_id IS NOT NULL AND j.turn_id IS NOT NULL ON CONFLICT DO NOTHING`,
        [
          input.work.id,
          input.ownerId,
          input.origin.chatId,
          input.origin.turnId,
        ],
      );
      await db.query(
        `INSERT INTO assistant_job_sources(job_id,source_kind,source_id)
         SELECT $1,source_kind,source_id FROM assistant_chat_sources WHERE chat_id=$2 AND turn_id=$3 ON CONFLICT DO NOTHING`,
        [input.work.id, input.origin.chatId, input.origin.turnId],
      );
      await db.query(
        `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
         SELECT j.chat_id,j.turn_id,s.source_kind,s.source_id FROM ai_jobs j JOIN assistant_job_sources s ON s.job_id=j.id
         WHERE j.id=$1 AND j.user_id=$2 AND j.chat_id IS NOT NULL AND j.turn_id IS NOT NULL ON CONFLICT DO NOTHING`,
        [input.work.id, input.ownerId],
      );
    }
  }
  if (input.work.kind === "job")
    await db.query(
      `INSERT INTO assistant_delivery_entry_sources(binding_id,source_entry_id)
       SELECT $1,s.source_entry_id FROM ai_jobs j JOIN assistant_turn_entry_sources s ON s.chat_id=j.chat_id AND s.turn_id=j.turn_id
       WHERE j.id=$2 AND j.user_id=$3 ON CONFLICT DO NOTHING`,
      [binding.id, input.work.id, input.ownerId],
    );
  for (const source of input.sources ?? [])
    await db.query(
      `INSERT INTO assistant_delivery_sources(binding_id,source_kind,source_id)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [binding.id, source.kind, source.id],
    );
  if (window && input.work.kind !== "night")
    await ensureConversationWindowParent(
      db,
      input.ownerId,
      window.id,
      destinationId,
      input.timezone,
    );
  return binding.id;
}

const intentRow = z.object({
  id: z.uuid(),
  binding_id: z.uuid(),
  work_kind: z.string(),
  work_id: z.uuid(),
  owner_id: z.uuid(),
  destination_id: z.uuid(),
  state: z.string(),
  revision: z.number().int().positive(),
  payload: z.unknown(),
  sources: z.array(assistantConversationSource),
  timezone: z.string(),
  attention_key: z.string().nullable(),
  night_id: z.uuid().nullable(),
  not_before: z.date().nullable(),
});

/** Short primary transaction; execution leases and foreground slots are untouched. */
export async function publishConversationIntent(
  db: Queryable,
  intentId: string,
  now = new Date(),
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") return false;
  // Match chat -> stream -> intent deletion lock order. Never lock an intent and
  // then wait for its stream: deleting the chat would wait in the opposite order.
  const destination = (
    await db.query<{ id: string }>(
      `SELECT c.id FROM assistant_delivery_intents i
     JOIN assistant_delivery_bindings b ON b.id=i.binding_id
     JOIN assistant_conversation_streams s ON s.id=b.destination_id
     JOIN ai_chats c ON c.id=s.chat_id WHERE i.id=$1 AND s.retired_at IS NULL FOR SHARE OF c`,
      [intentId],
    )
  ).rows[0];
  if (!destination) return false;
  await db.query(
    `SELECT s.id FROM assistant_conversation_streams s WHERE s.chat_id=$1 FOR UPDATE`,
    [destination.id],
  );
  const raw = (
    await db.query(
      `SELECT i.id,i.binding_id,b.work_kind,b.work_id,b.owner_id,b.destination_id,b.timezone,b.attention_key,b.night_id,b.not_before,i.state,i.revision,i.payload,
       coalesce((SELECT jsonb_agg(jsonb_build_object('kind',ds.source_kind,'id',ds.source_id) ORDER BY ds.source_kind,ds.source_id)
         FROM assistant_delivery_sources ds WHERE ds.binding_id=b.id),'[]') AS sources
     FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id
     WHERE i.id=$1 AND i.state IN ('pending','deferred') AND i.available_at<=$2 FOR UPDATE OF i`,
      [intentId, now],
    )
  ).rows[0];
  if (!raw) return false;
  const row = intentRow.parse(raw);
  const allowed = (
    await db.query(
      `SELECT b.id FROM assistant_delivery_bindings b WHERE b.id=$2 AND ${deliveryBindingVisible()}`,
      [row.owner_id, row.binding_id],
    )
  ).rowCount;
  if (!allowed) {
    await db.query(
      "UPDATE assistant_delivery_intents SET state='blocked',reason='permission_revoked',updated_at=clock_timestamp() WHERE id=$1",
      [intentId],
    );
    return false;
  }
  const payload = z.record(z.string(), z.unknown()).parse(row.payload);
  if (payload.event === "question") {
    const current = (
      await db.query<{ kind: string | null }>(
        `SELECT ${conversationWaitingKind("$1::jsonb", "$2")} AS kind`,
        [JSON.stringify(payload), row.owner_id],
      )
    ).rows[0];
    if (!current?.kind) {
      await db.query(
        "UPDATE assistant_delivery_intents SET state='suppressed',reason='resolved',updated_at=clock_timestamp() WHERE id=$1",
        [intentId],
      );
      return false;
    }
  }
  if (typeof payload.text !== "string" || !payload.text.trim()) {
    await db.query(
      "UPDATE assistant_delivery_intents SET state='suppressed',reason='empty',updated_at=clock_timestamp() WHERE id=$1",
      [intentId],
    );
    return false;
  }
  const attention = await conversationAttention(
    db,
    row.owner_id,
    now,
    row.timezone,
  );
  if (row.not_before && row.not_before > attention.availableAt)
    attention.availableAt = row.not_before;
  if (attention.availableAt > now) {
    await db.query(
      "UPDATE assistant_delivery_intents SET state='deferred',available_at=$2,updated_at=clock_timestamp() WHERE id=$1",
      [intentId, attention.availableAt],
    );
    return false;
  }
  const fingerprint =
    payload.event === "result" && row.attention_key
      ? await conversationChangeFingerprint(db, row.binding_id)
      : null;
  if (
    payload.event === "result" &&
    row.work_kind === "job" &&
    (await routineQuietDeliveryProof(db, row.owner_id, row.work_id))
  ) {
    await db.query(
      "UPDATE assistant_delivery_intents SET state='suppressed',reason='unchanged',fingerprint=$2,updated_at=clock_timestamp() WHERE id=$1",
      [intentId, fingerprint],
    );
    return false;
  }
  if (
    payload.event === "result" &&
    row.work_kind === "job" &&
    (
      await db.query(
        "SELECT id FROM assistant_quiet_checks WHERE owner_id=$1 AND job_id=$2 AND status='verified_unchanged'",
        [row.owner_id, row.work_id],
      )
    ).rowCount
  ) {
    payload.text =
      "This check was unchanged when it finished, but its sources or settings have since changed. Review this run.";
    await db.query(
      "UPDATE assistant_delivery_intents SET payload=$2::jsonb WHERE id=$1",
      [intentId, JSON.stringify(payload)],
    );
  }
  if (
    payload.event === "result" &&
    (
      await db.query(
        `SELECT id FROM assistant_delivery_bindings
    WHERE owner_id=$1 AND work_kind='night' AND destination_id=$3
      AND summary_id=(SELECT summary_id FROM assistant_delivery_bindings WHERE id=$2)`,
        [row.owner_id, row.binding_id, row.destination_id],
      )
    ).rowCount
  ) {
    await db.query(
      "UPDATE assistant_delivery_intents SET state='suppressed',reason='night_summary',fingerprint=$2,updated_at=clock_timestamp() WHERE id=$1",
      [intentId, fingerprint],
    );
    return false;
  }
  const existing = (
    await db.query<{ id: string; sequence: string }>(
      "SELECT id,sequence::text FROM assistant_conversation_entries WHERE intent_id=$1",
      [intentId],
    )
  ).rows[0];
  const entryId =
    existing?.id ??
    (await db.query<{ id: string }>("SELECT gen_random_uuid() AS id")).rows[0]
      .id;
  const next =
    existing ??
    (
      await db.query<{ sequence: string }>(
        `UPDATE assistant_conversation_streams SET last_sequence=last_sequence+1
     WHERE id=$1 AND retired_at IS NULL RETURNING last_sequence::text AS sequence`,
        [row.destination_id],
      )
    ).rows[0];
  if (!next) return false;
  const entry = assistantConversationEntry.parse({
    ...payload,
    completed_at:
      z.coerce.date().nullable().parse(payload.completed_at)?.toISOString() ??
      null,
    // Navigation is bounded on the wire; the complete authority set stays in
    // delivery/entry source tables and is never truncated by this projection.
    sources: row.sources.slice(0, 500),
    kind: "update",
    id: entryId,
    sequence: next.sequence,
    revision: row.revision,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (entry.kind !== "update") throw new Error("Delivery must be an update.");
  const { id, sequence, revision, created_at, updated_at, kind, ...content } =
    entry;
  await db.query(
    `INSERT INTO assistant_conversation_entries(id,destination_id,sequence,kind,intent_id,payload,sources_checked,revision)
    VALUES($1,$2,$3,'update',$4,$5::jsonb,true,$6)
    ON CONFLICT(intent_id) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,updated_at=clock_timestamp()`,
    [
      id,
      row.destination_id,
      sequence,
      intentId,
      JSON.stringify(content),
      revision,
    ],
  );
  await db.query(
    "DELETE FROM assistant_conversation_entry_sources WHERE entry_id=$1",
    [id],
  );
  await db.query(
    `INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id)
    SELECT $1::uuid,source_kind,source_id FROM assistant_delivery_sources WHERE binding_id=$2
    UNION SELECT $1,'entry',source_entry_id FROM assistant_delivery_entry_sources WHERE binding_id=$2
    ON CONFLICT DO NOTHING`,
    [id, row.binding_id],
  );
  if (payload.event === "morning_summary")
    await db.query(
      `UPDATE assistant_delivery_bindings child SET summary_retained_at=coalesce(child.summary_retained_at,clock_timestamp())
       FROM assistant_delivery_sources dependency
       WHERE dependency.binding_id=$1 AND dependency.source_kind='binding' AND dependency.source_id=child.id
         AND child.owner_id=$2 AND child.destination_id=$3`,
      [row.binding_id, row.owner_id, row.destination_id],
    );
  await db.query(
    "INSERT INTO assistant_conversation_alerts(entry_id,state) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [id, attention.muted ? "suppressed" : "pending"],
  );
  await db.query(
    "UPDATE assistant_delivery_intents SET state='published',fingerprint=$2,updated_at=clock_timestamp() WHERE id=$1",
    [intentId, fingerprint],
  );
  return true;
}

export async function flushConversationDeliveries(
  options: { onlyOwner?: string; onError?: (id: string) => void } = {},
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") return 0;
  const rows = (
    await pool.query<{ id: string }>(
      `SELECT i.id FROM assistant_delivery_intents i
    JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE i.state IN ('pending','deferred')
      AND i.available_at<=now() AND ($1::uuid IS NULL OR b.owner_id=$1) ORDER BY i.available_at,i.id LIMIT 25`,
      [options.onlyOwner ?? null],
    )
  ).rows;
  let published = 0;
  for (const row of rows) {
    try {
      if (await transaction((db) => publishConversationIntent(db, row.id)))
        published++;
    } catch {
      options.onError?.(row.id);
      // One malformed/temporarily unavailable delivery cannot roll back other
      // owners' updates or monopolize the head of the next bounded batch.
      await pool
        .query(
          `UPDATE assistant_delivery_intents SET state='deferred',available_at=clock_timestamp()+interval '1 minute'
        WHERE id=$1 AND state IN ('pending','deferred')`,
          [row.id],
        )
        .catch(() => undefined);
    }
  }
  try {
    await transaction((db) =>
      queueDueConversationWindows(db, options.onlyOwner ?? null, new Date()),
    );
  } catch {
    options.onError?.("morning_summaries");
  }
  return published;
}
