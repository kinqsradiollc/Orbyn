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
import { failStaleAssistantJobs } from "../modules/ai/agent/run.js";
import { drainMemoryQueue } from "./memory.js";
import { sweepOldChats } from "./chat-sweep.js";
import { scanAssistantIdeas } from "./assistant-ideas.js";
import { scanAssistantGoals } from "./assistant-goals.js";
import { scanAssistantRoutines } from "./assistant-routines.js";
import { scanAssistantTasks } from "./assistant-tasks.js";
import { scanNightShift } from "./night-shift.js";
import { scanReminderNudges } from "./reminder-nudges.js";
import { env } from "../config/env.js";
import { startAssistantRunner } from "../modules/ai/agent/runner.js";
import type { FastifyBaseLogger } from "fastify";

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
/** How often the sweeper clears expired and outdated records (lib/sweep.ts). */
const SWEEP_MS = 3_600_000;
/** Compact chats unused for a week, hourly, in a lane of its own. */
const CHAT_SWEEP_MS = 3_600_000;
/** Daily Assistant ideas are queued away from request paths. */
const ASSISTANT_IDEAS_MS = 60_000;
/** Stuck assistant runs are looked for at most this often. */
const STALE_JOBS_MS = 60_000;
/** Weekly goal check-ins are queued off the request path. */
const ASSISTANT_GOALS_MS = 60_000;
/** Scheduled Assistant routines are claimed off the request path. */
const ASSISTANT_ROUTINES_MS = 60_000;
/** Tasks handed to a person's agent (W3) are started off the request path. */
const ASSISTANT_TASKS_MS = 30_000;

/** The chat sweep in flight, if any: it runs beside the loop, never twice at once. */
let chatSweep: Promise<void> | null = null;

/**
 * Start the chat sweep without waiting for it: it may take minutes (one
 * provider call per chat, within its time budget) and must not hold up
 * reminders. Does nothing while a sweep is still running.
 */
function startChatSweep() {
  if (chatSweep) return;
  chatSweep = sweepOldChats()
    .then(() => undefined)
    .catch((error) => {
      // Chats that failed are tried again next hour.
      console.error(
        "Chat sweep failed",
        error instanceof Error ? error.message : "unknown",
      );
    })
    .finally(() => {
      chatSweep = null;
    });
}

export async function runWorker() {
  const stopRunner =
    env.AI_RUNNER_IN_WORKER === "true"
      ? startAssistantRunner(console as unknown as FastifyBaseLogger)
      : undefined;
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
      void stopRunner?.().catch((error) => {
        console.error(
          "Assistant runner shutdown failed",
          error instanceof Error ? error.message : "unknown",
        );
      });
    });
  // Timed on the monotonic clock: when the wall clock is set right (by
  // hours, say), the loop's own rhythm doesn't stall or rush with it.
  const tick = () => performance.now();
  let lastSchedule = -Infinity;
  let lastPlanning = -Infinity;
  let lastNotices = -Infinity;
  let lastSwept = -Infinity;
  let lastChatSwept = -Infinity;
  let lastAssistantIdeas = -Infinity;
  let lastStaleJobs = -Infinity;
  let lastAssistantGoals = -Infinity;
  let lastAssistantRoutines = -Infinity;
  let lastAssistantTasks = -Infinity;
  let lastNightShift = -Infinity;
  let lastReminderNudges = -Infinity;
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
        if (!chatSweep && tick() - lastChatSwept >= CHAT_SWEEP_MS) {
          startChatSweep();
          lastChatSwept = tick();
        }
        // Assistant runs whose server stopped mid-way, and questions left
        // unanswered for a week, end here (their automation links cleared).
        if (tick() - lastStaleJobs >= STALE_JOBS_MS) {
          try {
            await failStaleAssistantJobs(new Date());
          } catch {
            // Tried again next minute.
          }
          lastStaleJobs = tick();
        }
        if (tick() - lastAssistantIdeas >= ASSISTANT_IDEAS_MS) {
          try {
            await scanAssistantIdeas();
          } catch {
            // An idea day remains eligible after its claim timeout.
          }
          lastAssistantIdeas = tick();
        }
        if (tick() - lastNightShift >= 60_000) {
          try {
            await scanNightShift();
          } catch {
            // The night claim and queue roll back together; a later scan retries.
          }
          lastNightShift = tick();
        }
        if (tick() - lastReminderNudges >= 15 * 60_000) {
          try {
            await scanReminderNudges();
          } catch {
            /* Each send commits its message and frequency reservation together. */
          }
          lastReminderNudges = tick();
        }
        if (tick() - lastAssistantGoals >= ASSISTANT_GOALS_MS) {
          try {
            await scanAssistantGoals();
          } catch {
            // A failed weekly check-in stays eligible after its claim timeout.
          }
          lastAssistantGoals = tick();
        }
        if (tick() - lastAssistantRoutines >= ASSISTANT_ROUTINES_MS) {
          try {
            await scanAssistantRoutines();
          } catch {
            // A due routine remains eligible after its claim timeout.
          }
          lastAssistantRoutines = tick();
        }
        if (tick() - lastAssistantTasks >= ASSISTANT_TASKS_MS) {
          try {
            await scanAssistantTasks();
          } catch {
            // A handed task stays eligible after its claim timeout.
          }
          lastAssistantTasks = tick();
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
  // A chat sweep still in flight is abandoned: its claims expire and the
  // next run takes those chats again.
  await stopRunner?.();
  await closeDatabase();
  closeEmail();
}
