import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Popover } from "./Popover";

type Kind = "date" | "time" | "datetime-local";

type Props = {
  /** Which native input this stands in for; the value format matches it. */
  type?: Kind;
  /** "YYYY-MM-DD", "HH:mm" or "YYYY-MM-DDTHH:mm", or "" for none. */
  value: string;
  /** Called like a native input's onChange, so call sites read the same. */
  onChange?: (event: { target: { value: string } }) => void;
  /** Earliest and latest allowed, in the same format as value. */
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  placeholder?: string;
  /** Minutes between times in the list. */
  step?: number;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (value: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const timeOf = (value: string) => /(\d{2}):(\d{2})/.exec(value)?.[0] ?? "";

const dayLabel = (d: Date) =>
  d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  });
const timeLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

/**
 * A date, time or date-and-time field in Orbyn's own style: a button that
 * reads like a sentence and opens a small calendar and time list. It keeps
 * the native input's value format and change event, so swapping one in only
 * changes the tag.
 */
export function DateField({
  type = "date",
  value,
  onChange,
  min,
  max,
  disabled,
  required,
  id,
  name,
  className,
  placeholder,
  step = 15,
  autoFocus,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: Props) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hasDay = type !== "time";
  const hasTime = type !== "date";
  const day = hasDay ? parseDay(value) : null;
  const time = hasTime ? timeOf(value) : "";

  const emit = (next: string) => {
    if (!disabled && !button.current?.matches(":disabled"))
      onChange?.({ target: { value: next } });
  };
  useEffect(() => {
    if (disabled) setAnchor(null);
  }, [disabled]);
  useEffect(() => {
    if (!anchor || !button.current) return;
    const check = () => {
      if (button.current?.matches(":disabled")) setAnchor(null);
    };
    const observer = new MutationObserver(check);
    for (
      let node: HTMLElement | null = button.current;
      node;
      node = node.parentElement
    ) {
      if (node instanceof HTMLFieldSetElement)
        observer.observe(node, {
          attributes: true,
          attributeFilter: ["disabled"],
        });
    }
    check();
    return () => observer.disconnect();
  }, [anchor]);
  const label =
    type === "time"
      ? time && timeLabel(time)
      : day &&
        (hasTime && time
          ? `${dayLabel(day)}, ${timeLabel(time)}`
          : dayLabel(day));

  const Icon = type === "time" ? Clock : Calendar;
  return (
    <div className={"date-field" + (className ? " " + className : "")}>
      <button
        ref={button}
        type="button"
        id={id}
        autoFocus={autoFocus}
        className="date-field-control"
        disabled={disabled}
        aria-label={
          ariaLabel ? `${ariaLabel}${label ? `: ${label}` : ""}` : undefined
        }
        aria-describedby={ariaDescribedBy}
        aria-required={required}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        data-empty={!label || undefined}
        onClick={() =>
          setAnchor(anchor ? null : button.current!.getBoundingClientRect())
        }
      >
        <Icon size={14} aria-hidden="true" />
        <span>
          {label ||
            placeholder ||
            (type === "time" ? "Pick a time" : "Pick a date")}
        </span>
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {anchor && (
        <Popover
          anchor={anchor}
          label={
            ariaLabel ?? (type === "time" ? "Choose a time" : "Choose a date")
          }
          onClose={() => setAnchor(null)}
          width={hasDay && hasTime ? 400 : hasDay ? 276 : 180}
        >
          <div className="date-field-panel">
            {hasDay && (
              <MonthGrid
                selected={day}
                min={min ? parseDay(min) : null}
                max={max ? parseDay(max) : null}
                onPick={(d) => {
                  if (!hasTime) {
                    emit(dayKey(d));
                    setAnchor(null);
                  } else emit(`${dayKey(d)}T${time || "09:00"}`);
                }}
              />
            )}
            {hasTime && (
              <TimeList
                value={time}
                step={step}
                onPick={(t) => {
                  emit(hasDay ? `${dayKey(day ?? new Date())}T${t}` : t);
                  setAnchor(null);
                }}
              />
            )}
          </div>
          {!required && value && (
            <div className="date-field-foot">
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  emit("");
                  setAnchor(null);
                }}
              >
                Clear
              </button>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

function MonthGrid({
  selected,
  min,
  max,
  onPick,
}: {
  selected: Date | null;
  min: Date | null;
  max: Date | null;
  onPick: (day: Date) => void;
}) {
  const today = new Date();
  const [month, setMonth] = useState(() => {
    const base = selected ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [focus, setFocus] = useState<Date>(selected ?? today);
  const grid = useRef<HTMLDivElement>(null);

  const days = useMemo(() => {
    const first = new Date(month);
    first.setDate(1 - first.getDay());
    return Array.from(
      { length: 42 },
      (_, i) =>
        new Date(first.getFullYear(), first.getMonth(), first.getDate() + i),
    );
  }, [month]);
  const weekdays = days
    .slice(0, 7)
    .map((d) => d.toLocaleDateString([], { weekday: "narrow" }));
  const allowed = (d: Date) =>
    (!min || dayKey(d) >= dayKey(min)) && (!max || dayKey(d) <= dayKey(max));

  // Keyboard focus follows the highlighted day, across months.
  useEffect(() => {
    grid.current
      ?.querySelector<HTMLElement>(`[data-day="${dayKey(focus)}"]`)
      ?.focus({ preventScroll: true });
  }, [focus, month]);

  const bounded = (date: Date) =>
    min && dayKey(date) < dayKey(min)
      ? min
      : max && dayKey(date) > dayKey(max)
        ? max
        : date;
  const move = (by: number, unit: "day" | "month" = "day") => {
    const raw =
      unit === "day"
        ? new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + by)
        : new Date(
            focus.getFullYear(),
            focus.getMonth() + by,
            Math.min(
              focus.getDate(),
              new Date(
                focus.getFullYear(),
                focus.getMonth() + by + 1,
                0,
              ).getDate(),
            ),
          );
    const next = bounded(raw);
    setFocus(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };
  const changeMonth = (by: number) => {
    const next = bounded(
      new Date(month.getFullYear(), month.getMonth() + by, 1),
    );
    setFocus(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };
  useEffect(() => {
    const next = bounded(focus);
    if (dayKey(next) !== dayKey(focus)) {
      setFocus(next);
      setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    }
  }, [min?.getTime(), max?.getTime()]);
  const onKey = (e: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
      ArrowUp: () => move(-7),
      ArrowDown: () => move(7),
      PageUp: () => move(-1, "month"),
      PageDown: () => move(1, "month"),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  };

  return (
    <div className="date-month">
      <div className="date-month-head">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous month"
          disabled={
            !!min &&
            dayKey(new Date(month.getFullYear(), month.getMonth(), 0)) <
              dayKey(min)
          }
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeft size={15} />
        </button>
        <strong aria-live="polite">
          {month.toLocaleDateString([], { month: "long", year: "numeric" })}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Next month"
          disabled={
            !!max &&
            dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 1)) >
              dayKey(max)
          }
          onClick={() => changeMonth(1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="date-month-grid" role="grid" ref={grid} onKeyDown={onKey}>
        {weekdays.map((w, i) => (
          <span key={i} className="date-month-weekday" aria-hidden="true">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const key = dayKey(d);
          const isFocus = key === dayKey(focus);
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              tabIndex={isFocus ? 0 : -1}
              disabled={!allowed(d)}
              aria-label={d.toLocaleDateString([], { dateStyle: "full" })}
              aria-pressed={!!selected && key === dayKey(selected)}
              className={
                "date-day" +
                (d.getMonth() !== month.getMonth() ? " is-outside" : "") +
                (key === dayKey(today) ? " is-today" : "")
              }
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="text-button date-month-today"
        disabled={!allowed(today)}
        onClick={() => onPick(today)}
      >
        Today
      </button>
    </div>
  );
}

function TimeList({
  value,
  step,
  onPick,
}: {
  value: string;
  step: number;
  onPick: (hhmm: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const times = useMemo(() => {
    const all: string[] = [];
    const stride =
      Number.isFinite(step) && step > 0 ? Math.max(1, Math.floor(step)) : 15;
    for (let m = 0; m < 24 * 60; m += stride)
      all.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    if (value && !all.includes(value)) all.push(value);
    return all.sort();
  }, [step, value]);

  const [active, setActive] = useState(() =>
    Math.max(0, times.indexOf(value || "09:00")),
  );
  const keyboard = useRef(false);
  useEffect(() => {
    if (keyboard.current) {
      keyboard.current = false;
      const option = list.current?.querySelector<HTMLElement>(
        `[data-time="${times[active]}"]`,
      );
      option?.focus({ preventScroll: true });
      option?.scrollIntoView({ block: "nearest" });
    }
  }, [active, times]);
  // Open at the chosen time, or at the start of a working day.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-time="${value || "09:00"}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [value]);

  return (
    <div
      className="date-times"
      ref={list}
      role="listbox"
      aria-label="Time"
      onKeyDown={(event) => {
        let next = active;
        if (event.key === "ArrowDown")
          next = Math.min(times.length - 1, active + 1);
        else if (event.key === "ArrowUp") next = Math.max(0, active - 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = times.length - 1;
        else return;
        event.preventDefault();
        keyboard.current = true;
        setActive(next);
      }}
    >
      {times.map((t, index) => (
        <button
          key={t}
          type="button"
          role="option"
          data-time={t}
          tabIndex={index === active ? 0 : -1}
          onFocus={() => setActive(index)}
          aria-selected={t === value}
          className="date-time"
          onClick={() => onPick(t)}
        >
          {timeLabel(t)}
        </button>
      ))}
    </div>
  );
}
