import { z } from "zod";
import { clockMinutes, zonedParts } from "./time.js";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const reminderNudgeSettingsInput = z
  .object({
    enabled: z.boolean(),
    chat: z.boolean(),
    push: z.boolean(),
    /** Email is used only for overdue work and underbooked deadlines. */
    email: z.boolean(),
    quiet_start: clock,
    quiet_end: clock,
  })
  .strict();
export type ReminderNudgeSettings = z.output<typeof reminderNudgeSettingsInput>;
export const DEFAULT_REMINDER_NUDGES: ReminderNudgeSettings = {
  enabled: true,
  chat: true,
  push: true,
  email: true,
  quiet_start: "22:00",
  quiet_end: "08:00",
};
export const reminderNudgeCard = z
  .object({
    id: z.uuid(),
    key: z.string().min(1).max(180),
    entity_kind: z.enum(["task", "record", "routine", "habit", "job", "goal"]),
    entity_id: z.uuid(),
    actions: z.array(z.enum(["done", "move", "skip", "book"])).max(4),
  })
  .strict();
export type ReminderNudgeCard = z.output<typeof reminderNudgeCard>;

/** Quiet windows use local clock time, including the repeated hour at DST end. */
export function reminderNudgesQuiet(
  now: Date,
  timezone: string,
  prefs: ReminderNudgeSettings,
): boolean {
  const parts = zonedParts(now, timezone);
  const current = parts.hour * 60 + parts.minute;
  const start = clockMinutes(prefs.quiet_start);
  const end = clockMinutes(prefs.quiet_end);
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

/** The final per-person gate, checked again under the worker's claim lock. */
export function canSendReminderNudge(
  now: Date,
  timezone: string,
  prefs: ReminderNudgeSettings,
  history: { sent_today: number; last_sent_at: Date | null; stopped: boolean },
): boolean {
  return (
    prefs.enabled &&
    (prefs.chat || prefs.push || prefs.email) &&
    !history.stopped &&
    history.sent_today < 3 &&
    !reminderNudgesQuiet(now, timezone, prefs) &&
    (!history.last_sent_at ||
      now.getTime() - history.last_sent_at.getTime() >= 86400000)
  );
}
