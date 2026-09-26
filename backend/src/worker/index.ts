import { runDueTemplates } from "../modules/templates/routes.js";
import { settings } from "../lib/settings.js";
import { closeDatabase, pool } from "../db/pool.js";
import { runSweep } from "../lib/sweep.js";
import { closeEmail } from "./channels/email.js";
import { deliverOne } from "./delivery.js";
import { enqueue } from "./scheduler.js";
import { measureQueued } from "../modules/search/semantic.js";
import {
  advanceRepeating,
  remindSubscribed,
  scanConflicts,
  scanPlanningNotices,
  scanProjectPlanningNotices,
  scanProjectDeadlineMoves,
  scanTaskDeadlineMoves,
} from "./planning.js";
import { deliverWebhookOne } from "./webhooks.js";
import { scanDigests } from "./digest.js";
import { scanBlocksStarted, scanEventStarting } from "./webhookEvents.js";
import { refreshDueSubscriptions } from "../modules/planner/subscriptions.js";
import { scanMorningAgendas } from "./agenda.js";

/** Planner upkeep runs at most this often. */
const PLANNING_MS = 60_000;
/** Roll-forward, at-risk and due-soon notices: each at most once a day, checked this often. */
const NOTICES_MS = 15 * 60_000;

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
/** How often pages waiting to be measured are looked at. */
const MEASURE_MS = 60_000;
/** How often the sweeper clears expired and outdated records (lib/sweep.ts). */
const SWEEP_MS = 3_600_000;

export async function runWorker() {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
    });
  let lastSchedule = 0;
  let lastPlanning = 0;
  let lastNotices = 0;
  let lastMeasured = 0;
  let lastSwept = 0;
  while (!stopping) {
    let backlog = false;
    try {
      if (Date.now() - lastSchedule >= CYCLE_MS) {
        await heartbeat();
        // Repeating events move on first, so their next reminder queues now.
        if (Date.now() - lastPlanning >= PLANNING_MS) {
          await advanceRepeating();
          await scanConflicts();
          // Scheduled webhook events: event.starting and block.started.
          await scanEventStarting();
          await scanBlocksStarted();
          lastPlanning = Date.now();
        }
        if (Date.now() - lastNotices >= NOTICES_MS) {
          await scanPlanningNotices();
          await scanProjectDeadlineMoves();
          await scanTaskDeadlineMoves();
          await scanProjectPlanningNotices();
          await scanDigests();
          // Today's agenda, written each morning with the assistant's summary.
          await scanMorningAgendas();
          // Templates with a rhythm: say when one is ready to start.
          await runDueTemplates();
          lastNotices = Date.now();
        }
        // Pages waiting to be measured for semantic search. Does nothing at
        // all where the extension is missing or the setting is off, which is
        // the usual case, so this costs a single cheap query.
        if (Date.now() - lastMeasured >= MEASURE_MS) {
          try {
            await measureQueued();
          } catch {
            // Measuring is a bonus; failing it must not stall reminders.
          }
          lastMeasured = Date.now();
        }
        if (Date.now() - lastSwept >= SWEEP_MS) {
          try {
            await runSweep();
          } catch {
            // Housekeeping: a failed sweep waits for the next hour.
          }
          lastSwept = Date.now();
        }
        // Subscribed calendars: new ones within a cycle, the rest hourly,
        // and reminders for the ones that ask for them.
        await refreshDueSubscriptions(10);
        await remindSubscribed();
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
