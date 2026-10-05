import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  fail,
  dayTime,
  localDateKey,
  aiProviderChoice,
  aiFeatureProvider,
  agendaPrivateSummary,
  type DocBlock,
} from "@orbyn/core";
import { pool, transaction, type Db } from "../../db/pool.js";
import {
  lockAgendaSources,
  lockAgendaSourcePage,
} from "../../lib/agenda-source-fence.js";
import { visibleDocs } from "../../lib/visibility.js";
import { assistantMayRead } from "../../lib/doc-visibility.js";
import { announceDocChange } from "./live.js";
import { recordAssistantSources } from "../../lib/assistant-job-sources.js";
import {
  captureAgendaScheduleGrant,
  assertAgendaScheduleGrant,
} from "../auth/agenda-private-permission.js";
import {
  captureAgendaAiSnapshot,
  assertAgendaAiSnapshot,
} from "./agenda-ai-snapshot.js";
import { agendaSnapshotSchema } from "../ai/providers/agenda-call.js";
import { assistantRuntimeHasRoom } from "../ai/agent/runtime-slots.js";
import { requireLiveSession } from "../auth/chatgpt-connections.js";

/** Owner-only status omits source facts, captured permission and operation credentials. */
export async function readScheduledAgendaSummary(session: {
  userId: string;
  sessionId: string;
}) {
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const row = (
      await db.query(
        `SELECT r.id,r.doc_id,r.local_day::text,r.state,r.expires_at,r.updated_at,r.reason,r.provider
       FROM agenda_summary_runs r JOIN docs d ON d.id=r.doc_id
       WHERE r.user_id=$1 AND d.user_id=$1 AND ${visibleDocs("d", { user: "$1", ai: true })}
       AND ${assistantMayRead("d")} ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,
        [session.userId],
      )
    ).rows[0];
    return agendaPrivateSummary.parse({
      run: row
        ? {
            ...row,
            expires_at: row.expires_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
          }
        : null,
    });
  });
}

const permissionSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    providerChoice: aiProviderChoice,
    model: z.string().min(1).max(200),
    preferenceVersion: z.number().int().nonnegative(),
  })
  .strict();
const jobState = z
  .object({
    version: z.literal(5),
    feature: z.literal("agenda_brief"),
    parent_id: z.uuid(),
    parent_lease: z.uuid(),
    operation_id: z.uuid(),
    request: z
      .object({ automation: z.object({ kind: z.literal("agenda") }).strict() })
      .strict(),
  })
  .strict();
export type AgendaSummaryRun = {
  id: string;
  user_id: string;
  doc_id: string;
  local_day: string;
  target_block_id: string;
  target_hash: string;
  snapshot: unknown;
  permission: unknown;
  operation_id: string;
  state: "queued" | "running" | "waiting" | "done" | "failed";
  lease_token: string | null;
  lease_expires_at: Date | null;
  expires_at: Date;
  reason: string | null;
  provider: unknown;
};
const targetHash = (block: DocBlock) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        id: block.id,
        type: block.type,
        text: "text" in block ? block.text : "",
      }),
    )
    .digest("hex");
const targetSql = `SELECT d.id,d.content,d.version,d.agenda_date::text FROM docs d WHERE d.id=$2 AND d.user_id=$1 AND d.kind='agenda' AND d.team_id IS NULL AND d.project_id IS NULL AND ${visibleDocs("d", { user: "$1", ai: true })} AND ${assistantMayRead("d")}`;

/** Enqueue one scoped private summary per local day; page generation alone grants nothing. */
export async function enqueueScheduledAgenda(
  owner: string,
  docId: string,
  now: Date,
  timezone: string,
  generatedVersion = 1,
) {
  return transaction(async (db) => {
    const permission = await captureAgendaScheduleGrant(db, owner);
    if (!permission) return null;
    const date = localDateKey(now, timezone);
    const expiry = dayTime(date, 11 * 60, timezone);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hourCycle: "h23",
        timeZone: timezone,
      }).format(now),
    );
    if (hour < 5 || hour >= 11 || expiry <= now) return null;
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `agenda-summary:${owner}:${date}`,
    ]);
    const existing = (
      await db.query(
        "SELECT id FROM agenda_summary_runs WHERE user_id=$1 AND local_day=$2",
        [owner, date],
      )
    ).rows[0];
    if (existing) return existing.id as string;
    await lockAgendaSources(db, owner);
    const snapshot = agendaSnapshotSchema.parse(
      await captureAgendaAiSnapshot(owner, now, db),
    );
    const page = (
      await lockAgendaSourcePage(db, targetSql + " FOR UPDATE OF d", [
        owner,
        docId,
      ])
    ).rows[0];
    if (
      !page ||
      page.version !== generatedVersion ||
      page.agenda_date !== date ||
      !Array.isArray(page.content) ||
      page.content[0]?.type !== "paragraph"
    )
      return null;
    const content = page.content as DocBlock[];
    // Reserve only the generated opening paragraph. No other block is part of the write grant.
    if (!content[0].id) {
      content[0] = { ...content[0], id: randomUUID() };
      await db.query(
        "UPDATE docs SET content=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
        [docId, JSON.stringify(content)],
      );
    }
    const row = (
      await db.query(
        `INSERT INTO agenda_summary_runs(user_id,doc_id,local_day,target_block_id,target_hash,snapshot,permission,expires_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING id`,
        [
          owner,
          docId,
          date,
          content[0].id,
          targetHash(content[0]),
          JSON.stringify(snapshot),
          JSON.stringify(permission),
          expiry,
        ],
      )
    ).rows[0];
    return row.id as string;
  });
}

/** Parent first, then companion: broker claims, worker settlement and revocation share the order. */
export async function guardScheduledAgendaRun(
  db: Db,
  owner: string,
  id: string,
  token: string,
) {
  await db.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [owner]);
  const run = (
    await db.query<AgendaSummaryRun>(
      "SELECT *,local_day::text FROM agenda_summary_runs WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, owner],
    )
  ).rows[0];
  if (!run || run.state !== "running" || run.lease_token !== token)
    fail(409, "This Agenda summary is no longer owned by its worker.");
  const live = (
    await db.query(
      "SELECT 1 FROM agenda_summary_runs WHERE id=$1 AND lease_expires_at>clock_timestamp() AND expires_at>clock_timestamp()",
      [id],
    )
  ).rowCount;
  if (!live) fail(409, "This scheduled Agenda summary expired.");
  await lockAgendaSources(db, owner);
  const permission = permissionSchema.parse(run.permission);
  await assertAgendaScheduleGrant(db, owner, permission);
  const snapshot = agendaSnapshotSchema.parse(run.snapshot);
  try {
    await assertAgendaAiSnapshot(
      owner,
      new Date(snapshot.capturedAt),
      snapshot,
      db,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Agenda "))
      fail(409, "The scheduled Agenda sources or facts changed.");
    throw error;
  }
  const page = (
    await lockAgendaSourcePage(db, targetSql + " FOR SHARE OF d", [
      owner,
      run.doc_id,
    ])
  ).rows[0];
  const content = page?.content as DocBlock[] | undefined;
  const block = content?.find((b) => b.id === run.target_block_id);
  if (
    !page ||
    page.agenda_date !== run.local_day ||
    !block ||
    block.type !== "paragraph" ||
    targetHash(block) !== run.target_hash
  )
    fail(409, "The Agenda summary paragraph or its access changed.");
  return { run, snapshot, permission, page };
}

/** A version5 transport never gets authority from an arbitrary job ID or app session. */
export async function guardScheduledAgendaJob(
  db: Db,
  owner: string,
  jobId: string,
  row: {
    run_state: unknown;
    agenda_summary_run_id: string | null;
    claimed_by: string | null;
  },
) {
  const state = jobState.safeParse(row.run_state);
  if (
    !state.success ||
    state.data.parent_id !== row.agenda_summary_run_id ||
    state.data.parent_lease !== row.claimed_by
  )
    fail(409, "This scheduled Agenda transport is unavailable.");
  const context = await guardScheduledAgendaRun(
    db,
    owner,
    state.data.parent_id,
    state.data.parent_lease,
  );
  if (context.run.operation_id !== state.data.operation_id)
    fail(409, "The Agenda model operation changed.");
}

/** Atomic background claim, with safe cached/undisclosed recovery and a stable call identity. */
export async function claimScheduledAgenda(runId?: string) {
  return transaction(async (db) => {
    if (!(await assistantRuntimeHasRoom(db, "background"))) return null;
    const candidate = (
      await db.query<{ id: string; user_id: string }>(
        `SELECT id,user_id FROM agenda_summary_runs WHERE ($1::uuid IS NULL OR id=$1)
      AND ((state IN ('queued','waiting') AND next_attempt_at<=clock_timestamp()) OR (state='running' AND lease_expires_at<=clock_timestamp())) ORDER BY created_at,id LIMIT 1`,
        [runId ?? null],
      )
    ).rows[0];
    if (!candidate) return null;
    await db.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [
      candidate.user_id,
    ]);
    const run = (
      await db.query<AgendaSummaryRun>(
        `SELECT *,local_day::text FROM agenda_summary_runs WHERE id=$1
      AND ((state IN ('queued','waiting') AND next_attempt_at<=clock_timestamp()) OR (state='running' AND lease_expires_at<=clock_timestamp())) FOR UPDATE SKIP LOCKED`,
        [candidate.id],
      )
    ).rows[0];
    if (!run) return null;
    const live = (
      await db.query(
        "SELECT 1 FROM agenda_summary_runs WHERE id=$1 AND expires_at>clock_timestamp()",
        [run.id],
      )
    ).rowCount;
    if (!live) {
      await db.query(
        "UPDATE agenda_summary_runs SET state='failed',reason='expired',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1",
        [run.id],
      );
      return null;
    }
    const previous = (
      await db.query(
        `SELECT o.state,r.state AS request_state,r.expires_at,
      (o.fallback_result_encrypted IS NOT NULL OR (r.state='completed' AND r.result_encrypted IS NOT NULL)) AS completed
      FROM ai_jobs j JOIN chatgpt_inference_operations o ON o.job_id=j.id LEFT JOIN chatgpt_inference_requests r ON r.id=o.request_id WHERE j.agenda_summary_run_id=$1`,
        [run.id],
      )
    ).rows;
    if (
      previous.some(
        (op) =>
          !op.completed &&
          !(op.request_state === "queued" && op.expires_at > new Date()),
      )
    ) {
      await db.query(
        "UPDATE agenda_summary_runs SET state='failed',reason='completion_unknown',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1",
        [run.id],
      );
      return null;
    }
    const token = randomUUID();
    const claimed = (
      await db.query<AgendaSummaryRun>(
        "UPDATE agenda_summary_runs SET state='running',lease_token=$2,lease_expires_at=clock_timestamp()+interval '90 seconds',reason=NULL,updated_at=now() WHERE id=$1 RETURNING *,local_day::text",
        [run.id, token],
      )
    ).rows[0];
    let context: Awaited<ReturnType<typeof guardScheduledAgendaRun>>;
    try {
      context = await guardScheduledAgendaRun(db, run.user_id, run.id, token);
    } catch (error) {
      if (
        (error as { statusCode?: number })?.statusCode ||
        (error instanceof Error && error.message.startsWith("Agenda "))
      ) {
        await db.query(
          "UPDATE agenda_summary_runs SET state='failed',reason='authority_changed',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1",
          [run.id],
        );
        return null;
      }
      throw error;
    }
    const state = jobState.parse({
      version: 5,
      feature: "agenda_brief",
      parent_id: run.id,
      parent_lease: token,
      operation_id: run.operation_id,
      request: { automation: { kind: "agenda" } },
    });
    const job = (
      await db.query<{ id: string }>(
        `INSERT INTO ai_jobs(user_id,state,claimed_by,lease_until,run_state,agenda_summary_run_id)
      VALUES($1,'running',$2,clock_timestamp()+interval '90 seconds',$3::jsonb,$4)
      ON CONFLICT(agenda_summary_run_id) DO UPDATE SET state='running',claimed_by=excluded.claimed_by,lease_until=excluded.lease_until,run_state=excluded.run_state,heartbeat_at=now() RETURNING id`,
        [run.user_id, token, JSON.stringify(state), run.id],
      )
    ).rows[0];
    return { run: claimed, jobId: job.id, snapshot: context.snapshot };
  });
}

/** Only an undisclosed operation can return to waiting without consuming another model request. */
export async function deferScheduledAgenda(
  owner: string,
  id: string,
  token: string,
) {
  return transaction(async (db) => {
    await guardScheduledAgendaRun(db, owner, id, token);
    const sent = (
      await db.query(
        "SELECT 1 FROM ai_jobs j JOIN chatgpt_inference_operations o ON o.job_id=j.id WHERE j.agenda_summary_run_id=$1",
        [id],
      )
    ).rowCount;
    if (sent)
      fail(409, "An Agenda model call already exists. It was not retried.");
    await db.query(
      "UPDATE agenda_summary_runs SET state='waiting',reason='device_required',next_attempt_at=clock_timestamp()+interval '60 seconds',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1",
      [id],
    );
  });
}

/** Replace exactly the authorized paragraph, with all other current blocks preserved. */
export async function applyScheduledAgenda(
  owner: string,
  id: string,
  token: string,
  text: string,
) {
  const result = await transaction(async (db) => {
    const { run } = await guardScheduledAgendaRun(db, owner, id, token);
    const page = (
      await lockAgendaSourcePage(db, targetSql + " FOR UPDATE OF d", [
        owner,
        run.doc_id,
      ])
    ).rows[0];
    const content = page.content as DocBlock[];
    const index = content.findIndex((b) => b.id === run.target_block_id);
    if (index < 0 || targetHash(content[index]) !== run.target_hash)
      fail(409, "The summary paragraph changed.");
    content[index] = { ...content[index], text } as DocBlock;
    const job = (
      await db.query(
        "SELECT id,result FROM ai_jobs WHERE agenda_summary_run_id=$1 AND state='running' AND claimed_by=$2 FOR UPDATE",
        [id, token],
      )
    ).rows[0];
    if (!job) fail(409, "The Agenda transport changed.");
    const provider = aiFeatureProvider.parse(job.result?.feature_provider);
    const saved = (
      await db.query(
        `UPDATE docs SET content=$2::jsonb,version=version+1,updated_at=now()
         WHERE id=$1 AND EXISTS(SELECT 1 FROM agenda_summary_runs r
           WHERE r.id=$3 AND r.user_id=$4 AND r.state='running' AND r.lease_token=$5
             AND r.lease_expires_at>clock_timestamp() AND r.expires_at>clock_timestamp())
         RETURNING version`,
        [run.doc_id, JSON.stringify(content), id, owner, token],
      )
    ).rows[0];
    if (!saved)
      fail(409, "This scheduled Agenda summary expired before application.");
    const version = saved.version;
    await db.query(
      "UPDATE ai_jobs SET state='done',claimed_by=NULL,lease_until=NULL,heartbeat_at=now() WHERE id=$1",
      [job.id],
    );
    await db.query(
      "UPDATE agenda_summary_runs SET state='done',provider=$2::jsonb,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1",
      [id, JSON.stringify(provider)],
    );
    return { docId: run.doc_id, version };
  });
  await announceDocChange(pool, result.docId, result.version, "agenda").catch(
    () => {},
  );
}

/** Fixed failure reasons; provider bodies and private prompt data are never exposed. */
export async function failScheduledAgenda(
  owner: string,
  id: string,
  token: string,
  reason: string,
) {
  await transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [owner]);
    await db.query(
      "UPDATE agenda_summary_runs SET state='failed',reason=$4,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND user_id=$2 AND lease_token=$3 AND state='running'",
      [id, owner, token, reason],
    );
  });
}

/** Producing sources are recorded before any inference envelope can be queued. */
export async function recordScheduledAgendaSources(
  run: AgendaSummaryRun,
  jobId: string,
) {
  const snapshot = agendaSnapshotSchema.parse(run.snapshot);
  await recordAssistantSources(jobId, run.user_id, {}, [
    `doc:${run.doc_id}`,
    ...snapshot.sources.map((s) => `${s.kind}:${s.id}`),
  ]);
}
