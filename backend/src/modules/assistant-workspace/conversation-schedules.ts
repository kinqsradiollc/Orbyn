import { fail } from "@orbyn/core";
import { env } from "../../config/env.js";
import type { Queryable } from "../../db/pool.js";
import {
  conversationDestination,
  registerOriginConversation,
} from "./conversation-storage.js";
export type ConversationScheduleKind =
  "task" | "goal" | "routine" | "page_binding";

/** Called inside the owning write transaction. jobId comes only from server principal/guard metadata. */
export async function recordScheduleConversation(
  db: Queryable,
  owner: string,
  kind: ConversationScheduleKind,
  id: string,
  jobId?: string,
) {
  const enabled = env.ASSISTANT_CONVERSATION_ENABLED === "true";
  if (!enabled && !jobId) return;
  let destinationId: string | null = null,
    chatId: string | null = null,
    turnId: string | null = null;
  let personalOnly = !jobId;
  if (jobId) {
    const job = (
      await db.query<{
        chat_id: string;
        turn_id: string | null;
        destination_id: string | null;
        binding_id: string | null;
        reason: string | null;
      }>(
        `
   SELECT j.chat_id,j.turn_id,b.destination_id,b.id binding_id,b.reason FROM ai_jobs j
   LEFT JOIN assistant_delivery_bindings b ON b.owner_id=j.user_id AND b.work_kind='job' AND b.work_id=j.id
   WHERE j.id=$2 AND j.user_id=$1`,
        [owner, jobId],
      )
    ).rows[0];
    if (!job) fail(404, "The originating conversation is unavailable.");
    chatId = job.chat_id;
    turnId = job.turn_id;
    if (job.binding_id) {
      destinationId = job.destination_id;
      personalOnly = job.reason === "personal";
    } else {
      const existing = (
        await db.query<{ id: string }>(
          "SELECT id FROM assistant_conversation_streams WHERE owner_id=$1 AND chat_id=$2 AND retired_at IS NULL",
          [owner, chatId],
        )
      ).rows[0];
      destinationId =
        existing?.id ??
        (enabled
          ? (await registerOriginConversation(db, owner, chatId)).id
          : null);
    }
    if (
      (enabled && !destinationId) ||
      (destinationId &&
        !(await conversationDestination(db, owner, destinationId)))
    )
      fail(404, "The originating conversation is unavailable.");
  } else {
    destinationId =
      (
        await db.query<{ id: string }>(
          "SELECT id FROM assistant_conversation_streams WHERE owner_id=$1 AND personal AND retired_at IS NULL",
          [owner],
        )
      ).rows[0]?.id ?? null;
    if (
      destinationId &&
      !(await conversationDestination(db, owner, destinationId))
    )
      destinationId = null;
  }
  const saved = await db.query(
    `INSERT INTO assistant_schedule_destinations(owner_id,source_kind,source_id,destination_id,origin_chat_id,origin_turn_id,personal_only)
  VALUES($1,$2,$3,$4,$5,$6,$8) ON CONFLICT(owner_id,source_kind,source_id) DO UPDATE
  SET destination_id=EXCLUDED.destination_id,origin_chat_id=EXCLUDED.origin_chat_id,origin_turn_id=EXCLUDED.origin_turn_id,personal_only=EXCLUDED.personal_only
  WHERE $7::boolean`,
    [owner, kind, id, destinationId, chatId, turnId, !!jobId, personalOnly],
  );
  if (saved.rowCount && jobId) {
    await db.query(
      "DELETE FROM assistant_schedule_entry_sources WHERE owner_id=$1 AND source_kind=$2 AND source_id=$3",
      [owner, kind, id],
    );
    await db.query(
      `INSERT INTO assistant_schedule_entry_sources(owner_id,source_kind,source_id,source_entry_id)
      SELECT $1,$2,$3,source.id FROM (
        SELECT source_entry_id AS id FROM assistant_turn_entry_sources WHERE chat_id=$4 AND turn_id=$5
        UNION SELECT s.source_entry_id FROM assistant_delivery_bindings b JOIN assistant_delivery_entry_sources s ON s.binding_id=b.id
          WHERE b.owner_id=$1 AND b.work_kind='job' AND b.work_id=$6
        UNION SELECT e.id FROM assistant_conversation_entries e JOIN assistant_conversation_streams stream ON stream.id=e.destination_id
          WHERE stream.owner_id=$1 AND stream.chat_id=$4 AND e.turn_id=$5 AND e.kind='turn' AND e.role='user'
      ) source ON CONFLICT DO NOTHING`,
      [owner, kind, id, chatId, turnId, jobId],
    );
  }
}

type ScheduleRoute = {
  destinationId: string | null;
  personalOnly: boolean;
  sourceEntryIds: string[];
};

async function savedScheduleRoute(
  db: Queryable,
  owner: string,
  kind: ConversationScheduleKind,
  id: string,
): Promise<ScheduleRoute | null> {
  const row = (
    await db.query<{
      destination_id: string | null;
      personal_only: boolean;
      source_entry_ids: string[];
    }>(
      `SELECT d.destination_id,d.personal_only,coalesce((SELECT array_agg(s.source_entry_id ORDER BY s.source_entry_id)
      FROM assistant_schedule_entry_sources s WHERE s.owner_id=d.owner_id AND s.source_kind=d.source_kind AND s.source_id=d.source_id),'{}'::uuid[]) AS source_entry_ids
     FROM assistant_schedule_destinations d WHERE d.owner_id=$1 AND d.source_kind=$2 AND d.source_id=$3`,
      [owner, kind, id],
    )
  ).rows[0];
  return row
    ? {
        destinationId: row.destination_id,
        personalOnly: row.personal_only,
        sourceEntryIds: row.source_entry_ids,
      }
    : null;
}

/** Capture old schedules once; provenance remains enforced while delivery is disabled. */
export async function scheduledConversationRoute(
  db: Queryable,
  owner: string,
  kind: ConversationScheduleKind,
  id: string,
  nightId?: string,
): Promise<ScheduleRoute> {
  const enabled = env.ASSISTANT_CONVERSATION_ENABLED === "true";
  const existing = await savedScheduleRoute(db, owner, kind, id);
  if (existing)
    return {
      ...existing,
      destinationId: enabled ? existing.destinationId : null,
    };
  const absent = {
    destinationId: null,
    personalOnly: true,
    sourceEntryIds: [],
  };
  if (!enabled) return absent;
  if (nightId) {
    const window = await conversationWindowForNight(db, owner, nightId);
    const parent = (
      await db.query<{ destination_id: string; reason: string }>(
        "SELECT destination_id,reason FROM assistant_delivery_bindings WHERE owner_id=$1 AND work_kind='night' AND work_id=$2",
        [owner, nightId],
      )
    ).rows[0];
    const destination = window
      ? window.default_destination_id
      : parent?.destination_id;
    if (!destination) return absent;
    await db.query(
      `INSERT INTO assistant_schedule_destinations(owner_id,source_kind,source_id,destination_id,personal_only)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [
        owner,
        kind,
        id,
        destination,
        window?.default_personal_only ?? parent.reason === "personal",
      ],
    );
  } else await recordScheduleConversation(db, owner, kind, id);
  return (await savedScheduleRoute(db, owner, kind, id)) ?? absent;
}
import { conversationWindowForNight } from "./conversation-windows.js";
