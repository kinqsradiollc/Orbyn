import {
  localDateKey,
  sessionLine,
  statusLabels,
  type CalendarEntry,
  type CalendarView,
  type ExternalEntry,
  type TaskList,
  type TimeBlock,
} from "@orbyn/core";
import { Lock, Timer, Users, Video } from "lucide-react";
import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { Empty } from "../../ui/kit";
import { dayLong, dayMedium, dayText, spanLabel, timeLabel } from "./format";
import {
  entryKey,
  entryOnDay,
  externalKey,
  firstDayOf,
  isAllDayEntry,
  joinable,
  lastDayOf,
  monthWeeks,
  TASK_MIME,
  type Picked,
} from "./model";

const LANES = 3;

type Row =
  | {
      key: string;
      first: string;
      last: string;
      at: number;
      entry: CalendarEntry;
    }
  | {
      key: string;
      first: string;
      last: string;
      at: number;
      external: ExternalEntry;
    };

type Bar = {
  row: Row;
  start: number;
  end: number;
  lane: number;
  before: boolean;
  after: boolean;
};

/** Lay out one week: long bars first, single days in the lanes left. */
function layoutWeek(rows: Row[], week: string[]) {
  const shown = rows
    .filter((r) => r.first <= week[6] && r.last >= week[0])
    .map((row) => ({
      row,
      start: Math.max(
        0,
        week.indexOf(row.first < week[0] ? week[0] : row.first),
      ),
      end: week.indexOf(row.last > week[6] ? week[6] : row.last),
      before: row.first < week[0],
      after: row.last > week[6],
    }))
    .sort(
      (a, b) =>
        b.end - b.start - (a.end - a.start) ||
        a.start - b.start ||
        a.row.at - b.row.at,
    );
  const lanes = Array.from({ length: LANES }, () =>
    Array<boolean>(7).fill(false),
  );
  const bars: Bar[] = [];
  const hidden = Array<number>(7).fill(0);
  for (const e of shown) {
    const lane = lanes.findIndex((cols) =>
      cols.slice(e.start, e.end + 1).every((taken) => !taken),
    );
    if (lane === -1) {
      for (let c = e.start; c <= e.end; c++) hidden[c] += 1;
      continue;
    }
    for (let c = e.start; c <= e.end; c++) lanes[lane][c] = true;
    bars.push({ ...e, lane });
  }
  return { bars, hidden };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  date: string;
  tz: string;
  view: CalendarView;
  external: ExternalEntry[];
  listById: Map<string, TaskList>;
  onSelect: (day: string) => void;
  onOpenDay: (day: string) => void;
  onPick: (p: Picked, anchor: DOMRect) => void;
  onDropTask: (itemId: string, day: string) => void;
};

