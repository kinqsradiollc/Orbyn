import {
  DEFAULT_REMINDER_NUDGES,
  reminderNudgesQuiet,
  type ReminderNudgeSettings,
} from "./reminder-nudges.js";

/**
 * Use the existing notification quiet window, without its reminder-specific
 * enable/channel switches. Walk real instants so skipped/repeated DST hours
 * cannot choose a wall-clock end that is still quiet.
 */
export function nextAssistantDeliveryTime(
  now: Date,
  timezone: string,
  quiet: Pick<ReminderNudgeSettings, "quiet_start" | "quiet_end">,
): Date {
  const prefs = { ...DEFAULT_REMINDER_NUDGES, ...quiet };
  if (!reminderNudgesQuiet(now, timezone, prefs)) return now;
  const start = Math.floor(now.getTime() / 60000) * 60000;
  for (let minute = 1; minute <= 48 * 60; minute++) {
    const candidate = new Date(start + minute * 60000);
    if (!reminderNudgesQuiet(candidate, timezone, prefs)) return candidate;
  }
  throw new Error("The notification window could not be resolved.");
}
