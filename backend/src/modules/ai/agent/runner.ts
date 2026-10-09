import { assistantRuntimeHasRoom } from "./runtime-slots.js";
import { reserveAssistantJobWork } from "./work-budget.js";
import { LEAD_TOKEN_BUDGET } from "./lead.js";
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
    const candidate = (
      await db.query<{ id: string; user_id: string; run_state: unknown }>(
        `SELECT candidate.id,candidate.user_id,candidate.run_state FROM ai_jobs candidate
         WHERE candidate.state = 'queued' AND candidate.runtime_lane = $1 AND candidate.run_state->>'version' = '1'
           AND candidate.run_state->'request' IS NOT NULL
           AND ($1='interactive' OR assistant_lane_budget_available(candidate.user_id,$1,clock_timestamp()))
           -- Skip a run whose cumulative allowance is exhausted. Otherwise its
           -- oldest queued row blocks every later owner in this runtime lane.
           AND ($1='interactive' OR greatest(
             CASE WHEN candidate.run_state#>>'{state,token_estimate}' ~ '^[0-9]{1,8}$'
               THEN (candidate.run_state#>>'{state,token_estimate}')::integer ELSE 0 END,
             coalesce((SELECT sum(coalesce(r.reported_tokens,r.reserved_tokens))
               FROM assistant_work_reservations r WHERE r.job_id=candidate.id),0)
           ) < least(
             coalesce((SELECT s.per_run_token_limit FROM assistant_lane_budget_settings s
               WHERE s.user_id=candidate.user_id AND s.lane=$1),200000),
             CASE WHEN candidate.run_state#>>'{request,automation,token_budget}' ~ '^[1-9][0-9]{0,8}$'
               THEN least((candidate.run_state#>>'{request,automation,token_budget}')::integer,$2::integer)
               ELSE $2::integer END
           ))
           AND ($1<>'overnight' OR candidate.run_origin<>'handoff'
             OR assistant_handoff_window_open(candidate.user_id,clock_timestamp()))
           AND (
             candidate.runtime_lane='interactive'
             OR coalesce(candidate.provider_choice_snapshot->>'primary','default')<>'chatgpt'
             OR candidate.provider_choice_snapshot->>'fallback_to_default'='true'
             OR candidate.private_inference_legacy
             OR candidate.cancel_requested
             OR (candidate.runtime_lane='overnight'
               AND coalesce(candidate.run_state->>'reviewed','false')<>'true'
               AND EXISTS(SELECT 1 FROM assistant_nights ended_night
                 WHERE ended_night.id::text=candidate.run_state#>>'{request,automation,night_id}'
                   AND ended_night.user_id=candidate.user_id AND ended_night.status='done'))
             OR EXISTS(SELECT 1 FROM users disabled_owner WHERE disabled_owner.id=candidate.user_id AND disabled_owner.disabled)
             OR NOT EXISTS(SELECT 1 FROM user_ai_provider_choice current_choice
               WHERE current_choice.user_id=candidate.user_id AND current_choice.primary_provider='chatgpt'
                 AND current_choice.version::text=candidate.provider_choice_snapshot->>'version'
                 AND current_choice.connection_id::text=candidate.provider_choice_snapshot->>'connection_id'
                 AND current_choice.executor_id::text=candidate.provider_choice_snapshot->>'executor_id'
                 AND NOT current_choice.fallback_to_default)
             OR EXISTS(SELECT 1 FROM chatgpt_inference_operations operation
               LEFT JOIN chatgpt_inference_requests received ON received.id=operation.request_id
               WHERE operation.job_id=candidate.id AND operation.user_id=candidate.user_id
                 AND (operation.fallback_result_encrypted IS NOT NULL
                   OR (received.state='completed' AND received.result_encrypted IS NOT NULL)))
             OR EXISTS(SELECT 1 FROM chatgpt_executor_enrollments executor
               JOIN chatgpt_identity_connections connection ON connection.id=executor.connection_id
               JOIN chatgpt_executor_leases lease ON lease.executor_id=executor.id
               JOIN sessions session ON session.id=executor.session_id
               JOIN chatgpt_executor_catalogs catalog ON catalog.executor_id=executor.id
               WHERE executor.id::text=candidate.provider_choice_snapshot->>'executor_id'
                 AND connection.id::text=candidate.provider_choice_snapshot->>'connection_id'
                 AND connection.user_id=candidate.user_id AND connection.revoked_at IS NULL
                 AND session.user_id=candidate.user_id AND session.expires_at>clock_timestamp()
                 AND lease.session_id=executor.session_id AND lease.enrollment_epoch=executor.epoch
                 AND lease.expires_at>clock_timestamp() AND catalog.enrollment_epoch=executor.epoch
                 AND catalog.lease_epoch=lease.epoch AND catalog.published_at>clock_timestamp()-interval '5 minutes'
                 AND catalog.capabilities @> '["plan_inference_v1"]'::jsonb)
           )
           AND (candidate.runtime_lane<>'overnight' OR NOT EXISTS (
             SELECT 1 FROM assistant_page_runs busy WHERE busy.user_id=candidate.user_id
               AND busy.lane='overnight' AND busy.state='running' AND busy.lease_expires_at>now()))
           AND (candidate.work_source_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM ai_jobs busy WHERE busy.id<>candidate.id
               AND busy.work_source_kind=candidate.work_source_kind AND busy.work_source_id=candidate.work_source_id
               AND busy.state IN ('running','waiting')))
         ORDER BY candidate.created_at, candidate.id FOR UPDATE OF candidate SKIP LOCKED LIMIT 1`,
        [lane, LEAD_TOKEN_BUDGET],
      )
    ).rows[0];
    if (!candidate) return null;
    const budget =
      lane === "interactive"
        ? null
        : await reserveAssistantJobWork(db, candidate, lane);
    if (lane !== "interactive" && budget === null) return null;
    const row = (
      await db.query<{ id: string; user_id: string; run_state: unknown }>(
        `UPDATE ai_jobs SET state='running',claimed_by=$2,
           lease_until=now()+interval '60 seconds',heartbeat_at=now(),
           run_state=CASE WHEN $3::integer IS NULL THEN run_state ELSE
             jsonb_set(run_state,'{state,token_budget}',to_jsonb($3::integer),true) END
         WHERE id=$1 AND state='queued'
         RETURNING id,user_id,run_state`,
        [candidate.id, claimedBy, budget],
      )
    ).rows[0];
    if (!row)
      throw new Error("The reserved assistant job changed during claim.");
    return row;
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