export function MonthGrid({
  date,
  tz,
  view,
  external,
  listById,
  onSelect,
  onOpenDay,
  onPick,
  onDropTask,
}: Props) {
  const [dropDay, setDropDay] = useState<string | null>(null);
  const today = localDateKey(new Date(), tz);
  const month = date.slice(0, 7);
  const rows = useMemo<Row[]>(
    () => [
      ...view.entries.map((entry) => ({
        key: entryKey(entry),
        first: firstDayOf(entry, tz),
        last: lastDayOf(entry, tz),
        at: Date.parse(entry.start_at),
        entry,
      })),
      ...external.map((x) => ({
        key: externalKey(x),
        first: firstDayOf(x, tz),
        last: lastDayOf(x, tz),
        at: Date.parse(x.start_at),
        external: x,
      })),
    ],
    [view.entries, external, tz],
  );
  const open = (row: Row, anchor: DOMRect) =>
    "entry" in row
      ? onPick({ kind: "entry", entry: row.entry }, anchor)
      : onPick({ kind: "external", event: row.external }, anchor);
  const drops = (day: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(TASK_MIME)) return;
      e.preventDefault();
      setDropDay(day);
    },
    onDragLeave: () => setDropDay((was) => (was === day ? null : was)),
    onDrop: (e: DragEvent) => {
      setDropDay(null);
      const id = e.dataTransfer.getData(TASK_MIME);
      if (!id) return;
      e.preventDefault();
      onDropTask(id, day);
    },
  });

  return (
    <div className="calendar-month">
      <div className="calendar-month-head" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {monthWeeks(date).map((week) => {
        const { bars, hidden } = layoutWeek(rows, week);
        return (
          <div className="calendar-month-week" key={week[0]}>
            {week.map((day, c) => {
              const count = rows.filter(
                (r) => r.first <= day && day <= r.last,
              ).length;
              const sessions = view.blocks.filter(
                (b) => localDateKey(new Date(b.start_at), tz) === day,
              ).length;
              const frames = (view.frames ?? []).filter(
                (f) => localDateKey(new Date(f.start_at), tz) === day,
              );
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={day === date}
                  aria-current={day === today ? "date" : undefined}
                  aria-label={`${dayLong(day)}${day === today ? ", today" : ""}, ${count} ${count === 1 ? "item" : "items"}, ${sessions} ${sessions === 1 ? "session" : "sessions"}${frames.length ? `, frames: ${frames.map((f) => f.name).join(", ")}` : ""}`}
                  style={{ gridColumn: c + 1 }}
                  className={[
                    "calendar-month-cell",
                    day.slice(0, 7) !== month && "is-outside",
                    day === today && "is-today",
                    day === date && "is-selected",
                    dropDay === day && "is-drop",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelect(day)}
                  {...drops(day)}
                >
                  <span className="calendar-month-date">
                    {Number(day.slice(8))}
                  </span>
                  {sessions > 0 && (
                    <span className="calendar-month-count" aria-hidden="true">
                      {sessions} {sessions === 1 ? "session" : "sessions"}
                    </span>
                  )}
                  {frames.length > 0 && (
                    <span className="calendar-month-frames" aria-hidden="true">
                      {frames.slice(0, 3).map((f) => (
                        <i
                          key={f.frame_id + f.start_at}
                          style={{ background: f.color }}
                        />
                      ))}
                    </span>
                  )}
                  {count > 0 && (
                    <span className="calendar-month-dots" aria-hidden="true">
                      {Array.from({ length: Math.min(3, count) }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
            {bars.map((b) => {
              const row = b.row;
              const title =
                "entry" in row ? row.entry.title : row.external.title;
              const color =
                "entry" in row
                  ? row.entry.color ||
                    (row.entry.list_id
                      ? listById.get(row.entry.list_id)?.color
                      : undefined)
                  : row.external.color;
              const timed =
                !b.before &&
                !isAllDayEntry("entry" in row ? row.entry : row.external, tz);
              const start =
                "entry" in row ? row.entry.start_at : row.external.start_at;
              const label =
                "entry" in row
                  ? `${title} (${row.entry.kind === "event" ? "Event" : statusLabels[row.entry.status]}${timed ? ` · ${timeLabel(start, tz)}` : ""}${row.entry.team_name ? ` · ${row.entry.team_name}` : ""})`
                  : `${title} (from ${row.external.name}, read-only)`;
              return (
                <button
                  key={row.key}
                  type="button"
                  className={[
                    "calendar-bar",
                    "entry" in row && row.entry.status === "done" && "is-done",
                    b.before && "is-before",
                    b.after && "is-after",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    {
                      gridColumn: `${b.start + 1} / ${b.end + 2}`,
                      gridRow: b.lane + 2,
                      ...(color ? { "--mark": color } : {}),
                    } as CSSProperties
                  }
                  title={label}
                  aria-label={label}
                  onClick={(e) =>
                    open(row, e.currentTarget.getBoundingClientRect())
                  }
                >
                  {timed && <time>{timeLabel(start, tz)}</time>}
                  <span dir="auto">{title}</span>
                  {"external" in row && <Lock aria-hidden="true" />}
                  {"entry" in row && row.entry.team_id && (
                    <Users aria-hidden="true" />
                  )}
                </button>
              );
            })}
            {hidden.map(
              (n, c) =>
                n > 0 && (
                  <button
                    key={c}
                    type="button"
                    className="calendar-more"
                    style={{ gridColumn: c + 1, gridRow: LANES + 2 }}
                    aria-label={`${n} more on ${dayMedium(week[c])}`}
                    onClick={() => onOpenDay(week[c])}
                  >
                    +{n} more
                  </button>
                ),
            )}
          </div>
        );
      })}
    </div>
  );
}

type AgendaProps = {
  days: string[];
  tz: string;
  view: CalendarView;
  external: ExternalEntry[];
  listById: Map<string, TaskList>;
  onPick: (p: Picked, anchor: DOMRect) => void;
  empty: string;
};

type AgendaRow = { key: string; at: number; picked: Picked };

const dayRows = (
  day: string,
  tz: string,
  view: CalendarView,
  external: ExternalEntry[],
) =>
  [
    ...view.entries
      .filter((e) => entryOnDay(e, day, tz))
      .map((entry): AgendaRow => ({
        key: entryKey(entry),
        at: isAllDayEntry(entry, tz) ? 0 : Date.parse(entry.start_at),
        picked: { kind: "entry", entry },
      })),
    ...view.blocks
      .filter((b: TimeBlock) => localDateKey(new Date(b.start_at), tz) === day)
      .map((block): AgendaRow => ({
        key: block.id,
        at: Date.parse(block.start_at),
        picked: { kind: "block", block },
      })),
    ...(view.habit_blocks ?? [])
      .filter((h) => localDateKey(new Date(h.start_at), tz) === day)
      .map((habit): AgendaRow => ({
        key: habit.id,
        at: Date.parse(habit.start_at),
        picked: { kind: "habit", habit },
      })),
    ...external
      .filter((x) => entryOnDay(x, day, tz))
      .map((event): AgendaRow => ({
        key: externalKey(event),
        at: isAllDayEntry(event, tz) ? 0 : Date.parse(event.start_at),
        picked: { kind: "external", event },
      })),
  ].sort((a, b) => a.at - b.at);

function rowFacts(p: Picked, tz: string, day: string) {
  if (p.kind === "entry") {
    const e = p.entry;
    const whole = isAllDayEntry(e, tz);
    const continued = firstDayOf(e, tz) < day;
    return {
      title: e.title,
      time: continued
        ? "Ongoing"
        : whole
          ? "All day"
          : timeLabel(e.start_at, tz),
      line: [
        e.kind === "event" ? "Event" : statusLabels[e.status],
        e.occurrence && "Repeats",
        e.location,
        e.team_name,
        continued && `until ${dayMedium(lastDayOf(e, tz))}`,
      ]
        .filter(Boolean)
        .join(" · "),
      late: false,
      done: e.status === "done",
    };
  }
  if (p.kind === "block") {
    const b = p.block;
    return {
      title: b.title,
      time: timeLabel(b.start_at, tz),
      line: `${sessionLine(b) ?? "Session"} · ${spanLabel(b.start_at, b.end_at, tz)}`,
      late: !!b.after_deadline && b.status !== "done",
      done: b.status === "done",
    };
  }
  if (p.kind === "habit")
    return {
      title: p.habit.name,
      time: timeLabel(p.habit.start_at, tz),
      line: `Habit · ${spanLabel(p.habit.start_at, p.habit.end_at, tz)}`,
      late: false,
      done: !!p.habit.outcome,
    };
  if (p.kind === "external")
    return {
      title: p.event.title,
      time: isAllDayEntry(p.event, tz)
        ? "All day"
        : timeLabel(p.event.start_at, tz),
      line: [p.event.name, p.event.location].filter(Boolean).join(" · "),
      late: false,
      done: false,
    };
  return { title: "", time: "", line: "", late: false, done: false };
}

/** Days as aligned rows: events, tasks, sessions and habits in time order. */
export function AgendaList({
  days,
  tz,
  view,
  external,
  listById,
  onPick,
  empty,
}: AgendaProps) {
  const filled = days
    .map((day) => ({ day, rows: dayRows(day, tz, view, external) }))
    .filter((d) => d.rows.length);
  if (!filled.length) return <Empty title={empty} />;
  const now = Date.now();
  return (
    <div className="calendar-agenda">
      {filled.map(({ day, rows }) => (
        <section key={day} aria-label={dayLong(day)}>
          <h3>
            {dayText(day, { weekday: "long", day: "numeric", month: "long" })}
            <span className="muted"> {rows.length}</span>
          </h3>
          <div className="rows">
            {rows.map(({ key, picked }) => {
              const f = rowFacts(picked, tz, day);
              const entry = picked.kind === "entry" ? picked.entry : null;
              const color =
                entry?.color ||
                (entry?.list_id
                  ? listById.get(entry.list_id)?.color
                  : undefined) ||
                (picked.kind === "external" ? picked.event.color : undefined);
              return (
                <div key={key} className="calendar-agenda-row">
                  <button
                    type="button"
                    className={`row${f.done ? " is-done" : ""}`}
                    style={
                      color ? ({ "--mark": color } as CSSProperties) : undefined
                    }
                    onClick={(e) =>
                      onPick(picked, e.currentTarget.getBoundingClientRect())
                    }
                  >
                    <time>{f.time}</time>
                    <i aria-hidden="true" />
                    <span className="row-main">
                      <span className="row-title" dir="auto">
                        {picked.kind === "block" && (
                          <Timer aria-hidden="true" />
                        )}
                        {picked.kind === "external" && (
                          <Lock aria-hidden="true" />
                        )}
                        {f.title}
                      </span>
                      <small
                        className={f.late ? "is-late" : "muted"}
                        dir="auto"
                      >
                        {f.line}
                      </small>
                    </span>
                  </button>
                  {entry && joinable(entry, now) && (
                    <a
                      className="btn btn-secondary"
                      href={entry.meeting_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Video aria-hidden="true" /> Join
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
