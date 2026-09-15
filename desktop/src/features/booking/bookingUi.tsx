import type { CSSProperties, ReactNode } from "react";
import { CalendarCheck, CircleCheck } from "lucide-react";
import type { BookingEvent, BookingStatus } from "@orbyn/core";
import { dayKey, fromDayKey } from "../../lib/planning";

/** A booking to open in the inbox; a new `key` opens it again. */
export type BookingFocus = { id: string; key: number };

/** The public address of a booking page. */
export const bookingLink = (slug: string) =>
  location.protocol === "file:"
    ? `/book/${slug}`
    : `${window.location.origin}/book/${slug}`;

export const DEFAULT_COLOR = "#376c51";
export const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Awaiting email",
  awaiting_approval: "Needs approval",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function BookingStatusPill({ status }: { status: BookingStatus }) {
  return (
    <span className={"booking-status is-" + status}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---- Accent colours ------------------------------------------------------------

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Contrast against white, from 1 to 21. */
const onWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

/**
 * `hex`, darkened just enough that white text on it (and it as text on
 * white) meets WCAG AA. Dark colours come back unchanged.
 */
export function readableAccent(hex: string) {
  let rgb = channels(isHex(hex) ? hex : DEFAULT_COLOR);
  let out = toHex(rgb);
  for (let i = 0; i < 24 && onWhite(out) < 4.5; i++) {
    rgb = rgb.map((v) => v * 0.92);
    out = toHex(rgb);
  }
  return out;
}

/** Contrast against black, from 1 to 21. */
const onBlack = (hex: string) => (luminance(hex) + 0.05) / 0.05;

/**
 * `hex`, lightened just enough for the dark theme: dark text on it (and it
 * as text on the dark surface) stays readable. Light colours come back
 * unchanged.
 */
export function readableAccentOnDark(hex: string) {
  let rgb = channels(isHex(hex) ? hex : DEFAULT_COLOR);
  let out = toHex(rgb);
  for (let i = 0; i < 24 && onBlack(out) < 6; i++) {
    rgb = rgb.map((v) => v + (255 - v) * 0.12);
    out = toHex(rgb);
  }
  return out;
}

/**
 * Custom properties that recolour a page with a booking page's colour. The
 * element also needs the `booking-accent` class, which picks the light or
 * dark variant for the theme (styles/theme.css).
 */
export function accentStyle(color: string) {
  const accent = isHex(color) ? color.toLowerCase() : DEFAULT_COLOR;
  return {
    "--accent": accent,
    "--accent-light": readableAccent(accent),
    "--accent-dark": readableAccentOnDark(accent),
    "--color-accentSoft": `color-mix(in srgb, ${accent} 12%, var(--color-surface))`,
  } as CSSProperties;
}

// ---- Wording ---------------------------------------------------------------------

/** "Tuesday, September 15, 9:00 AM – 9:30 AM" in `timeZone`. */
export const whenLabel = (start: string, end: string, timeZone: string) => {
  const s = new Date(start);
  const day = s.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  });
  const t = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
  return `${day}, ${t(s)} – ${t(new Date(end))}`;
};

/** "Today", "Tomorrow", "Yesterday", or "Friday, Sep 18" for a local day key. */
export function dayHeading(key: string) {
  const d = fromDayKey(key);
  const offset = Math.round(
    (d.getTime() - fromDayKey(dayKey(new Date())).getTime()) / 86_400_000,
  );
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  });
}

/** One line of a booking's history, like "Sam Lee moved the booking". */
export function eventText(e: BookingEvent, bookerName: string) {
  const who =
    e.actor === "system"
      ? "Orbyn"
      : e.actor_name || (e.actor === "booker" ? bookerName : "A host");
  switch (e.kind) {
    case "requested":
      return `${who} asked for this time`;
    case "email_confirmed":
      return `${who} confirmed their email`;
    case "approved":
      return `${who} approved the request`;
    case "declined":
      return `${who} declined the request`;
    case "confirmed":
      return e.actor === "system"
        ? "The booking was confirmed"
        : `${who} confirmed the booking`;
    case "rescheduled":
      return `${who} moved the booking`;
    case "cancelled":
      return `${who} cancelled the booking`;
    case "no_show":
      return `${e.detail || "No-show updated"} by ${who}`;
    case "note":
      return `${who} left a note`;
  }
}

/** The event title hosts get, with the placeholders filled in. */
export const fillTitle = (
  template: string,
  page: string,
  name: string,
  email: string,
) =>
  template
    .replaceAll("{page}", page)
    .replaceAll("{name}", name)
    .replaceAll("{email}", email);

/** A question id from its label: "Company size" -> "company-size". */
export function questionId(label: string, taken: Set<string>) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34)
      .replace(/-+$/, "") || "question";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Saves text as a file in the browser's downloads. */
export function downloadText(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(
    new Blob([text], { type: type + ";charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Public pages ----------------------------------------------------------------

/** A centred card with one message, for the public booking pages. */
export function Message({
  title,
  body,
  tone = "info",
  accent,
  children,
}: {
  title: string;
  body: string;
  tone?: "info" | "ok";
  /** The booking page's colour. */
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={
        "public-card public-message fade-up is-" +
        tone +
        (accent ? " booking-accent" : "")
      }
      style={accent ? accentStyle(accent) : undefined}
      role="status"
    >
      {tone === "ok" ? <CircleCheck size={30} /> : <CalendarCheck size={30} />}
      <h1>{title}</h1>
      <p>{body}</p>
      {children}
    </section>
  );
}
