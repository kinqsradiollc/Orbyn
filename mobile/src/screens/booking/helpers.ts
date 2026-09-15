import type {
  Booking,
  BookingEvent,
  BookingStatus,
  BookingView,
} from "@orbyn/core";
import type { PillTone } from "../../components/Pill";
import { webOrigin } from "../../lib/api";
import { clockText } from "../../lib/planning";

export const DURATIONS = [15, 30, 45, 60, 90, 120];
export const NOTICE = [
  { value: 0, label: "None" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
  { value: 2880, label: "2 days" },
];
export const BUFFERS = [0, 5, 10, 15, 30, 60];
/** Mon–Fri, 9 to 5: where custom hours start. */
export const DEFAULT_WEEK = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: "09:00",
  end: "17:00",
}));
export const DEFAULT_EVENT_TITLE = "{page} with {name}";
/** Most ranges on one day or one date override (the server's limit). */
export const MAX_RANGES = 6;
export const MAX_QUESTIONS = 10;
export const MAX_OPTIONS = 12;
export const MAX_OVERRIDES = 100;
export const HEX = /^#[0-9a-fA-F]{6}$/;

/** The link people open to book time. */
export const bookingLink = (slug: string) => `${webOrigin}/book/${slug}`;

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * A question id from its label ("Company size" -> "company_size"), unique
 * among `taken`. Ids never change once saved: answers are stored by id.
 */
export function questionId(label: string, taken: Set<string>) {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 34) || "question";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

let seq = 0;
/** A local key for rows being edited (questions, date overrides). */
export const newKey = () => `k${++seq}`;

/** Chip options plus the saved value when it isn't one of them. */
export const withValue = (options: number[], value: number) =>
  options.includes(value) ? options : [...options, value].sort((a, b) => a - b);

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Each range ends after it starts ("09:00" < "17:00" compares as text). */
export const rangesValid = (ranges: { start: string; end: string }[]) =>
  ranges.every((r) => r.end > r.start);

/** Hours to add after the last range: 9 to 5 first, then an hour after the last. */
export function nextRange(ranges: { start: string; end: string }[]) {
  if (!ranges.length) return { start: "09:00", end: "17:00" };
  const last = Math.max(...ranges.map((r) => minutesOf(r.end)));
  const start = last + 60;
  const end = Math.min(start + 60, 23 * 60 + 59);
  return start < end ? { start: clockText(start), end: clockText(end) } : null;
}

/** "2026-09-18" for a Date, in the device's zone. */
export const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Fri, Sep 18" for "2026-09-18". */
export const dayKeyLabel = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

/** The event title template filled in with an example booker. */
export const eventTitlePreview = (template: string, page: string) =>
  template
    .replace(/\{page\}/g, page.trim() || "Intro call")
    .replace(/\{name\}/g, "Alex Kim")
    .replace(/\{email\}/g, "alex@example.com");

export const VIEWS: readonly BookingView[] = [
  "upcoming",
  "needs_approval",
  "past",
  "cancelled",
  "all",
];
export const VIEW_LABELS: Record<BookingView, string> = {
  upcoming: "Upcoming",
  needs_approval: "Needs approval",
  past: "Past",
  cancelled: "Cancelled",
  all: "All",
};
export const EMPTY_VIEW: Record<BookingView, string> = {
  upcoming: "Nothing booked yet.",
  needs_approval: "No requests are waiting for you.",
  past: "No past bookings yet.",
  cancelled: "Nothing has been cancelled.",
  all: "No bookings yet.",
};

export const STATUS: Record<BookingStatus, { label: string; tone: PillTone }> =
  {
    pending: { label: "Waiting for their email", tone: "muted" },
    awaiting_approval: { label: "Needs approval", tone: "warning" },
    confirmed: { label: "Confirmed", tone: "accent" },
    declined: { label: "Declined", tone: "danger" },
    cancelled: { label: "Cancelled", tone: "danger" },
    expired: { label: "Expired", tone: "muted" },
  };

export const EVENT_LABELS: Record<BookingEvent["kind"], string> = {
  requested: "Asked for this time",
  email_confirmed: "Confirmed their email",
  approved: "Approved",
  declined: "Declined",
  confirmed: "Booked",
  rescheduled: "Moved",
  cancelled: "Cancelled",
  no_show: "No-show",
  note: "Note",
};

export const eventActor = (e: BookingEvent) =>
  e.actor_name ??
  (e.actor === "booker" ? "Booker" : e.actor === "host" ? "Host" : "Orbyn");

/** Still bookable: confirmed and not over, or waiting and not yet started. */
export const isOpen = (b: Booking, now = Date.now()) =>
  b.status === "confirmed"
    ? Date.parse(b.end_at) > now
    : (b.status === "pending" || b.status === "awaiting_approval") &&
      Date.parse(b.start_at) > now;

/** No-shows can be marked once a confirmed booking has started. */
export const canMarkNoShow = (b: Booking, now = Date.now()) =>
  b.status === "confirmed" && Date.parse(b.start_at) <= now;

/** The booking's length in minutes. */
export const lengthOf = (b: Booking) =>
  Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000);

/** "Tue, Sep 15, 2:00 PM" in another time zone, or "" when it can't be shown. */
export function inZone(value: string, timeZone: string) {
  try {
    return new Date(value).toLocaleString([], {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
