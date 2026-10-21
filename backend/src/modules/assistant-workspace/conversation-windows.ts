import { fail } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";

export type ConversationWindow = {
  id: string;
  window_end: Date;
  default_destination_id: string | null;
  default_personal_only: boolean;
};

/** Delivery identity only: never creates an execution night or changes its budget. */
export async function admitConversationWindow(
  db: Queryable,
  owner: string,
  end: Date,
  scheduled?: { nightId: string; destinationId: string; personalOnly: boolean },
): Promise<ConversationWindow> {
  if (!Number.isFinite(end.getTime())) fail(422, "Invalid delivery window.");
  const row = (
    await db.query<ConversationWindow>(
      `INSERT INTO assistant_delivery_windows(id,owner_id,window_end,execution_night_id,default_destination_id,default_personal_only)
     VALUES(coalesce($3::uuid,gen_random_uuid()),$1,$2,$3,$4,$5)
     ON CONFLICT(owner_id,window_end) DO UPDATE SET
       execution_night_id=coalesce(assistant_delivery_windows.execution_night_id,EXCLUDED.execution_night_id),
       default_personal_only=CASE WHEN assistant_delivery_windows.default_destination_id IS NULL THEN EXCLUDED.default_personal_only ELSE assistant_delivery_windows.default_personal_only END,
       default_destination_id=coalesce(assistant_delivery_windows.default_destination_id,EXCLUDED.default_destination_id)
     WHERE EXCLUDED.execution_night_id IS NULL OR assistant_delivery_windows.execution_night_id IS NULL
       OR assistant_delivery_windows.execution_night_id=EXCLUDED.execution_night_id
     RETURNING id,window_end,default_destination_id,default_personal_only`,
      [
        owner,
        end,
        scheduled?.nightId ?? null,
        scheduled?.destinationId ?? null,
        scheduled?.personalOnly ?? true,
      ],
    )
  ).rows[0];
  if (!row)
    fail(409, "This delivery window belongs to a different admitted night.");
  return row;
}

export async function conversationWindowForNight(
  db: Queryable,
  owner: string,
  nightId: string,
) {
  return (
    (
      await db.query<ConversationWindow>(
        `SELECT id,window_end,default_destination_id,default_personal_only
     FROM assistant_delivery_windows WHERE owner_id=$1 AND execution_night_id=$2`,
        [owner, nightId],
      )
    ).rows[0] ?? null
  );
}

/** A derived summary has no independent read authority: every child binding is a source. */
export async function ensureConversationWindowParent(
  db: Queryable,
  owner: string,
  windowId: string,
  destinationId: string,
  timezone: string,
) {
  await db.query(
    `INSERT INTO assistant_delivery_bindings(owner_id,work_kind,work_id,destination_id,reason,lane,timezone,
       grant_id,sources_checked,not_before,summary_id)
     SELECT $1,'night',w.id,s.id,'schedule','overnight',$4,g.id,true,w.window_end,w.id
     FROM assistant_delivery_windows w
     JOIN assistant_conversation_streams s ON s.id=$3 AND s.owner_id=w.owner_id AND s.retired_at IS NULL
     JOIN ai_chats c ON c.id=s.chat_id AND c.swept_at IS NULL
     JOIN agent_grants g ON g.user_id=w.owner_id AND g.kind='assistant' AND g.revoked_at IS NULL AND g.suspended_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at>now())
     JOIN users u ON u.id=w.owner_id AND NOT u.disabled
     WHERE w.id=$2 AND w.owner_id=$1
     ON CONFLICT(owner_id,work_kind,work_id,destination_id) WHERE work_kind='night' DO NOTHING`,
    [owner, windowId, destinationId, timezone],
  );
}
