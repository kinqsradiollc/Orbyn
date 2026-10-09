import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assistantHandoff,
  assistantHandoffInput,
  assistantRuleDecision,
  ASSISTANT_HANDOFF_LIMITS,
  fail,
  HttpError,
  nightShiftInput,
  type AssistantHandoffSource,
  type SystemRole,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { readTransaction, transaction, type Queryable } from "../../db/pool.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantSourceRevision } from "../../lib/assistant-source-revision.js";
import { Params, type Scope } from "../../lib/visibility.js";
import { idParam, writeRateLimit } from "../../lib/params.js";
import { firstParty } from "../proposals/service.js";
import {
  assistantPrincipal,
  AssistantPausedError,
} from "../agents/assistant.js";
import { currentAssistantPrincipal } from "../../capabilities/assistant-principal.js";
import { policy } from "../../capabilities/policy.js";
import { assistantProviderAdmissionSql } from "../ai/providers/admission.js";
import { assistantRunReview } from "./overnight.js";
import { assistantNightWindow } from "../../worker/night-window.js";

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
       WHERE owner_id=$1 AND producer_job_id=$2 AND producer_revision=$3 AND recipient_lane=$4
         AND status NOT IN ('failed','cancelled') ORDER BY created_at DESC LIMIT 1`,
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

/** A receipt is visible only while its producing work and sources remain so. */
export async function readAssistantHandoff(
  db: Queryable,
  ownerId: string,
  handoffId: string,
) {
  const row = (
    await db.query<{
      id: string;
      owner_id: string;
      root_id: string;
      parent_id: string | null;
      depth: number;
      revision: number;
      producer_lane: "background" | "overnight";
      recipient_lane: "background" | "overnight";
      producer_job_id: string;
      recipient_job_id: string | null;
      recipient_chat_id: string | null;
      title: string;
      instruction: string;
      sources: unknown;
      status: string;
      delivery_attempts: number;
      result: unknown;
      failure: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT h.id,h.owner_id,h.root_id,h.parent_id,h.depth,h.revision,
        h.producer_lane,h.recipient_lane,h.producer_job_id,h.recipient_job_id,
        receiving.chat_id AS recipient_chat_id,
        h.title,h.instruction,h.sources,h.status,h.delivery_attempts,
        h.result,h.failure,h.created_at,h.updated_at
       FROM assistant_handoffs h JOIN ai_jobs j ON j.id=h.producer_job_id
       JOIN ai_chats c ON c.id=j.chat_id
       LEFT JOIN ai_jobs receiving ON receiving.id=h.recipient_job_id
       WHERE h.id=$2 AND h.owner_id=$1 AND ${assistantChatVisible("c", "$1")}
         AND ${assistantJobSourcesVisible("j", "$1", false)}`,
      [ownerId, handoffId],
    )
  ).rows[0];
  if (!row) fail(404, "That handoff is not available.");
  return assistantHandoff.parse({
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

export async function assistantHandoffRoutes(app: FastifyInstance) {
  app.get(
    "/me/assistant/handoffs/source/:id",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await firstParty(request);
      reply.header("Cache-Control", "private, no-store");
      return readTransaction(
        (db) => handoffProducerEvidence(db, user.id, idParam(request)),
        { primary: true },
      );
    },
  );
  app.post("/me/assistant/handoffs", writeRateLimit, async (request, reply) => {
    const user = await firstParty(request);
    const id = await createRequestedAssistantHandoff(user.id, request.body);
    reply.header("Cache-Control", "private, no-store");
    return readTransaction((db) => readAssistantHandoff(db, user.id, id), {
      primary: true,
    });
  });
  app.get(
    "/me/assistant/handoffs/:id",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await firstParty(request);
      reply.header("Cache-Control", "private, no-store");
      return readTransaction(
        (db) => readAssistantHandoff(db, user.id, idParam(request)),
        { primary: true },
      );
    },
  );
}

