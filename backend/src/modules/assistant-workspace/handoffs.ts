import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assistantHandoffInput,
  ASSISTANT_HANDOFF_LIMITS,
  fail,
  HttpError,
  type AssistantHandoffSource,
} from "@orbyn/core";
import { transaction, type Queryable } from "../../db/pool.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantRunReview } from "./overnight.js";
import { assistantSourceRevision } from "../../lib/assistant-source-revision.js";

/** Current producer evidence, never an authorization grant for receiving work. */
export async function handoffProducerEvidence(
  db: Queryable,
  ownerId: string,
  jobId: string,
) {
  const row = (
    await db.query<{
      id: string;
      runtime_lane: "background" | "overnight";
      title: string;
      result: unknown;
      apply_result: unknown;
      container: unknown;
      dependencies: unknown;
    }>(
      `SELECT j.id,j.runtime_lane,c.title,j.result,j.apply_result,
        jsonb_build_object('chat_id',c.id,'project_id',c.project_id,'scope_kind',c.scope_kind,'scope_id',c.scope_id) AS container,
        coalesce((SELECT jsonb_agg(jsonb_build_array(d.source_kind,d.source_id,${assistantSourceRevision("d.source_kind", "d.source_id")}) ORDER BY d.source_kind,d.source_id)
          FROM assistant_job_sources d WHERE d.job_id=j.id),'[]'::jsonb) AS dependencies
    FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
    JOIN users u ON u.id=j.user_id AND NOT u.disabled
    WHERE j.id=$2 AND j.state='done' AND j.runtime_lane IN ('background','overnight')
      AND ${assistantChatVisible("c", "$1")}
      AND ${assistantJobSourcesVisible("j", "$1", false)}
    FOR SHARE OF j`,
      [ownerId, jobId],
    )
  ).rows[0];
  if (!row) fail(404, "That completed work is not available for a handoff.");
  const review = await assistantRunReview(db, ownerId, row);
  // Include review/apply/Undo changes, but exclude polling, heartbeat and leases.
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        title: row.title,
        result: row.result,
        apply_result: row.apply_result,
        container: row.container,
        dependencies: row.dependencies,
        review: {
          ...review,
          // The stored deadline and actual Undo outcome matter; the display
          // eligibility flag changes with the clock without a new outcome.
          changes: review.changes.map(
            ({ undoable: _eligibility, ...change }) => change,
          ),
        },
      }),
    )
    .digest("hex");
  return {
    source: {
      kind: "job",
      id: row.id,
      revision,
    } satisfies AssistantHandoffSource,
    lane: row.runtime_lane,
  };
}

/**
 * Record a person's explicit follow-up request. No dispatch or authority is
 * inferred from this proposal. A consumer must independently recheck sources,
 * rules, connections and budget before creating or running receiving work.
 */
