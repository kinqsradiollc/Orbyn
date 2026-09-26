import { z } from "zod";

/**
 * Session check-in: after a session ends, its person says how it went. The
 * answer makes "still needed" exact and tells the planner's learning which
 * sessions were kept. Until someone answers, a past session is never assumed
 * to be done.
 *
 * - `done`: "Done for today". The session's time went into the task.
 * - `more`: "Need more". The time went in, and the task needs more than was
 *   left: `more_minutes` becomes what is still needed.
 * - `skipped`: "Skip". Nothing went in; the time is still needed.
 */
export const SESSION_OUTCOMES = ["done", "more", "skipped"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

/** The words each answer is shown with, in both apps. */
export const SESSION_OUTCOME_LABELS: Record<SessionOutcome, string> = {
  done: "Done for today",
  more: "Need more",
  skipped: "Skip",
};

/** What each answer did, for the toast after it. */
export function checkInNote(outcome: SessionOutcome, minutes: number): string {
  if (outcome === "skipped")
    return "Skipped. That time is still needed for the task.";
  const time =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
      : `${minutes}m`;
  return outcome === "more"
    ? `Counted ${time}, and the task needs more time.`
    : `Counted ${time} toward the task.`;
}

/** `POST /blocks/:id/check-in`. */
export const sessionCheckInInput = z
  .object({
    outcome: z.enum(SESSION_OUTCOMES),
    /** With "Need more": how much time the task still needs, in minutes. */
    more_minutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
  })
  .strict()
  .refine((d) => d.outcome === "more" || d.more_minutes === undefined, {
    message: "Only “Need more” takes more minutes.",
    path: ["more_minutes"],
  });
export type SessionCheckInInput = z.input<typeof sessionCheckInInput>;

/** A session that ended and is waiting to be checked in. */
export type SessionCheckIn = {
  id: string;
  item_id: string;
  title: string;
  start_at: string;
  end_at: string;
  /** Minutes the session ran for (its planned length). */
  minutes: number;
  project_id: string | null;
  project_name: string | null;
  /** What the task still needs now, when it has an estimate. */
  remaining_minutes: number | null;
};

/** `POST /blocks/:id/check-in`'s answer. */
export type SessionCheckedIn = {
  id: string;
  outcome: SessionOutcome;
  /** Minutes the answer counted toward the task (0 for skip). */
  counted_minutes: number;
  /** What the task still needs after it, when it has an estimate. */
  remaining_minutes: number | null;
};

/** How far back sessions are offered for a check-in. */
export const CHECK_IN_DAYS = 3;
