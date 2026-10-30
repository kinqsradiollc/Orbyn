import {
  assistantActivityEvent,
  type AssistantProfileCounts,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import {
  assistantChatContainerVisible,
  assistantChatVisible,
} from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantSourceVisibilitySet } from "../../lib/assistant-source-visibility.js";

type WorkRow = {
  job_id: string;
  chat_id: string;
  title: string;
  state: "queued" | "running" | "waiting";
  cancel_requested: boolean;
  recovering: boolean;
  updated_at: Date;
};
type OutputRow = {
  job_id: string;
  chat_id: string;
  title: string;
  completed_at: Date;
  total_rows: number;
  execution_outcome: unknown;
  goal_acceptance: unknown;
  state: "done" | "failed";
  summary: string;
  review_status: string | null;
  handoff: {
    id: string;
    status: "proposed" | "accepted" | "completed" | "failed" | "cancelled";
    recipient_chat_id: string | null;
  } | null;
};

/** One statement snapshot: authorize each relevant job once, then reuse that
 * exact set for every profile projection. Null-job events remain independent.
 * Nothing is limited before authorization. The enclosing profile route keeps
 * its primary repeatable-read transaction for page/origin projections too. */
export async function readAssistantProfileEvidence(
  db: Queryable,
  owner: string,
  observedAt: string,
  lane: "background" | "overnight",
  includeOutcomes: boolean,
  includeOrigins: boolean,
) {
  const sources = assistantSourceVisibilitySet(
    "authorized_direct_sources",
    `SELECT dependency.source_kind AS kind,dependency.source_id AS id
      FROM assistant_job_sources dependency JOIN relevant_jobs relevant ON relevant.id=dependency.job_id
      JOIN container_chats chat ON chat.id=relevant.chat_id
      UNION SELECT dependency.source_kind,dependency.source_id
      FROM assistant_chat_sources dependency JOIN container_chats chat ON chat.id=dependency.chat_id`,
  );
  const counts = `SELECT count(*) FILTER(WHERE j.state='running' AND j.lease_until>$2)::int AS working,
       count(*) FILTER(WHERE j.state='waiting')::int AS waiting,count(*) FILTER(WHERE j.state='queued')::int AS queued,
       count(*) FILTER(WHERE j.state='running' AND (j.lease_until IS NULL OR j.lease_until<=$2))::int AS recovering
       FROM ai_jobs j LEFT JOIN ai_chats c ON c.id=j.chat_id
       WHERE j.user_id=$1 AND j.runtime_lane=$3 AND j.state IN ('queued','running','waiting')
       AND j.id IN (SELECT id FROM authorized_jobs)`;
  const work = `SELECT j.id AS job_id,j.chat_id,left(c.title,120) AS title,j.state,j.cancel_requested,
      (j.state='running' AND (j.lease_until IS NULL OR j.lease_until<=$2)) AS recovering,
      greatest(j.heartbeat_at,j.created_at) AS updated_at FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
      WHERE j.user_id=$1 AND j.runtime_lane=$3 AND j.state IN ('queued','running','waiting')
      AND j.id IN (SELECT id FROM authorized_jobs)
      ORDER BY (j.state='waiting') DESC,j.created_at,j.id LIMIT 20`;
  const outputs = `SELECT count(*) OVER()::int AS total_rows,j.id AS job_id,j.chat_id,left(c.title,120) AS title,max(e.created_at) AS completed_at,j.result->'assistant_run'->'execution_outcome' AS execution_outcome,(SELECT accepted.acceptance FROM assistant_goal_executions accepted WHERE accepted.owner_id=$1 AND accepted.state='completed' AND accepted.acceptance->>'job_id'=j.id::text LIMIT 1) AS goal_acceptance,j.state,left(coalesce(j.result->>'answer',''),1200) AS summary,CASE WHEN p.status='pending' AND p.expires_at<=now() THEN 'expired' ELSE p.status END AS review_status,
         (SELECT jsonb_build_object('id',h.id,'status',h.status,'recipient_chat_id',r.chat_id)
          FROM assistant_handoffs h LEFT JOIN ai_jobs r ON r.id=h.recipient_job_id
          WHERE h.producer_job_id=j.id AND h.owner_id=$1
          ORDER BY h.created_at DESC,h.id DESC LIMIT 1) AS handoff
       FROM assistant_activity_events e JOIN ai_jobs j ON j.id=e.job_id
       JOIN ai_chats c ON c.id=j.chat_id LEFT JOIN proposals p ON p.user_id=$1 AND p.id=CASE WHEN j.result->'assistant_run'->>'proposal_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (j.result->'assistant_run'->>'proposal_id')::uuid END WHERE e.owner_id=$1 AND e.runtime_lane=$3
       AND ((e.kind='done' AND j.state='done') ${includeOutcomes ? "OR (e.kind='failed' AND j.state='failed')" : ""}) AND j.result IS NOT NULL
       AND j.runtime_lane=$3 AND j.id IN (SELECT id FROM authorized_jobs)
       ${
         includeOutcomes && includeOrigins
           ? `AND NOT (j.state='done'
         AND EXISTS(SELECT 1 FROM assistant_quiet_checks quiet WHERE quiet.owner_id=$1 AND quiet.job_id=j.id AND quiet.status='verified_unchanged')
         AND EXISTS(SELECT 1 FROM assistant_delivery_bindings binding JOIN assistant_delivery_intents intent ON intent.binding_id=binding.id
           WHERE binding.owner_id=$1 AND binding.work_kind='job' AND binding.work_id=j.id
             AND intent.event_key='result' AND intent.payload->>'event'='result' AND intent.state='suppressed' AND intent.reason='unchanged'))`
           : ""
       }
       GROUP BY j.id,j.chat_id,c.title,p.status,p.expires_at ORDER BY ${includeOutcomes && includeOrigins ? "CASE WHEN p.status='pending' AND p.expires_at>now() THEN 0 WHEN j.state='failed' THEN 1 ELSE 2 END," : ""} max(e.created_at) DESC,j.id DESC LIMIT 5`;
  const lastActivity = `SELECT max(e.created_at) AS last_activity_at
    FROM assistant_activity_events e
    WHERE e.owner_id=$1 AND e.runtime_lane=$3 AND e.kind<>'queued'
      AND (e.job_id IS NULL OR e.job_id IN (SELECT id FROM authorized_jobs))`;
  const recent = `SELECT e.sequence::text,e.job_id,e.kind,e.created_at
    FROM assistant_activity_events e
    WHERE e.owner_id=$1 AND e.runtime_lane=$3
      AND (e.job_id IS NULL OR e.job_id IN (SELECT id FROM authorized_jobs))
    ORDER BY e.sequence DESC LIMIT 8`;
  const row = (
    await db.query<{
      counts: AssistantProfileCounts[];
      work: (Omit<WorkRow, "updated_at"> & { updated_at: string })[] | null;
      outputs:
        (Omit<OutputRow, "completed_at"> & { completed_at: string })[] | null;
      last_activity: { last_activity_at: string | null }[];
      recent: unknown[] | null;
    }>(
      `WITH relevant_jobs AS MATERIALIZED (
    SELECT j.id,j.chat_id FROM ai_jobs j
    WHERE j.user_id=$1 AND j.sources_checked AND ((j.runtime_lane=$3 AND j.state IN ('queued','running','waiting')) OR EXISTS(
      SELECT 1 FROM assistant_activity_events relevant
      WHERE relevant.owner_id=$1 AND relevant.runtime_lane=$3 AND relevant.job_id=j.id))
  ),container_chats AS MATERIALIZED (
    SELECT c.id FROM ai_chats c
    JOIN (SELECT DISTINCT chat_id FROM relevant_jobs) relevant_chat ON relevant_chat.chat_id=c.id
    WHERE ${assistantChatContainerVisible("c", "$1")}
  ),${sources.cte},authorized_chats AS MATERIALIZED (
    SELECT c.id FROM ai_chats c JOIN container_chats candidate ON candidate.id=c.id
    WHERE ${assistantChatVisible("c", "$1", undefined, sources)}
  ),authorized_jobs AS MATERIALIZED (
    SELECT j.id FROM relevant_jobs relevant JOIN ai_jobs j ON j.id=relevant.id
    JOIN authorized_chats c ON c.id=j.chat_id
    WHERE ${assistantJobSourcesVisible("j", "$1", false, undefined, true, sources)}
  )
  SELECT (SELECT jsonb_agg(to_jsonb(projection)) FROM (${counts}) projection) AS counts,
    ${includeOutcomes ? `(SELECT jsonb_agg(to_jsonb(projection)) FROM (${work}) projection)` : "NULL::jsonb"} AS work,
    (SELECT jsonb_agg(to_jsonb(projection)) FROM (${outputs}) projection) AS outputs,
    (SELECT jsonb_agg(to_jsonb(projection)) FROM (${lastActivity}) projection) AS last_activity,
    (SELECT jsonb_agg(to_jsonb(projection)) FROM (${recent}) projection) AS recent`,
      [owner, observedAt, lane],
    )
  ).rows[0];
  return {
    counts: row.counts[0],
    work: (row.work ?? []).map((work) => ({
      ...work,
      updated_at: new Date(work.updated_at),
    })),
    outputs: (row.outputs ?? []).map((output) => ({
      ...output,
      completed_at: new Date(output.completed_at),
    })),
    lastActivity:
      row.last_activity[0].last_activity_at === null
        ? null
        : new Date(row.last_activity[0].last_activity_at).toISOString(),
    recentActivity: (row.recent ?? []).map((event) =>
      assistantActivityEvent.parse({
        ...(event as object),
        created_at: new Date(
          (event as { created_at: string }).created_at,
        ).toISOString(),
      }),
    ),
  };
}