/** Recheck inherited sources under the receiving runtime's live read rules. */
async function receivingHandoffEvidence(
  db: Queryable,
  ownerId: string,
  jobId: string,
  lane: "background" | "overnight",
) {
  const owner = (
    await db.query<{ id: string; name: string; role: SystemRole }>(
      "SELECT id,name,role FROM users WHERE id=$1 AND NOT disabled",
      [ownerId],
    )
  ).rows[0];
  if (!owner) fail(404, "The handoff owner is unavailable.");
  const principal = await assistantPrincipal(owner, {
    db,
    touch: false,
    refusePaused: true,
    lane,
  });
  await currentAssistantPrincipal(db, principal, true);
  const params = new Params(ownerId, jobId);
  const spaces = policy.spaces(principal);
  const scope: Scope = {
    user: "$1",
    teams: spaces.teamIds === null ? undefined : params.add(spaces.teamIds),
    personal: spaces.personal,
    ai: true,
  };
  const row = (
    await db.query<{ answer: string; team_id: string | null }>(
      `SELECT left(coalesce(j.result->>'answer',''),4000) AS answer,
        coalesce(p.team_id,i.team_id) AS team_id
       FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
       LEFT JOIN projects p ON p.id=c.project_id
       LEFT JOIN items i ON c.scope_kind='task' AND i.id=c.scope_id
       WHERE j.id=$2 AND j.user_id=$1 AND j.state='done'
         AND ${assistantChatVisible("c", "$1", scope)}
         AND ${assistantJobSourcesVisible("j", "$1", false, scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) fail(403, "The receiving agent cannot read the producing work.");
  const teams = (
    await db.query<{ team_id: string | null }>(
      `SELECT DISTINCT team_id FROM (
         SELECT s.source_id AS team_id FROM assistant_job_sources s WHERE s.job_id=$1 AND s.source_kind='team'
         UNION ALL SELECT p.team_id FROM assistant_job_sources s JOIN projects p ON p.id=s.source_id WHERE s.job_id=$1 AND s.source_kind='project'
         UNION ALL SELECT i.team_id FROM assistant_job_sources s JOIN items i ON i.id=s.source_id WHERE s.job_id=$1 AND s.source_kind='task'
         UNION ALL SELECT d.team_id FROM assistant_job_sources s JOIN docs d ON d.id=s.source_id WHERE s.job_id=$1 AND s.source_kind='doc'
         UNION ALL SELECT r.team_id FROM assistant_job_sources s JOIN work_records r ON r.id=s.source_id WHERE s.job_id=$1 AND s.source_kind='record'
         UNION ALL SELECT p.team_id FROM assistant_job_sources s JOIN goals g ON g.id=s.source_id JOIN projects p ON p.id=g.project_id WHERE s.job_id=$1 AND s.source_kind='goal'
       ) source`,
      [jobId],
    )
  ).rows;
  const sourceTeams = new Set<string | null>([row.team_id]);
  for (const team of teams) sourceTeams.add(team.team_id);
  for (const teamId of sourceTeams) {
    if (
      policy.levelIn(principal, teamId) === null ||
      assistantRuleDecision(principal.assistant_rules ?? [], lane, teamId, [
        "handoff",
      ]) === "deny"
    )
      fail(
        403,
        "The receiving agent cannot accept this handoff in its source space.",
      );
  }
  if (principal.assistant_rules_revision === undefined)
    fail(409, "Assistant rule evidence is unavailable.");
  return {
    answer: row.answer,
    rulesRevision: principal.assistant_rules_revision,
  };
}

/** One proposal is delivered by the receiving service, never by the API request. */
export async function dispatchAssistantHandoff(
  lane: "background" | "overnight",
) {
  return transaction(async (db) => {
    const receipt = (
      await db.query<{
        id: string;
        owner_id: string;
        revision: number;
        producer_job_id: string;
        producer_revision: string;
        title: string;
        instruction: string;
      }>(
        `SELECT h.id,h.owner_id,h.revision,h.producer_job_id,h.producer_revision,
          h.title,h.instruction FROM assistant_handoffs h
         WHERE h.status='proposed' AND h.recipient_lane=$1
           AND ($1<>'overnight' OR assistant_handoff_window_open(h.owner_id,clock_timestamp()))
           AND assistant_lane_budget_available(h.owner_id,$1,clock_timestamp(),1000)
           AND ${assistantProviderAdmissionSql("h.owner_id")}
         ORDER BY h.created_at,h.id FOR UPDATE OF h SKIP LOCKED LIMIT 1`,
        [lane],
      )
    ).rows[0];
    if (!receipt) return null;
    const budget = (
      await db.query<{ ready: boolean; provider: boolean }>(
        `SELECT assistant_lane_budget_available($1,$2,clock_timestamp(),1000) AS ready,
          ${assistantProviderAdmissionSql("$1")} AS provider`,
        [receipt.owner_id, lane],
      )
    ).rows[0];
    if (!budget?.ready || !budget.provider) return null;
    let windowEnd: string | undefined;
    if (lane === "overnight") {
      const settings = (
        await db.query<{ night_shift: unknown }>(
          "SELECT night_shift FROM agent_settings WHERE user_id=$1",
          [receipt.owner_id],
        )
      ).rows[0];
      const parsed = nightShiftInput.safeParse(settings?.night_shift);
      const window =
        parsed.success && parsed.data.enabled && parsed.data.kinds.handed
          ? assistantNightWindow(new Date(), parsed.data)
          : null;
      if (!window) return null;
      windowEnd = window.end.toISOString();
    }
    let evidence: { answer: string; rulesRevision: number } | null = null;
    let failure: "access" | "revision" | "policy" | null = null;
    try {
      const producer = await handoffProducerEvidence(
        db,
        receipt.owner_id,
        receipt.producer_job_id,
      );
      if (producer.source.revision !== receipt.producer_revision)
        failure = "revision";
      else
        evidence = await receivingHandoffEvidence(
          db,
          receipt.owner_id,
          receipt.producer_job_id,
          lane,
        );
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.statusCode === 403 || error.statusCode === 404)
      )
        failure = error.statusCode === 404 ? "access" : "policy";
      else if (error instanceof AssistantPausedError) failure = "policy";
      else throw error;
    }
    if (failure || !evidence) {
      await db.query(
        `UPDATE assistant_handoffs SET status='failed',failure=$2,
          revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
        [receipt.id, failure ?? "access"],
      );
      return receipt.id;
    }
    const timezone =
      (
        await db.query<{ timezone: string }>(
          "SELECT timezone FROM planner_prefs WHERE user_id=$1",
          [receipt.owner_id],
        )
      ).rows[0]?.timezone ?? "UTC";
    await db.query(
      `UPDATE assistant_handoffs SET delivery_attempts=delivery_attempts+1,
        revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
      [receipt.id],
    );
    const { startAssistantAutomation } = await import("../ai/agent/run.js");
    const jobId = await startAssistantAutomation({
      db,
      userId: receipt.owner_id,
      title: receipt.title,
      timezone,
      message: `${receipt.instruction}\n\nEarlier ${lane === "background" ? "Overnight" : "Background"} result:\n${evidence.answer}`,
      automation: {
        kind: "handoff",
        recipient_lane: lane,
        handoff_id: receipt.id,
        ...(windowEnd ? { end_at: windowEnd } : {}),
      },
      onQueued: async (work, id) => {
        await work.query(
          `INSERT INTO assistant_job_sources(job_id,source_kind,source_id)
            SELECT $2,source_kind,source_id FROM assistant_job_sources WHERE job_id=$1
            ON CONFLICT DO NOTHING`,
          [receipt.producer_job_id, id],
        );
        await work.query(
          `UPDATE ai_jobs SET sources_checked=true,
            run_state=jsonb_set(run_state,'{assistant_rules_revision}',to_jsonb($2::int),true)
           WHERE id=$1 AND user_id=$3`,
          [id, evidence!.rulesRevision, receipt.owner_id],
        );
        await work.query(
          `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
           SELECT j.chat_id,j.turn_id,s.source_kind,s.source_id FROM ai_jobs j
           JOIN assistant_job_sources s ON s.job_id=j.id WHERE j.id=$1
           ON CONFLICT DO NOTHING`,
          [id],
        );
        await work.query(
          `UPDATE assistant_handoffs SET status='accepted',recipient_job_id=$2,
            revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
          [receipt.id, id],
        );
      },
    });
    if (!jobId) throw new Error("A handoff owner disappeared during delivery.");
    return receipt.id;
  });
}

