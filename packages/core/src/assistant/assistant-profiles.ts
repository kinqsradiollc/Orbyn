import { z } from "zod";
import { automationAgentIdentity, nightShiftInput } from "./agent-settings.js";
import { assistantActivityEvent } from "./assistant-activity.js";
export const assistantProfileCounts = z
  .object({
    working: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    recovering: z.number().int().nonnegative(),
  })
  .strict();
export type AssistantProfileCounts = z.output<typeof assistantProfileCounts>;
/** A schedule or connected device is not evidence of executing work. */
export function assistantProfileState(
  counts: AssistantProfileCounts,
  scheduled = false,
) {
  if (counts.working > 0) return "working" as const;
  if (counts.waiting > 0) return "waiting" as const;
  if (counts.queued > 0 || counts.recovering > 0) return "queued" as const;
  return scheduled ? ("scheduled" as const) : ("idle" as const);
}
export const assistantProfile = z
  .object({
    lane: z.enum(["background", "overnight"]),
    identity: automationAgentIdentity.optional(),
    state: z.enum(["idle", "queued", "working", "waiting", "scheduled"]),
    runtime: z
      .object({
        reporting: z.boolean(),
        last_seen_at: z.iso.datetime().nullable(),
      })
      .strict(),
    counts: assistantProfileCounts,
    last_activity_at: z.iso.datetime().nullable(),
    recent_activity: z.array(assistantActivityEvent).max(8),
    outputs: z
      .array(
        z
          .object({
            job_id: z.uuid(),
            chat_id: z.uuid(),
            title: z.string().max(120),
            completed_at: z.iso.datetime(),
            handoff: z
              .object({
                id: z.uuid(),
                status: z.enum([
                  "proposed",
                  "accepted",
                  "completed",
                  "failed",
                  "cancelled",
                ]),
                recipient_chat_id: z.uuid().nullable(),
              })
              .strict()
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .max(5),
    window: z
      .object({
        enabled: z.boolean(),
        start: nightShiftInput.shape.start,
        end: nightShiftInput.shape.end,
        timezone: nightShiftInput.shape.timezone,
        in_window: z.boolean(),
        next_start_at: z.iso.datetime().nullable(),
      })
      .strict()
      .nullable(),
    budget: z
      .object({
        limit_tokens: z.number().int().nonnegative(),
        estimated_tokens: z.number().int().nonnegative(),
        local_day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.identity && profile.identity.lane !== profile.lane)
      ctx.addIssue({
        code: "custom",
        path: ["identity", "lane"],
        message: "Identity belongs to this runtime lane.",
      });
    const scheduled =
      profile.lane === "overnight" &&
      !!profile.window?.enabled &&
      !profile.window.in_window &&
      profile.window.next_start_at !== null;
    if (profile.state !== assistantProfileState(profile.counts, scheduled))
      ctx.addIssue({
        code: "custom",
        path: ["state"],
        message: "Profile state must match execution evidence.",
      });
    if (
      profile.lane === "background" &&
      (profile.window !== null || profile.budget !== null)
    )
      ctx.addIssue({
        code: "custom",
        path: ["lane"],
        message: "Night settings belong to Overnight.",
      });
  });
export type AssistantProfile = z.output<typeof assistantProfile>;
export const assistantProfiles = z
  .object({
    observed_at: z.iso.datetime(),
    profiles: z.tuple([assistantProfile, assistantProfile]),
  })
  .strict()
  .refine(
    (page) =>
      page.profiles[0].lane === "background" &&
      page.profiles[1].lane === "overnight",
    "Each runtime needs a separate profile.",
  );
export type AssistantProfiles = z.output<typeof assistantProfiles>;

export type AssistantReviewRow = {
  id: string;
  lane: AssistantProfile["lane"];
  title: string;
  detail: string;
  action: string;
  priority: number;
  at?: string;
  chatId?: string;
};

/** Profile output identity supports chat grouping, not goal/routine acceptance. */
export function recentAssistantWork(
  data: AssistantProfiles,
): AssistantReviewRow[] {
  const rows: AssistantReviewRow[] = [];
  for (const profile of data.profiles) {
    const lane = profile.lane;
    const name = lane === "background" ? "Background" : "Overnight";
    if (profile.counts.waiting > 0)
      rows.push({
        id: `${lane}:waiting`,
        lane,
        priority: 0,
        title: `${name} · Waiting for you`,
        detail: `${profile.counts.waiting} ${profile.counts.waiting === 1 ? "run needs" : "runs need"} a decision.`,
        action: "Review decisions",
      });
    // Event receipts are historical; only the latest observed event per job is considered.
    const latest = new Map<
      string,
      AssistantProfiles["profiles"][number]["recent_activity"][number]
    >();
    for (const event of profile.recent_activity) {
      const key = event.job_id ?? `event:${event.sequence}`;
      const previous = latest.get(key);
      if (!previous || BigInt(event.sequence) > BigInt(previous.sequence))
        latest.set(key, event);
    }
    const finishedJobs = new Set(
      profile.outputs.map((output) => output.job_id),
    );
    for (const event of latest.values()) {
      if (
        event.kind !== "failed" ||
        (event.job_id && finishedJobs.has(event.job_id))
      )
        continue;
      rows.push({
        id: `${lane}:failure:${event.job_id ?? event.sequence}`,
        lane,
        priority: 1,
        title: `${name} · Failure reported`,
        detail: "Open activity to check the result and recovery.",
        at: event.created_at,
        action: "Review activity",
      });
    }
    if (profile.counts.recovering > 0)
      rows.push({
        id: `${lane}:recovering`,
        lane,
        priority: 2,
        title: `${name} · Recovery pending`,
        detail: `${profile.counts.recovering} ${profile.counts.recovering === 1 ? "run awaits" : "runs await"} recovery.`,
        action: "View activity",
      });
    if (profile.counts.working > 0)
      rows.push({
        id: `${lane}:working`,
        lane,
        priority: 3,
        title: `${name} · In progress`,
        detail: `${profile.counts.working} ${profile.counts.working === 1 ? "run" : "runs"}${profile.runtime.reporting ? " working." : " recorded; worker heartbeat unavailable."}`,
        action: "View activity",
      });
    const chats = new Map<
      string,
      { latest: (typeof profile.outputs)[number]; count: number }
    >();
    for (const output of profile.outputs) {
      const group = chats.get(output.chat_id);
      chats.set(output.chat_id, {
        latest:
          !group || output.completed_at > group.latest.completed_at
            ? output
            : group.latest,
        count: (group?.count ?? 0) + 1,
      });
    }
    for (const [chatId, group] of chats)
      rows.push({
        id: `${lane}:chat:${chatId}`,
        lane,
        priority: 4,
        title: group.latest.title || `${name} result`,
        detail: `${name} · ${group.count === 1 ? "Run finished" : `${group.count} recent runs finished`} · Review outcome`,
        at: group.latest.completed_at,
        chatId,
        action: "Review result",
      });
    if (profile.counts.queued > 0)
      rows.push({
        id: `${lane}:queued`,
        lane,
        priority: 5,
        title: `${name} · Queued`,
        detail: `${profile.counts.queued} ${profile.counts.queued === 1 ? "run" : "runs"} waiting to start.`,
        action: "View activity",
      });
  }
  return rows.sort(
    (a, b) =>
      a.priority - b.priority ||
      (b.at ?? "").localeCompare(a.at ?? "") ||
      a.id.localeCompare(b.id),
  );
}
