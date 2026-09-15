import { Share } from "react-native";
import { byDueDate, isClosed, priorityScore, type Item } from "@orbyn/core";

/** The device's IANA time zone, sent with plans and repeating items. */
export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Quick picks for how long a task should take, in minutes. */
export const ESTIMATES = [15, 30, 45, 60, 90, 120] as const;

/** Colours offered for lists; all pass the server's #rrggbb check. */
export const LIST_COLORS = [
  "#376c51",
  "#6d8a6f",
  "#4f7a9a",
  "#8a6fae",
  "#c28c70",
  "#b0573b",
  "#a3742b",
  "#526158",
] as const;

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday first, the way working weeks are usually read. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "45m", "1h", "1h 30m"; "" for nothing. */
export function minutesLabel(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "20m of 1h", "About 45m", "20m spent", or "". */
export function effortLabel(
  item: Pick<Item, "estimate_minutes" | "spent_minutes">,
) {
  const estimate = minutesLabel(item.estimate_minutes);
  const spent = minutesLabel(item.spent_minutes);
  if (estimate && spent) return `${spent} of ${estimate}`;
  if (estimate) return `About ${estimate}`;
  if (spent) return `${spent} spent`;
  return "";
}

export type Size = "quick" | "medium" | "long" | "unsized";
export const SIZES: Size[] = ["quick", "medium", "long", "unsized"];
/** The web's size buckets: up to 15 minutes, up to an hour, longer. */
export const SIZE_LABELS: Record<Size, string> = {
  quick: "Up to 15 min",
  medium: "Up to 1 hour",
  long: "Longer than 1 hour",
  unsized: "No estimate",
};
export const sizeOf = (item: Pick<Item, "estimate_minutes">): Size => {
  const m = item.estimate_minutes;
  if (!m) return "unsized";
  if (m <= 15) return "quick";
  return m <= 60 ? "medium" : "long";
};

/** Most pressing first (priorityScore), then by due date. */
export const byPriority =
  (now = new Date()) =>
  (a: Item, b: Item) =>
    priorityScore(b, now) - priorityScore(a, now) || byDueDate(a, b);

/** Open tasks other than `exceptId`, most pressing first. */
export const nextUp = (items: Item[], exceptId?: string, now = new Date()) =>
  items
    .filter(
      (i) => i.kind === "task" && !isClosed(i.status) && i.id !== exceptId,
    )
    .sort(byPriority(now));

/** Local midnight `offset` days from `from`. */
export const dayStart = (offset = 0, from = new Date()) =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);

export const clockLabel = (value: string | Date) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

/** "9:00 AM – 9:45 AM". */
export const rangeLabel = (start: string | Date, end: string | Date) =>
  `${clockLabel(start)} – ${clockLabel(end)}`;

/** "Tue, Sep 15". */
export const shortDay = (value: string | Date) =>
  new Date(value).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/** "Tue, Sep 15, 9:00 AM – 9:45 AM". */
export const slotLabel = (start: string | Date, end: string | Date) =>
  `${shortDay(start)}, ${rangeLabel(start, end)}`;

/** Minutes after midnight as "09:30", for clock fields. */
export const clockText = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "09:30" shown in the device's time format. */
export const clockDisplay = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

/** Meeting links open from five minutes before the start until the end. */
export const JOIN_EARLY_MS = 5 * 60_000;
export function canJoin(
  thing: {
    meeting_url?: string | null;
    start_at: string | null;
    end_at: string | null;
  },
  now: Date,
) {
  if (!thing.meeting_url || !thing.start_at) return false;
  const start = Date.parse(thing.start_at);
  const end = thing.end_at ? Date.parse(thing.end_at) : start + 60 * 60_000;
  return now.getTime() >= start - JOIN_EARLY_MS && now.getTime() < end;
}

/** Open the system share sheet (it includes Copy); cancelling is not an error. */
export const shareText = (message: string) =>
  Share.share({ message }).then(
    () => undefined,
    () => undefined,
  );

/** Whole minutes typed in a field, or null when empty or not a number. */
export const parseMinutes = (text: string) => {
  const n = Number(text.trim());
  return text.trim() && Number.isFinite(n) ? Math.round(n) : null;
};
