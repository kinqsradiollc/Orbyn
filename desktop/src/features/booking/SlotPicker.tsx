import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, localDateKey, type BusyInterval } from "@orbyn/core";

/** "Tue", "15" or "September 15" for a "YYYY-MM-DD" key, whatever the zone. */
export const keyLabel = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(key + "T12:00:00Z").toLocaleDateString([], {
    ...opts,
    timeZone: "UTC",
  });

type Props = {
  tz: string;
  /** The first of the seven days shown, in `tz`. */
  date: string;
  onDateChange: (date: string) => void;
  slots: BusyInterval[];
  loading: boolean;
  error?: string;
  /** The picked start, highlighted, when picking doesn't move on at once. */
  selected?: string | null;
  onPick: (slot: BusyInterval) => void;
  /** A start to leave out, like the booking's current time. */
  exclude?: string;
  /** The open day, when the parent keeps it. */
  day?: string | null;
  onDayChange?: (day: string) => void;
};

/** Seven days of free times: a strip of days, then one day's start times. */
export function SlotPicker({
  tz,
  date,
  onDateChange,
  slots,
  loading,
  error = "",
  selected,
  onPick,
  exclude,
  day: kept,
  onDayChange,
}: Props) {
  const [ownDay, setOwnDay] = useState<string | null>(null);
  const day = kept !== undefined ? kept : ownDay;
  const today = localDateKey(new Date(), tz);
  const byDay = new Map<string, BusyInterval[]>();
  for (const s of slots) {
    if (s.start_at === exclude) continue;
    const key = localDateKey(new Date(s.start_at), tz);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const strip = Array.from({ length: 7 }, (_, n) => addDays(date, n));
  const shownDay =
    day && byDay.has(day) ? day : (strip.find((k) => byDay.has(k)) ?? null);
  const times = shownDay ? (byDay.get(shownDay) ?? []) : [];
  const pickDay = (k: string) => {
    setOwnDay(k);
    onDayChange?.(k);
  };

  return (
    <div className="booking-picker">
      <div className="date-strip-head">
        <button
          type="button"
          className="icon-button"
          aria-label="Earlier days"
          disabled={date <= today}
          onClick={() =>
            onDateChange(addDays(date, -7) < today ? today : addDays(date, -7))
          }
        >
          <ChevronLeft size={18} />
        </button>
        <strong>
          {keyLabel(strip[0], { month: "long", day: "numeric" })} –{" "}
          {keyLabel(strip[6], { month: "long", day: "numeric" })}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Later days"
          onClick={() => onDateChange(addDays(date, 7))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="date-strip" role="group" aria-label="Days">
        {strip.map((k) => {
          const count = byDay.get(k)?.length ?? 0;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={shownDay === k}
              className={shownDay === k ? "active" : ""}
              disabled={!count}
              aria-label={`${keyLabel(k, { weekday: "long", month: "long", day: "numeric" })}, ${count} ${count === 1 ? "time" : "times"}`}
              onClick={() => pickDay(k)}
            >
              <small>{keyLabel(k, { weekday: "short" })}</small>
              <strong>{keyLabel(k, { day: "numeric" })}</strong>
            </button>
          );
        })}
      </div>
      {loading ? (
        <p className="muted">Finding free times…</p>
      ) : error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : times.length ? (
        <ul className="time-grid" aria-label="Free times">
          {times.map((s) => (
            <li key={s.start_at}>
              <button
                type="button"
                className={
                  "secondary" + (selected === s.start_at ? " active" : "")
                }
                aria-pressed={
                  selected === undefined ? undefined : selected === s.start_at
                }
                onClick={() => onPick(s)}
              >
                {new Date(s.start_at).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: tz,
                })}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No free times these days. Try the next week.</p>
      )}
    </div>
  );
}