export async function createRequestedAssistantHandoff(
  ownerId: string,
  value: unknown,
): Promise<string> {
  const input = assistantHandoffInput.parse(value);
  ownerId = ownerId.toLowerCase();
  return transaction(async (db) => {
    const producer = await handoffProducerEvidence(
      db,
      ownerId,
      input.producer_job_id,
    );
    if (producer.source.revision !== input.expected_producer_revision)
      fail(409, "That result changed. Review it before requesting a handoff.");
    if (producer.lane === input.recipient_lane)
      fail(400, "Choose the other agent runtime for this handoff.");
    const key = [
      ownerId,
      producer.source.id,
      producer.source.revision,
      input.recipient_lane,
    ].join(":");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,208))", [
      key,
    ]);
    const existing = (
      await db.query<{ id: string; title: string; instruction: string }>(
        `SELECT id,title,instruction FROM assistant_handoffs
       WHERE owner_id=$1 AND producer_job_id=$2 AND producer_revision=$3 AND recipient_lane=$4`,
        [
          ownerId,
          producer.source.id,
          producer.source.revision,
          input.recipient_lane,
        ],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.title !== input.title ||
        existing.instruction !== input.instruction
      )
        fail(409, "This result already has a different follow-up request.");
      return existing.id;
    }
    // Receiving work continues the same trail; clients cannot reset its depth.
    const parent = (
      await db.query<{
        id: string;
        root_id: string;
        depth: number;
        status: string;
        result: { revision?: string } | null;
      }>(
        "SELECT id,root_id,depth,status,result FROM assistant_handoffs WHERE owner_id=$1 AND recipient_job_id=$2 FOR SHARE",
        [ownerId, producer.source.id],
      )
    ).rows[0];
    if (
      parent &&
      (parent.status !== "completed" ||
        parent.result?.revision !== producer.source.revision)
    )
      fail(
        409,
        "The receiving work has not been acknowledged at this revision.",
      );
    if (parent && parent.depth >= ASSISTANT_HANDOFF_LIMITS.depth)
      fail(409, "This collaboration has reached its handoff depth limit.");
    const id = randomUUID();
    await db.query(
      `INSERT INTO assistant_handoffs(id,owner_id,root_id,parent_id,depth,
      producer_lane,recipient_lane,producer_job_id,producer_revision,title,instruction,sources)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        id,
        ownerId,
        parent?.root_id ?? id,
        parent?.id ?? null,
        parent ? parent.depth + 1 : 0,
        producer.lane,
        input.recipient_lane,
        producer.source.id,
        producer.source.revision,
        input.title,
        input.instruction,
        JSON.stringify([producer.source]),
      ],
    );
    return id;
  });
}

/**
 * Acknowledge actual completed receiving work. This grants no authority and
 * takes no caller-supplied result: both revisions come from current evidence.
 * Replaying the same completed transition is safe while its evidence is current.
 */
export async function acknowledgeCompletedAssistantHandoff(
  ownerId: string,
  handoffId: string,
  expectedRevision: number,
): Promise<AssistantHandoffSource> {
  z.uuid().parse(ownerId);
  z.uuid().parse(handoffId);
  z.number().int().positive().parse(expectedRevision);
  return transaction(async (db) => {
    const receipt = (
      await db.query<{
        revision: number;
        status: string;
        producer_job_id: string;
        producer_revision: string;
        producer_lane: "background" | "overnight";
        recipient_job_id: string | null;
        recipient_lane: "background" | "overnight";
        result: AssistantHandoffSource | null;
      }>(
        `SELECT h.revision,h.status,h.producer_job_id,h.producer_revision,
          h.producer_lane,h.recipient_job_id,h.recipient_lane,h.result
         FROM assistant_handoffs h JOIN users u ON u.id=h.owner_id AND NOT u.disabled
         WHERE h.id=$2 AND h.owner_id=$1 FOR UPDATE OF h`,
        [ownerId, handoffId],
      )
    ).rows[0];
    if (!receipt) fail(404, "That handoff is not available.");
    const replay =
      receipt.status === "completed" &&
      receipt.revision === expectedRevision + 1;
    if (!replay && receipt.revision !== expectedRevision)
      fail(409, "That handoff changed. Reload before acknowledging it.");
    if (!receipt.recipient_job_id || (!replay && receipt.status !== "accepted"))
      fail(409, "Only accepted receiving work can be acknowledged.");
    const producer = await handoffProducerEvidence(
      db,
      ownerId,
      receipt.producer_job_id,
    );
    if (
      producer.lane !== receipt.producer_lane ||
      producer.source.revision !== receipt.producer_revision
    )
      fail(409, "The producing evidence changed before acknowledgment.");
    const receiving = await handoffProducerEvidence(
      db,
      ownerId,
      receipt.recipient_job_id,
    );
    if (receiving.lane !== receipt.recipient_lane)
      fail(409, "The receiving runtime no longer matches this handoff.");
    if (replay) {
      if (
        receipt.result?.kind !== "job" ||
        receipt.result.id !== receiving.source.id ||
        receipt.result.revision !== receiving.source.revision
      )
        fail(409, "The acknowledged result changed. Review the new outcome.");
      return receiving.source;
    }
    await db.query(
      `UPDATE assistant_handoffs SET status='completed',revision=revision+1,
        result=$3::jsonb,updated_at=greatest(updated_at,clock_timestamp())
       WHERE id=$1 AND revision=$2`,
      [handoffId, expectedRevision, JSON.stringify(receiving.source)],
    );
    return receiving.source;
  });
}

/** Record terminal receiving failure with a server-derived reason, never caller text. */
export async function acknowledgeFailedAssistantHandoff(
  ownerId: string,
  handoffId: string,
  expectedRevision: number,
): Promise<"access" | "revision" | "execution"> {
  z.uuid().parse(ownerId);
  z.uuid().parse(handoffId);
  z.number().int().positive().parse(expectedRevision);
  return transaction(async (db) => {
    const receipt = (
      await db.query<{
        revision: number;
        status: string;
        failure: string | null;
        producer_job_id: string;
        producer_revision: string;
        recipient_job_id: string | null;
        recipient_lane: string;
      }>(
        `SELECT h.revision,h.status,h.failure,h.producer_job_id,h.producer_revision,
          h.recipient_job_id,h.recipient_lane
         FROM assistant_handoffs h JOIN users u ON u.id=h.owner_id AND NOT u.disabled
         WHERE h.id=$2 AND h.owner_id=$1 FOR UPDATE OF h`,
        [ownerId, handoffId],
      )
    ).rows[0];
    if (!receipt) fail(404, "That handoff is not available.");
    const replay =
      receipt.status === "failed" && receipt.revision === expectedRevision + 1;
    if (!replay && receipt.revision !== expectedRevision)
      fail(409, "That handoff changed. Reload before acknowledging it.");
    if (!receipt.recipient_job_id || (!replay && receipt.status !== "accepted"))
      fail(409, "Only accepted receiving work can report execution failure.");
    const receiving = (
      await db.query<{ visible: boolean }>(
        `SELECT coalesce(${assistantChatVisible("c", "$1")}
          AND ${assistantJobSourcesVisible("j", "$1", false)},false) AS visible
         FROM ai_jobs j LEFT JOIN ai_chats c ON c.id=j.chat_id
         WHERE j.id=$2 AND j.user_id=$1 AND j.runtime_lane=$3 AND j.state='failed'
         FOR SHARE OF j`,
        [ownerId, receipt.recipient_job_id, receipt.recipient_lane],
      )
    ).rows[0];
    if (!receiving) fail(409, "The receiving work has not failed.");
    let reason: "access" | "revision" | "execution" = receiving.visible
      ? "execution"
      : "access";
    if (receiving.visible) {
      try {
        const producing = await handoffProducerEvidence(
          db,
          ownerId,
          receipt.producer_job_id,
        );
        if (producing.source.revision !== receipt.producer_revision)
          reason = "revision";
      } catch (error) {
        if (!(error instanceof HttpError) || error.statusCode !== 404)
          throw error;
        reason = "access";
      }
    }
    if (replay) {
      if (receipt.failure !== reason)
        fail(
          409,
          "The failed work's evidence changed. Review its current state.",
        );
      return reason;
    }
    await db.query(
      `UPDATE assistant_handoffs SET status='failed',failure=$3,revision=revision+1,
        updated_at=greatest(updated_at,clock_timestamp()) WHERE id=$1 AND revision=$2`,
      [handoffId, expectedRevision, reason],
    );
    return reason;
  });
}
