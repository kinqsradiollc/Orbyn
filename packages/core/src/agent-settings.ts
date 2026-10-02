import { z } from "zod";
import {
  characterAppearanceInput,
  type CharacterAppearance,
} from "./character.js";

export const agentSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    persona: z.string().trim().max(1000).default(""),
  })
  .strict();

/** First-party appearance edits; MCP identity edits retain their existing scope. */
export const personalAgentSettingsInput = agentSettingsInput.extend({
  character: characterAppearanceInput.optional(),
});
export type AgentIdentityInput = z.input<typeof personalAgentSettingsInput>;
export type PersonalAgentSettings = {
  name: string;
  persona: string;
  character: CharacterAppearance;
  named_at: string | null;
  updated_at: string;
};

/** Ordinary assistant work allowed during the person's night window. */
export const NIGHT_SHIFT_KINDS = [
  "plan",
  "deadlines",
  "study",
  "meetings",
  "tidy",
  "handed",
  "follow_through",
  "reflection",
] as const;
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");
export const nightShiftInput = z
  .object({
    enabled: z.boolean(),
    start: clock,
    end: clock,
    timezone,
    kinds: z
      .object({
        plan: z.boolean(),
        deadlines: z.boolean(),
        study: z.boolean(),
        meetings: z.boolean(),
        tidy: z.boolean(),
        handed: z.boolean(),
        follow_through: z.boolean(),
        reflection: z.boolean().default(false),
      })
      .strict(),
    wait_for_ok: z.boolean(),
  })
  .strict()
  .refine((value) => value.start !== value.end, {
    message: "The night window needs different start and end times.",
    path: ["end"],
  });
export type NightShiftSettings = z.output<typeof nightShiftInput>;

/** Night shift starts off, with every kind selected and morning review on. */
export function defaultNightShift(
  prefs: { work_start?: string; work_end?: string; timezone?: string } = {},
): NightShiftSettings {
  const offset = (value: string, minutes: number) => {
    const [hours, mins] = value.split(":").map(Number);
    const total = (hours * 60 + mins + minutes + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  return {
    enabled: false,
    start: offset(prefs.work_end ?? "17:00", 60),
    end: offset(prefs.work_start ?? "09:00", -60),
    timezone: prefs.timezone ?? "UTC",
    kinds: {
      plan: true,
      deadlines: true,
      study: true,
      meetings: true,
      tidy: true,
      handed: true,
      follow_through: true,
      reflection: true,
    },
    wait_for_ok: true,
  };
}
