import { settings } from "../lib/settings.js";
import { closeDatabase, pool } from "../db/pool.js";
import { closeEmail } from "./channels/email.js";
import { deliverOne } from "./delivery.js";
import { enqueue } from "./scheduler.js";
import { advanceRepeating, scanConflicts } from "./planning.js";
import { deliverWebhookOne } from "./webhooks.js";

/** Planner upkeep runs at most this often. */
const PLANNING_MS = 60_000;

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
  let lastPlanning = 0;
  while (!stopping) {
    let backlog = false;
    try {
      if (Date.now() - lastSchedule >= CYCLE_MS) {
        await heartbeat();
        // Repeating events move on first, so their next reminder queues now.
        if (Date.now() - lastPlanning >= PLANNING_MS) {
          await advanceRepeating();
          await scanConflicts();
          lastPlanning = Date.now();
        }
        await enqueue();
        lastSchedule = Date.now();
      }
      // Each lane delivers reminders and webhooks until both queues are empty.
      const lanes = await Promise.all(
        Array.from(
          { length: (await settings()).notifier_concurrency },
          async () => {
            for (let n = 0; n < LANE_BATCH && !stopping; n++) {
              const reminder = await deliverOne();
              const webhook = await deliverWebhookOne();
              if (!reminder && !webhook) return false;
            }
            return true;
          },
        ),
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
