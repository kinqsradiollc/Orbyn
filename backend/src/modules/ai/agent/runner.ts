import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { withAssistantLease } from "./lease.js";
import { pool } from "../../../db/pool.js";
import type { UserRow } from "../../../lib/auth.js";
import {
  assistantRunStateFor,
  failStaleAssistantJobs,
  runAssistantJob,
  requestAssistantJobShutdown,
} from "./run.js";

/** One claim is atomic across AI replicas; provider calls never hold the DB lock. */
export async function claimAssistantJob(claimedBy: string) {
  const row = (
    await pool.query<{ id: string; user_id: string; run_state: unknown }>(
      `WITH candidate AS (
         SELECT id FROM ai_jobs
         WHERE state = 'queued' AND run_state->>'version' = '1'
           AND run_state->'request' IS NOT NULL
         ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ai_jobs j SET state = 'running', claimed_by = $1,
         lease_until = now() + interval '60 seconds', heartbeat_at = now()
       FROM candidate WHERE j.id = candidate.id
       RETURNING j.id, j.user_id, j.run_state`,
      [claimedBy],
    )
  ).rows[0];
  return row ?? null;
}

/** A bounded runner shared by the AI service and optional worker fallback. */
export function startAssistantRunner(
  log: FastifyBaseLogger,
  options: { shutdownMs?: number } = {},
) {
  const claimedBy = `${process.pid}-${randomUUID()}`;
  const active = new Set<Promise<void>>();
  const jobs = new Map<Promise<void>, string>();
  let stopping = false;
  let claiming: Promise<void> | null = null;
  let lastRecovery = 0;
  const tick = async () => {
    try {
      if (Date.now() - lastRecovery >= 1000) {
        await failStaleAssistantJobs();
        lastRecovery = Date.now();
      }
      while (!stopping && active.size < 8) {
        // Each attempt gets a new token, even when this process recovers its own job.
        const owner = `${claimedBy}-${randomUUID()}`;
        const job = await claimAssistantJob(owner);
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
    })());
}
