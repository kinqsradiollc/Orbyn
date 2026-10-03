import { assistantRuntimeHasRoom } from "./runtime-slots.js";
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
    if (!(await assistantRuntimeHasRoom(db, lane))) return null;
    const row = (
      await db.query<{ id: string; user_id: string; run_state: unknown }>(
        `WITH candidate AS (
         SELECT candidate.id FROM ai_jobs candidate
         WHERE candidate.state = 'queued' AND candidate.runtime_lane = $2 AND candidate.run_state->>'version' = '1'
           AND candidate.run_state->'request' IS NOT NULL
           AND (candidate.runtime_lane<>'overnight' OR NOT EXISTS (
             SELECT 1 FROM assistant_page_runs busy WHERE busy.user_id=candidate.user_id
               AND busy.lane='overnight' AND busy.state='running' AND busy.lease_expires_at>now()))
           AND (candidate.work_source_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM ai_jobs busy WHERE busy.id<>candidate.id
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

/** A leased scoped job managed by the same lane consumer and shutdown lifecycle. */
export type ScopedAssistantWork = {
  run: () => Promise<void>;
  stop: () => void;
};

/** A bounded consumer for one runtime lane, shared only by its own replicas. */
export function startAssistantRunner(
  log: FastifyBaseLogger,
  options: {
    shutdownMs?: number;
    lane?: AssistantRuntimeLane;
    onTick?: () => Promise<void>;
    claimScopedWork?: () => Promise<ScopedAssistantWork | null>;
  } = {},
) {
  const lane = options.lane ?? "interactive";
  if (lane === "interactive" && options.claimScopedWork)
    throw new Error("Scoped automation cannot run in the interactive runtime.");
  const releaseRuntime = acquireAssistantRuntime(lane);
  const claimedBy = `${lane}-${process.pid}-${randomUUID()}`;
  const active = new Set<Promise<void>>();
  const jobs = new Map<Promise<void>, string>();
  const scopedStops = new Map<Promise<void>, () => void>();
  let preferScoped = false;
  const startScoped = (scoped: ScopedAssistantWork) => {
    const work = Promise.resolve()
      .then(scoped.run)
      .catch(() => {
        log.warn("Scoped assistant work could not finish");
      });
    active.add(work);
    scopedStops.set(work, scoped.stop);
    void work.finally(() => {
      active.delete(work);
      scopedStops.delete(work);
      schedule();
    });
    preferScoped = false;
  };
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
        if (preferScoped && options.claimScopedWork) {
          const scoped = await options.claimScopedWork();
          if (scoped) {
            startScoped(scoped);
            continue;
          }
        }
        // Each attempt gets a new token, even when this process recovers its own job.
        const owner = `${claimedBy}-${randomUUID()}`;
        const job = await claimAssistantJob(owner, lane);
        if (!job) {
          const scoped = await options.claimScopedWork?.();
          if (!scoped) break;
          startScoped(scoped);
          continue;
        }
        preferScoped = true;
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
      for (const stopScoped of scopedStops.values()) stopScoped();
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
