import type { AgentInboxKind } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";

/**
 * Telling a person's agents that something happened (Agent 2, H0). Every
 * item reaches the inbox through one database function,
 * agent_inbox_emit() (migration 157): in-app notifications call it from a
 * trigger, in the transaction that notified the person, and the few events
 * that aren't notifications call it through here, in their own
 * transaction. The function decides which connections may see it (spaces,
 * keep-out projects, a team's agent policy, mutes), dedupes, tells their
 * listen streams and schedules their wake-ups, so the request path only
 * pays for one statement.
 */

/** Who wrote the words in an item: fenced or hidden for the agent. */
export type InboxSource =
  | "orbyn"
  | "teammate"
  | "booking_guest"
  | "inbound_email"
  | "import"
  | "subscribed_feed";

/** What an item is about, for its links and the check when it's read. */
export type InboxEntity =
  | "task"
  | "doc"
  | "project"
  | "record"
  | "booking"
  | "proposal"
  | "question"
  | "team"
  | "exam";

export type InboxEvent = {
  userId: string;
  kind: AgentInboxKind;
  /** The same key twice is one item per connection. */
  key: string;
  /** What happened, in plain words. */
  title: string;
  body?: string;
  source?: InboxSource;
  entity?: { type: InboxEntity; id: string | null } | null;
  /** The space it's in: null for Personal. */
  teamId?: string | null;
  projectId?: string | null;
  /** Only this connection (review decisions, answers to its questions). */
  grantId?: string | null;
};

/** Adds an item to the inboxes of the person's connections that may see it. */
export async function emitInbox(db: Queryable, e: InboxEvent): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT agent_inbox_emit($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid,
       $9::uuid, $10::uuid, $11::uuid) AS n`,
    [
      e.userId,
      e.kind,
      e.key,
      e.title,
      e.body ?? "",
      e.source ?? "orbyn",
      e.entity?.type ?? null,
      e.entity?.id ?? null,
      e.teamId ?? null,
      e.projectId ?? null,
      e.grantId ?? null,
    ],
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * The space and project of a task or page, for an item about it. Null
 * when it's gone.
 */
export async function placeOf(
  db: Queryable,
  type: "task" | "doc",
  id: string,
): Promise<{ team_id: string | null; project_id: string | null } | null> {
  const table = type === "task" ? "items" : "docs";
  return (
    (
      await db.query<{ team_id: string | null; project_id: string | null }>(
        `SELECT team_id, project_id FROM ${table} WHERE id = $1`,
        [id],
      )
    ).rows[0] ?? null
  );
}
