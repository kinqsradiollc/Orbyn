import { z } from "zod";

/**
 * Team capacity: for each person and each day, how much of their working
 * time is still free. Built from the same busy time teammates already see —
 * events, bookings, busy frames and planned sessions — never what it is for.
 */
export const capacityQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (d) => Date.parse(d.to) > Date.parse(d.from),
    "End must be after start",
  )
  .refine(
    (d) => Date.parse(d.to) - Date.parse(d.from) <= 31 * 86_400_000,
    "Ask for a month or less at a time",
  );

/**
 * How free a day is, for the shade: 0 none, 1 under 2 hours, 2 two to five,
 * 3 five or more. Everyone on the team sees this much.
 */
export type CapacityLevel = 0 | 1 | 2 | 3;

export type CapacityDay = {
  /** "YYYY-MM-DD" in the viewer's time zone. */
  day: string;
  level: CapacityLevel;
  /** Not a working day for them. */
  off: boolean;
  /** Booked beyond their working hours. */
  over: boolean;
  /** The hours behind the shade: for owners and admins only, else null. */
  working_minutes: number | null;
  free_minutes: number | null;
  /** Time already planned for this team's tasks that day. */
  team_minutes: number | null;
  over_minutes: number | null;
};

export type MemberCapacity = {
  user_id: string;
  name: string;
  days: CapacityDay[];
  /**
   * This team's open work assigned to them that isn't on any day yet. Kept
   * apart: spreading it over days would make up a number. Owners and admins
   * only.
   */
  unplaced_minutes: number | null;
};

export type TeamCapacity = {
  from: string;
  to: string;
  timezone: string;
  days: string[];
  /** Whether this viewer sees hours as well as shades. */
  show_hours: boolean;
  members: MemberCapacity[];
};

export const capacityLevel = (freeMinutes: number): CapacityLevel =>
  freeMinutes < 15 ? 0 : freeMinutes < 120 ? 1 : freeMinutes < 300 ? 2 : 3;

/** "5h", "3½h", "45m", "0h". */
export function hoursLabel(minutes: number) {
  const m = Math.max(0, Math.round(minutes / 15) * 15);
  if (m < 60) return m ? `${m}m` : "0h";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 30 ? `${h}½h` : rest ? `${h}h ${rest}m` : `${h}h`;
}
