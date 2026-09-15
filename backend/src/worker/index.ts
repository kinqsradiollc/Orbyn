import { env } from "../config/env.js";
import { closeDatabase, pool } from "../db/pool.js";
import { closeEmail } from "./channels/email.js";
import { deliverOne } from "./delivery.js";
import { enqueue } from "./scheduler.js";

const CYCLE_MS = 10000;
/** Deliveries per lane before the loop checks for new work again. */
const LANE_BATCH = 100;

/** Liveness for the status page: the reminder service has no HTTP port. */
async function heartbeat() {
  await pool.query(
    "INSERT INTO service_heartbeats(service,last_seen_at) VALUES('notifier',now()) ON CONFLICT (service) DO UPDATE SET last_seen_at=now()",
  );
}

/**
 * Scheduler and delivery loop. Several lanes deliver in parallel; SKIP LOCKED
 * keeps them (and other replicas) from claiming the same reminder. While a
 * backlog remains, the loop runs again at once instead of sleeping; scheduling
 * still happens at most every 10 seconds. Stops cleanly on SIGINT/SIGTERM.
 */
export async function runWorker() {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
    });
  let lastSchedule = 0;
  while (!stopping) {
    let backlog = false;
    try {
      if (Date.now() - lastSchedule >= CYCLE_MS) {
        await heartbeat();
        await enqueue();
        lastSchedule = Date.now();
      }
      const lanes = await Promise.all(
        Array.from({ length: env.NOTIFIER_CONCURRENCY }, async () => {
          for (let n = 0; n < LANE_BATCH && !stopping; n++)
            if (!(await deliverOne())) return false;
          return true;
        }),
      );
      backlog = lanes.some(Boolean);
    } catch (error) {
      console.error(
        "Worker cycle failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
    if (!stopping && !backlog)
      await new Promise((resolve) => setTimeout(resolve, CYCLE_MS));
  }
  await closeDatabase();
  closeEmail();
}
