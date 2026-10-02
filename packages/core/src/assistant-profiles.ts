import { z } from "zod";
import { nightShiftInput } from "./agent-settings.js";
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
    state: z.enum(["idle", "queued", "working", "waiting", "scheduled"]),
    counts: assistantProfileCounts,
    last_activity_at: z.iso.datetime().nullable(),
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