/** A queued or resumed receiving job never trusts the dispatch-time snapshot. */
export async function assertReceivingHandoffCurrent(
  ownerId: string,
  jobId: string,
  handoffId: string,
  rulesRevision: number | undefined,
) {
  return transaction(async (db) => {
    const receipt = (
      await db.query<{
        producer_job_id: string;
        producer_revision: string;
        recipient_lane: "background" | "overnight";
      }>(
        `SELECT producer_job_id,producer_revision,recipient_lane
         FROM assistant_handoffs WHERE id=$1 AND owner_id=$2
           AND recipient_job_id=$3 AND status='accepted' FOR SHARE`,
        [handoffId, ownerId, jobId],
      )
    ).rows[0];
    if (!receipt) fail(409, "This handoff is no longer accepted.");
    const producer = await handoffProducerEvidence(
      db,
      ownerId,
      receipt.producer_job_id,
    );
    if (producer.source.revision !== receipt.producer_revision)
      fail(409, "The producing result changed. This handoff was held.");
    const current = await receivingHandoffEvidence(
      db,
      ownerId,
      receipt.producer_job_id,
      receipt.recipient_lane,
    );
    if (rulesRevision === undefined || rulesRevision !== current.rulesRevision)
      fail(409, "Assistant rules changed. This handoff was held.");
  });
}

