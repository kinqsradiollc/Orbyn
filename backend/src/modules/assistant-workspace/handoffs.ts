import { createHash, randomUUID } from "node:crypto";
import {
  assistantHandoffInput,
  ASSISTANT_HANDOFF_LIMITS,
  fail,
  type AssistantHandoffSource,
} from "@orbyn/core";
import { transaction, type Queryable } from "../../db/pool.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantRunReview } from "./overnight.js";

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
        coalesce((SELECT jsonb_agg(jsonb_build_array(d.source_kind,d.source_id) ORDER BY d.source_kind,d.source_id)
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
