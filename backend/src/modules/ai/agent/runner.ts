import { flushAssistantAwayNotices } from "./notices.js";
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { withAssistantLease } from "./lease.js";
import { pool, transaction } from "../../../db/pool.js";
import type { UserRow } from "../../../lib/auth.js";
import {
  acquireAssistantRuntime,
  ASSISTANT_RUNTIME_CAPACITY,
  type AssistantRuntimeLane,
} from "./runtime-lanes.js";
import {
  assistantRunStateFor,
  failStaleAssistantJobs,
  runAssistantJob,
  requestAssistantJobShutdown,
} from "./run.js";

/** One claim is atomic across AI replicas; provider calls never hold the DB lock. */
export async function claimAssistantJob(
  claimedBy: string,
  lane: AssistantRuntimeLane = "interactive",
) {
  return transaction(async (db) => {
    // Serialize the short claim across replicas, including old consumers during
    // a rolling upgrade. No lock is held during a provider call.
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('assistant-global-slots'))",
    );
    const occupied = (
      await db.query<{ count: number; lane_count: number }>(
        `SELECT count(*)::int AS count,
         count(*) FILTER (WHERE runtime_lane = $1)::int AS lane_count
         FROM ai_jobs WHERE state='running' AND run_state->>'version'='1' AND lease_until > now()`,
        [lane],
      )
    ).rows[0];
    if (
      occupied.count >= 8 ||
      occupied.lane_count >= ASSISTANT_RUNTIME_CAPACITY[lane]
    )
      return null;
    const row = (
      await db.query<{ id: string; user_id: string; run_state: unknown }>(
        `WITH candidate AS (
         SELECT candidate.id FROM ai_jobs candidate
         WHERE candidate.state = 'queued' AND candidate.runtime_lane = $2 AND candidate.run_state->>'version' = '1'
           AND candidate.run_state->'request' IS NOT NULL
           AND (candidate.work_source_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM ai_jobs busy WHERE busy.id<>candidate.id AND busy.user_id=candidate.user_id
               AND busy.work_source_kind=candidate.work_source_kind AND busy.work_source_id=candidate.work_source_id
               AND busy.state IN ('running','waiting')))
         ORDER BY candidate.created_at, candidate.id FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
       )
       UPDATE ai_jobs j SET state = 'running', claimed_by = $1,
         lease_until = now() + interval '60 seconds', heartbeat_at = now()
       FROM candidate WHERE j.id = candidate.id
       RETURNING j.id, j.user_id, j.run_state`,
        [claimedBy, lane],
      )
    ).rows[0];
    return row ?? null;
  });
}

/** A bounded consumer for one runtime lane, shared only by its own replicas. */
export function startAssistantRunner(
  log: FastifyBaseLogger,
  options: {
    shutdownMs?: number;
    lane?: AssistantRuntimeLane;
    onTick?: () => Promise<void>;
  } = {},
) {
  const lane = options.lane ?? "interactive";
  const releaseRuntime = acquireAssistantRuntime(lane);
  const claimedBy = `${lane}-${process.pid}-${randomUUID()}`;
  const active = new Set<Promise<void>>();
  const jobs = new Map<Promise<void>, string>();
  let stopping = false;
  let claiming: Promise<void> | null = null;
  let lastRecovery = 0;
  const tick = async () => {
    try {
      if (Date.now() - lastRecovery >= 1000) {
        await failStaleAssistantJobs();
        await flushAssistantAwayNotices();
        lastRecovery = Date.now();
      }
      while (!stopping && active.size < ASSISTANT_RUNTIME_CAPACITY[lane]) {
        // Each attempt gets a new token, even when this process recovers its own job.
        const owner = `${claimedBy}-${randomUUID()}`;
        const job = await claimAssistantJob(owner, lane);
        if (!job) break;
        const work = (async () => {
          const checkpoint = assistantRunStateFor(job.run_state);
          const user = (
            await pool.query<UserRow>(
              "SELECT * FROM users WHERE id = $1 AND NOT disabled",
              [job.user_id],
            )
          ).rows[0];
          if (!checkpoint || !user) {
            await pool.query(
              `UPDATE ai_jobs SET state = 'failed', error_status = 409,
               error_message = 'This request can no longer be continued.'
               WHERE id = $1 AND claimed_by = $2`,
              [job.id, owner],
            );
            return;
          }
          await withAssistantLease(job.id, owner, () =>
            runAssistantJob(
              job.id,
              user,
              checkpoint.request,
              undefined,
              checkpoint,
              log,
            ),
          );
        })().catch((error) => {
          log.error(
            { err: error, job_id: job.id },
            "Assistant runner could not complete a job",
          );
        });
        active.add(work);
        jobs.set(work, job.id);
        void work.finally(() => {
          active.delete(work);
          jobs.delete(work);
          schedule();
        });
      }
      if (!stopping) await options.onTick?.();
    } catch (error) {
      log.warn({ err: error }, "Assistant queue could not be claimed");
    }
  };
  const schedule = () => {
    if (stopping || claiming) return;
    claiming = tick().finally(() => {
      claiming = null;
    });
  };
  const timer = setInterval(schedule, 200);
  timer.unref();
  schedule();
  let stop: Promise<void> | null = null;
  return () =>
    (stop ??= (async () => {
      stopping = true;
      clearInterval(timer);
      await claiming;
      for (const id of jobs.values()) requestAssistantJobShutdown(id);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...active]),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, options.shutdownMs ?? 20_000);
        }),
      ]);
      clearTimeout(timeout);
      for (const id of jobs.values()) requestAssistantJobShutdown(id, true);
      await Promise.allSettled([...active]);
      releaseRuntime();
    })());
}
