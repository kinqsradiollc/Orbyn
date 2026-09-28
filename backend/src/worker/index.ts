import { runDueTemplates } from "../modules/templates/service.js";
import { settings } from "../lib/settings.js";
import { closeDatabase, pool } from "../db/pool.js";
import { runSweep } from "../lib/sweep.js";
import { CLOCK_CHECK_MS, checkServerClock } from "../lib/clock.js";
import { closeEmail } from "./channels/email.js";
import { deliverOne } from "./delivery.js";
import { enqueue } from "./scheduler.js";
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
import { drainStudyQueue } from "../modules/study/service.js";
import { scanAgentStudy } from "../modules/agent-inbox/scan.js";
import { expireQuestions } from "../modules/agent-inbox/questions.js";
import { deliverWakes } from "../modules/agent-inbox/wake.js";
import { scanAgentJobs } from "./agent-jobs.js";
import { drainMemoryQueue } from "./memory.js";
import { sweepOldChats } from "./chat-sweep.js";

/** Planner upkeep runs at most this often. */
const PLANNING_MS = 60_000;
/** Roll-forward, at-risk and due-soon notices: each at most once a day, checked this often. */
const NOTICES_MS = 15 * 60_000;

const CYCLE_MS = 10000;
/** Deliveries per lane before the loop checks for new work again. */
const LANE_BATCH = 100;
/** Retry a failed chat compaction pass without waiting a full day. */
const CHAT_SWEEP_RETRY_MS = 15 * 60_000;

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
/** How often the sweeper clears expired and outdated records (lib/sweep.ts). */
const SWEEP_MS = 3_600_000;
/** Compact stale chats once a day; the ordinary record sweeper remains hourly. */
const CHAT_SWEEP_MS = 86_400_000;

export async function runWorker() {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
    });
  // Timed on the monotonic clock: when the wall clock is set right (by
  // hours, say), the loop's own rhythm doesn't stall or rush with it.
  const tick = () => performance.now();
  let lastSchedule = -Infinity;
  let lastPlanning = -Infinity;
  let lastNotices = -Infinity;
  let lastSwept = -Infinity;
  let lastChatSwept = -Infinity;
  let lastClock = -Infinity;
  while (!stopping) {
    let backlog = false;
    try {
      if (tick() - lastSchedule >= CYCLE_MS) {
        await heartbeat();
        // Repeating events move on first, so their next reminder queues now.
        if (tick() - lastPlanning >= PLANNING_MS) {
          await advanceRepeating();
          await scanConflicts();
          // Scheduled webhook events: event.starting and block.started.
          await scanEventStarting();
          await scanBlocksStarted();
          lastPlanning = tick();
        }
        if (tick() - lastNotices >= NOTICES_MS) {
          await scanPlanningNotices();
          await scanProjectDeadlineMoves();
          await scanTaskDeadlineMoves();
          await scanProjectPlanningNotices();
          await scanDigests();
          // Today's agenda, written each morning with the assistant's summary.
          await scanMorningAgendas();
          // Templates with a rhythm: say when one is ready to start.
          await runDueTemplates();
          // Agents' inboxes: cards due and exams close (H0).
          await scanAgentStudy();
          lastNotices = tick();
        }
        // Pages for search by meaning are measured by their own service
        // (services/measure.ts), never in this loop.
        // The server's own clock against outside time (lib/clock.ts): a
        // clock hours out makes every "today" and reminder wrong.
        if (tick() - lastClock >= CLOCK_CHECK_MS) {
          try {
            await checkServerClock();
          } catch {
            // Nothing learnt: the next check tries again.
          }
          lastClock = tick();
        }
        if (tick() - lastSwept >= SWEEP_MS) {
          try {
            await runSweep();
          } catch {
            // Housekeeping: a failed sweep waits for the next hour.
          }
          lastSwept = tick();
        }
        if (tick() - lastChatSwept >= CHAT_SWEEP_MS) {
          let failed = false;
          try {
            await sweepOldChats();
          } catch {
            // Retry the pass soon; individual chats also have claim timeouts.
            failed = true;
          }
          lastChatSwept =
            tick() - (failed ? CHAT_SWEEP_MS - CHAT_SWEEP_RETRY_MS : 0);
        }
        // Study cards for pages changed outside the API's own saves (imports,
        // templates, the assistant, team changes): the API syncs what it
        // saves at once, and this takes whatever is left.
        try {
          await drainStudyQueue();
        } catch {
          // Left in the queue for the next cycle.
        }
        // Finished assistant turns are learned from off the request path.
        try {
          await drainMemoryQueue();
        } catch {
          // Left in the queue for the next cycle.
        }
        // Subscribed calendars: new ones within a cycle, the rest hourly,
        // and reminders for the ones that ask for them.
        await refreshDueSubscriptions(10);
        await remindSubscribed();
        await enqueue();
        // Agents' questions whose time ran out, and wake-up calls that are
        // due (H0): each agent hears within a cycle.
        await expireQuestions();
        await deliverWakes();
        // A push when an agent finished a job of over 20 changes (H7).
        try {
          await scanAgentJobs();
        } catch {
          // Its changes stay unreported: the next cycle looks again.
        }
        lastSchedule = tick();
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
