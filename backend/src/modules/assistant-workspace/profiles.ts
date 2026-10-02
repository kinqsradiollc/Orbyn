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
  type AssistantProfileCounts,
  type NightShiftSettings,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { readTransaction, type Queryable } from "../../db/pool.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { firstParty } from "../proposals/service.js";
import { assistantNightWindow } from "../../worker/night-window.js";
import { assistantLastActivity } from "./activity.js";

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
) {
  const row = (
    await db.query<{
      night_shift: unknown;
      work_start: string | null;
      work_end: string | null;
      timezone: string | null;
      observed_at: Date;
    }>(
      `SELECT a.night_shift,p.work_start::text,p.work_end::text,p.timezone,current_timestamp AS observed_at
    FROM users u LEFT JOIN agent_settings a ON a.user_id=u.id LEFT JOIN planner_prefs p ON p.user_id=u.id
    WHERE u.id=$1 AND NOT u.disabled`,
      [owner],
    )
  ).rows[0];
  if (!row) fail(404, "That assistant profile is not here.");
  const observed = now ?? row.observed_at;
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
    const counts = (
      await db.query<AssistantProfileCounts>(
        `SELECT count(*) FILTER(WHERE j.state='running' AND j.lease_until>$2)::int AS working,
       count(*) FILTER(WHERE j.state='waiting')::int AS waiting,count(*) FILTER(WHERE j.state='queued')::int AS queued,
       count(*) FILTER(WHERE j.state='running' AND (j.lease_until IS NULL OR j.lease_until<=$2))::int AS recovering
       FROM ai_jobs j LEFT JOIN ai_chats c ON c.id=j.chat_id
       WHERE j.user_id=$1 AND j.runtime_lane=$3 AND j.state IN ('queued','running','waiting')
       AND ${assistantChatVisible("c", "$1")} AND ${assistantJobSourcesVisible("j", "$1", false)}`,
        [owner, observed, lane],
      )
    ).rows[0];
    const lastActivity = await assistantLastActivity(db, owner, lane);
    profiles.push({
      lane,
      counts,
      state: assistantProfileState(
        counts,
        lane === "overnight" &&
          window.enabled &&
          !window.in_window &&
          window.next_start_at !== null,
      ),
      last_activity_at: lastActivity,
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
          return readAssistantProfiles(db, user.id);
        },
        { primary: true },
      );
    },
  );
}