/** A worker acknowledges one terminal receiving result per tick. */
export async function settleAssistantHandoff(lane: "background" | "overnight") {
  const receipt = await readTransaction(
    async (db) => {
      const result = await db.query<{
        id: string;
        owner_id: string;
        revision: number;
        state: "done" | "failed";
      }>(
        `SELECT h.id,h.owner_id,h.revision,j.state FROM assistant_handoffs h
       JOIN ai_jobs j ON j.id=h.recipient_job_id
       WHERE h.status='accepted' AND h.recipient_lane=$1 AND j.state IN ('done','failed')
       ORDER BY h.updated_at,h.id LIMIT 1`,
        [lane],
      );
      return result.rows[0];
    },
    { primary: true },
  );
  if (!receipt) return null;
  try {
    if (receipt.state === "done")
      await acknowledgeCompletedAssistantHandoff(
        receipt.owner_id,
        receipt.id,
        receipt.revision,
      );
    else
      await acknowledgeFailedAssistantHandoff(
        receipt.owner_id,
        receipt.id,
        receipt.revision,
      );
  } catch (error) {
    if (
      !(error instanceof HttpError) ||
      ![403, 404, 409].includes(error.statusCode)
    )
      throw error;
    await transaction(async (db) => {
      const reason =
        error.statusCode === 404 || error.statusCode === 403
          ? "access"
          : "revision";
      await db.query(
        `UPDATE assistant_handoffs SET status='failed',failure=$3,
          revision=revision+1,updated_at=clock_timestamp()
         WHERE id=$1 AND revision=$2 AND status='accepted'`,
        [receipt.id, receipt.revision, reason],
      );
    });
  }
  return receipt.id;
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

/** Derive a terminal receiving failure from the current job and source evidence. */
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
