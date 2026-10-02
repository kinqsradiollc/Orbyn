import {
  assistantActivityLane,
  assistantActivityPage,
  assistantActivityQuery,
  assistantActivityEvent,
  fail,
  type AssistantActivityLane,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { readTransaction, type Queryable } from "../../db/pool.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { firstParty } from "../proposals/service.js";

const visibleEvent = `((e.job_id IS NULL) OR (
  j.user_id=e.owner_id AND ${assistantChatVisible("c", "$1")}
  AND ${assistantJobSourcesVisible("j", "$1", false)}))`;

/** Latest bounded, content-free events using exactly the replay feed's access checks. */
export async function assistantRecentActivity(
  db: Queryable,
  ownerId: string,
  lane: AssistantActivityLane,
) {
  const rows = (
    await db.query<{
      sequence: string;
      job_id: string | null;
      kind: string;
      created_at: Date;
    }>(
      `SELECT e.sequence::text,e.job_id,e.kind,e.created_at FROM assistant_activity_events e
     LEFT JOIN ai_jobs j ON j.id=e.job_id LEFT JOIN ai_chats c ON c.id=j.chat_id
     WHERE e.owner_id=$1 AND e.runtime_lane=$2 AND ${visibleEvent}
     ORDER BY e.sequence DESC LIMIT 8`,
      [ownerId, lane],
    )
  ).rows;
  return rows.map((row) =>
    assistantActivityEvent.parse({
      ...row,
      created_at: row.created_at.toISOString(),
    }),
  );
}

/** Current-authorized work time, without loading or replaying event contents. */
export async function assistantLastActivity(
  db: Queryable,
  ownerId: string,
  lane: AssistantActivityLane,
  through = "9223372036854775807",
) {
  const latest = (
    await db.query<{ last_activity_at: Date | null }>(
      `SELECT max(e.created_at) AS last_activity_at FROM assistant_activity_events e
     LEFT JOIN ai_jobs j ON j.id=e.job_id LEFT JOIN ai_chats c ON c.id=j.chat_id
     WHERE e.owner_id=$1 AND e.runtime_lane=$2 AND e.sequence<=$3::bigint
       AND e.kind<>'queued' AND ${visibleEvent}`,
      [ownerId, lane, through],
    )
  ).rows[0].last_activity_at;
  return latest?.toISOString() ?? null;
}

/** Replay current-authorized, content-free execution activity without treating presence as work. */
export async function assistantActivity(
  db: Queryable,
  ownerId: string,
  lane: AssistantActivityLane,
  value: unknown,
) {
  lane = assistantActivityLane.parse(lane);
  const { after, limit } = assistantActivityQuery.parse(value);
  const current =
    (
      await db.query<{ last_sequence: string }>(
        "SELECT last_sequence::text FROM assistant_activity_streams WHERE owner_id=$1 AND runtime_lane=$2",
        [ownerId, lane],
      )
    ).rows[0]?.last_sequence ?? "0";
  if (BigInt(after) > BigInt(current))
    fail(400, "That activity cursor is ahead of this stream.");
  const events = (
    await db.query<{
      sequence: string;
      job_id: string | null;
      kind: string;
      created_at: Date;
    }>(
      `SELECT e.sequence::text,e.job_id,e.kind,e.created_at
     FROM assistant_activity_events e LEFT JOIN ai_jobs j ON j.id=e.job_id
     LEFT JOIN ai_chats c ON c.id=j.chat_id
     WHERE e.owner_id=$1 AND e.runtime_lane=$2 AND e.sequence>$3::bigint
       AND e.sequence<=$4::bigint AND ${visibleEvent}
     ORDER BY e.sequence LIMIT $5`,
      [ownerId, lane, after, current, limit + 1],
    )
  ).rows;
  const latest = await assistantLastActivity(db, ownerId, lane, current);
  const hasMore = events.length > limit;
  const page = events.slice(0, limit);
  return assistantActivityPage.parse({
    lane,
    cursor: hasMore ? page.at(-1)!.sequence : current,
    has_more: hasMore,
    last_activity_at: latest,
    events: page.map((event) => ({
      ...event,
      created_at: event.created_at.toISOString(),
    })),
  });
}

/** Private client recovery feed, independent of interactive conversation polling. */
export async function assistantActivityRoutes(app: FastifyInstance) {
  app.get(
    "/me/assistant/activity/:lane",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await firstParty(request);
      const lane = assistantActivityLane.parse(
        (request.params as { lane: string }).lane,
      );
      const query = assistantActivityQuery.parse(request.query);
      reply.header("Cache-Control", "private, no-store");
      return readTransaction(
        (db) => assistantActivity(db, user.id, lane, query),
        { primary: true },
      );
    },
  );
}
