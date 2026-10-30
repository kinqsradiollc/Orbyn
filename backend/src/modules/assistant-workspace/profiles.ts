import { readAssistantPageReview } from "./page-review.js";
import { readAssistantReviewOrigins } from "./review-origins.js";
import { projectOutcomeReceipt } from "./outcome-receipts.js";
import {
  assistantProfiles,
  assistantProfileState,
  defaultNightShift,
  nightShiftInput,
  localDateKey,
  addDays,
  zonedInstant,
  fail,
  type AssistantProfile,
  type NightShiftSettings,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { readTransaction, type Queryable } from "../../db/pool.js";
import { firstParty } from "../proposals/service.js";
import { readAutomationIdentity } from "../agent-context/identities.js";
import { assistantNightWindow } from "../../worker/night-window.js";
import { readAssistantProfileEvidence } from "./profile-evidence.js";

/** Scheduler timezone/DST semantics; a permitted window is not working status. */
export function assistantProfileWindow(
  now: Date,
  settings: NightShiftSettings,
): NonNullable<AssistantProfile["window"]> {
  const enabled = settings.enabled;
  const inWindow = enabled && assistantNightWindow(now, settings) !== null;
  let next: Date | null = null;
  if (enabled && Object.values(settings.kinds).some(Boolean)) {
    const today = localDateKey(now, settings.timezone);
    const [hour, minute] = settings.start.split(":").map(Number);
    for (const offset of [0, 1, 2]) {
      const [year, month, day] = addDays(today, offset).split("-").map(Number);
      const candidate = zonedInstant(
        year,
        month,
        day,
        hour,
        minute,
        settings.timezone,
      );
      if (candidate > now) {
        next = candidate;
        break;
      }
    }
  }
  return {
    enabled,
    start: settings.start,
    end: settings.end,
    timezone: settings.timezone,
    in_window: inWindow,
    next_start_at: next?.toISOString() ?? null,
  };
}

/** Source-authorized runtime evidence; leases describe execution, never presence. */
export async function readAssistantProfiles(
  db: Queryable,
  owner: string,
  now?: Date,
  includeOutcomes = false,
  includeOrigins = false,
) {
  const row = (
    await db.query<{
      night_shift: unknown;
      work_start: string | null;
      work_end: string | null;
      timezone: string | null;
      observed_at: string;
    }>(
      `SELECT a.night_shift,p.work_start::text,p.work_end::text,p.timezone,current_timestamp::text AS observed_at
    FROM users u LEFT JOIN agent_settings a ON a.user_id=u.id LEFT JOIN planner_prefs p ON p.user_id=u.id
    WHERE u.id=$1 AND NOT u.disabled`,
      [owner],
    )
  ).rows[0];
  if (!row) fail(404, "That assistant profile is not here.");
  // Preserve database microseconds for SQL comparisons; Date is only for UI/calendar work.
  const observedAt = now?.toISOString() ?? row.observed_at;
  const observed = now ?? new Date(row.observed_at);
  const parsed = nightShiftInput.safeParse(row.night_shift);
  const settings = parsed.success
    ? parsed.data
    : defaultNightShift({
        work_start: row.work_start ?? undefined,
        work_end: row.work_end ?? undefined,
        timezone: row.timezone ?? undefined,
      });
  const window = assistantProfileWindow(observed, settings);
  const currentWindow = assistantNightWindow(observed, settings);
  const budget = (
    await db.query<{
      limit_tokens: number;
      estimated_tokens: number;
      local_day: string | null;
    }>(
      `SELECT s.night_token_budget AS limit_tokens,coalesce(n.budget_used,0) AS estimated_tokens,n.local_day::text
     FROM ai_settings s LEFT JOIN LATERAL (
       SELECT local_day,budget_used FROM assistant_nights WHERE user_id=$1
       AND ($2::date IS NULL OR local_day=$2::date) ORDER BY local_day DESC LIMIT 1
     ) n ON true WHERE s.id`,
      [owner, currentWindow?.localDay ?? null],
    )
  ).rows[0];
  const profiles: AssistantProfile[] = [];
  for (const lane of ["background", "overnight"] as const) {
    const heartbeat = (
      await db.query<{ last_seen_at: Date | null; reporting: boolean }>(
        `SELECT last_seen_at,last_seen_at BETWEEN $2::timestamptz - interval '30 seconds' AND $2::timestamptz AS reporting
         FROM service_heartbeats WHERE service=$1`,
        [`assistant-${lane}`, observedAt],
      )
    ).rows[0];
    const { counts, work, outputs, lastActivity, recentActivity } =
      await readAssistantProfileEvidence(
        db,
        owner,
        observedAt,
        lane,
        includeOutcomes,
        includeOrigins,
      );
    const pageReview =
      includeOutcomes && includeOrigins
        ? await readAssistantPageReview(db, owner, lane, observed)
        : null;
    if (pageReview) {
      counts.working += pageReview.counts.working;
      counts.waiting += pageReview.counts.waiting;
      counts.queued += pageReview.counts.queued;
      counts.recovering += pageReview.counts.recovering;
    }
    const origins =
      includeOutcomes && includeOrigins
        ? await readAssistantReviewOrigins(db, owner, [
            ...work.map((row) => row.job_id),
            ...outputs.map((row) => row.job_id),
          ])
        : null;
    profiles.push({
      lane,
      identity: await readAutomationIdentity(db, owner, lane),
      runtime: {
        reporting: heartbeat?.reporting ?? false,
        last_seen_at: heartbeat?.last_seen_at?.toISOString() ?? null,
      },
      counts,
      state: assistantProfileState(
        counts,
        lane === "overnight" &&
          window.enabled &&
          !window.in_window &&
          window.next_start_at !== null,
      ),
      last_activity_at: lastActivity,
      recent_activity: recentActivity,
      ...(includeOutcomes
        ? {
            work: work.map((row) => ({
              ...row,
              updated_at: row.updated_at.toISOString(),
              ...(origins ? { origin: origins.get(row.job_id) ?? null } : {}),
            })),
            work_truncated:
              counts.working +
                counts.waiting +
                counts.queued +
                counts.recovering >
              work.length +
                (pageReview?.runs.filter((run) =>
                  ["queued", "running", "waiting"].includes(run.state),
                ).length ?? 0),
          }
        : {}),
      ...(includeOutcomes && includeOrigins
        ? { outputs_truncated: (outputs[0]?.total_rows ?? 0) > outputs.length }
        : {}),
      ...(pageReview
        ? {
            page_runs: pageReview.runs,
            page_runs_truncated: pageReview.truncated,
          }
        : {}),
      outputs: outputs.map(
        ({
          execution_outcome,
          total_rows,
          goal_acceptance,
          review_status,
          state,
          summary,
          ...output
        }) => {
          const receipt = projectOutcomeReceipt(
            execution_outcome,
            output.job_id,
            review_status,
            goal_acceptance,
          );
          return {
            ...output,
            ...(includeOutcomes ? { state, summary } : {}),
            completed_at: output.completed_at.toISOString(),
            ...(origins
              ? {
                  origin: origins.get(output.job_id) ?? null,
                  review_pending: review_status === "pending",
                }
              : {}),
            ...(includeOutcomes && receipt
              ? { execution_outcome: receipt }
              : {}),
          };
        },
      ),
      window: lane === "overnight" ? window : null,
      budget: lane === "overnight" ? budget : null,
    });
  }
  return assistantProfiles.parse({
    observed_at: observed.toISOString(),
    profiles,
  });
}

/** Private, read-only snapshot shared by the two clients. */
export async function assistantProfileRoutes(app: FastifyInstance) {
  app.get(
    "/me/assistant/profiles",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await firstParty(request);
      if (Object.keys(request.query as object).length)
        fail(400, "This route takes no query parameters.");
      reply.header("Cache-Control", "private, no-store");
      return readTransaction(
        async (db) => {
          await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          return readAssistantProfiles(
            db,
            user.id,
            undefined,
            request.headers["x-orbyn-outcomes"] === "1",
            request.headers["x-orbyn-review-origins"] === "1",
          );
        },
        { primary: true },
      );
    },
  );
}
