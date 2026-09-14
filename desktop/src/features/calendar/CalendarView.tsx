import { useEffect, useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  dayHeading,
  emptyDay,
  sameDay,
  startOfDay,
  type Item,
} from "@orbyn/core";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";
import {
  addDays,
  itemsForDay,
  monthTitle,
  rangeTitle,
  startOfWeek,
} from "./dates";
import { MonthView } from "./MonthView";
import { TimeGrid } from "./TimeGrid";
import { DayAgenda } from "./DayAgenda";
import "./calendar.css";

export type CalendarMode = "month" | "week" | "day";

const MODES: { id: CalendarMode; label: string; key: string }[] = [
  { id: "month", label: "Month", key: "m" },
  { id: "week", label: "Week", key: "w" },
  { id: "day", label: "Day", key: "d" },
];

type Props = {
  items: Item[];
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  /** The selected day; also decides which month / week is shown. */
  date: Date;
  onDateChange: (date: Date) => void;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  /** Keyboard shortcuts are off while a dialog or panel is open. */
  shortcuts: boolean;
};

/** Ignore shortcuts while typing or when a modifier is held. */
const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !!el?.closest("input, textarea, select, [contenteditable='true']")
  );
};

/**
 * Month / Week / Day calendar with prev/next/Today controls and shortcuts
 * (← → to move, T for today, M/W/D to switch views). Week shows 7 days on
 * wide screens, 3 on tablets and 1 on phones.
 */
export function CalendarView({
  items,
  busy,
  canWrite,
  onToggle,
  onOpen,
  date,
  onDateChange,
  mode,
  onModeChange,
  shortcuts,
}: Props) {
  const narrow = useMediaQuery("(max-width: 900px)");
  const phone = useMediaQuery("(max-width: 520px)");
  const span = phone ? 1 : narrow ? 3 : 7;
  const weekStart = span === 7 ? startOfWeek(date) : startOfDay(date);
  const weekDays = Array.from({ length: span }, (_, n) =>
    addDays(weekStart, n),
  );

  const step = (dir: -1 | 1) => {
    if (mode === "month") {
      const next = addMonths(date, dir);
      const today = new Date();
      onDateChange(
        today.getMonth() === next.getMonth() &&
          today.getFullYear() === next.getFullYear()
          ? today
          : next,
      );
    } else onDateChange(addDays(date, dir * (mode === "week" ? span : 1)));
  };
  const openDay = (day: Date) => {
    onDateChange(day);
    onModeChange("day");
  };

  const latest = useRef({ step, onDateChange, onModeChange });
  latest.current = { step, onDateChange, onModeChange };
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e)) return;
      const { step, onDateChange, onModeChange } = latest.current;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (key === "t") onDateChange(new Date());
      else {
        const m = MODES.find((m) => m.key === key);
        if (!m) return;
        onModeChange(m.id);
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcuts]);

  const title =
    mode === "month"
      ? monthTitle(date)
      : mode === "week"
        ? rangeTitle(weekDays)
        : rangeTitle([date]);
  const unit = mode === "month" ? "month" : mode === "week" ? "week" : "day";
  const dayItems = itemsForDay(items, date);

  return (
    <section className="card calendar" aria-label="Calendar">
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button
            className="icon-button"
            aria-label={`Previous ${unit}`}
            title={`Previous ${unit} (←)`}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="secondary calendar-today"
            title="Jump to today (T)"
            disabled={sameDay(date, new Date())}
            onClick={() => onDateChange(new Date())}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label={`Next ${unit}`}
            title={`Next ${unit} (→)`}
            onClick={() => step(1)}
          >
            <ChevronRight size={19} />
          </button>
          <h2 aria-live="polite">{title}</h2>
        </div>
        <div className="segmented" role="group" aria-label="Calendar view">
          {MODES.map((m) => (
            <button
              key={m.id}
              aria-pressed={mode === m.id}
              className={mode === m.id ? "active" : ""}
              title={`${m.label} view (${m.key.toUpperCase()})`}
              onClick={() => onModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <p className="calendar-hint">
        <kbd>←</kbd> <kbd>→</kbd> move · <kbd>T</kbd> today · <kbd>M</kbd>{" "}
        <kbd>W</kbd> <kbd>D</kbd> switch view
      </p>

      {mode === "month" && (
        <div className="month-layout">
          <MonthView
            items={items}
            selected={date}
            onSelect={onDateChange}
            onOpenDay={openDay}
            onOpen={onOpen}
          />
          <DayAgenda day={date} items={dayItems} onOpen={onOpen} />
        </div>
      )}

      {mode === "week" && (
        <TimeGrid
          days={weekDays}
          items={items}
          onOpen={onOpen}
          onOpenDay={openDay}
        />
      )}

      {mode === "day" && (
        <div className="day-layout">
          <TimeGrid
            days={[date]}
            items={items}
            onOpen={onOpen}
            onOpenDay={openDay}
          />
          <section className="day-tasks" aria-labelledby="day-tasks-title">
            <div className="subheading">
              <h3 id="day-tasks-title">
                {dayHeading(date)} <span>{dayItems.length}</span>
              </h3>
            </div>
            {dayItems.length ? (
              dayItems.map((i, n) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  index={n}
                  busy={busy}
                  readOnly={!canWrite(i)}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              ))
            ) : (
              <EmptyState
                icon={CalendarDays}
                title={emptyDay.title}
                body={emptyDay.body}
              />
            )}
          </section>
        </div>
      )}
    </section>
  );
}
