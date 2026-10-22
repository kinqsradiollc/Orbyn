import { createHash } from "node:crypto";
import {
  DEFAULT_REMINDER_NUDGES,
  reminderNudgeSettingsInput,
  nextAssistantDeliveryTime,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";

export async function conversationAttention(
  db: Queryable,
  owner: string,
  now: Date,
  fallbackZone = "UTC",
) {
  const row = (
    await db.query<{
      timezone: string | null;
      reminder_nudges: unknown;
      muted: boolean | null;
    }>(
      `SELECT p.timezone,a.reminder_nudges,a.conversation_updates_muted AS muted FROM users u
      LEFT JOIN planner_prefs p ON p.user_id=u.id LEFT JOIN agent_settings a ON a.user_id=u.id WHERE u.id=$1`,
      [owner],
    )
  ).rows[0];
  const quiet = reminderNudgeSettingsInput.safeParse({
    ...DEFAULT_REMINDER_NUDGES,
    ...(row?.reminder_nudges && typeof row.reminder_nudges === "object"
      ? row.reminder_nudges
      : {}),
  });
  let timezone = row?.timezone ?? fallbackZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    timezone = "UTC";
  }
  return {
    muted: row?.muted ?? false,
    timezone,
    quiet_start: quiet.success
      ? quiet.data.quiet_start
      : DEFAULT_REMINDER_NUDGES.quiet_start,
    quiet_end: quiet.success
      ? quiet.data.quiet_end
      : DEFAULT_REMINDER_NUDGES.quiet_end,
    availableAt: nextAssistantDeliveryTime(
      now,
      timezone,
      quiet.success ? quiet.data : DEFAULT_REMINDER_NUDGES,
    ),
  };
}

/** Missing revision evidence disables suppression; model wording is never the change signal. */
export async function conversationChangeFingerprint(
  db: Queryable,
  bindingId: string,
) {
  const revisions = (
    await db.query<{
      source_kind: string;
      source_id: string;
      observed_revision: string | null;
    }>(
      `SELECT source_kind,source_id,observed_revision FROM assistant_delivery_sources
      WHERE binding_id=$1 ORDER BY source_kind,source_id`,
      [bindingId],
    )
  ).rows;
  if (
    !revisions.length ||
    revisions.some((source) => !source.observed_revision)
  )
    return null;
  return createHash("sha256").update(JSON.stringify(revisions)).digest("hex");
}
