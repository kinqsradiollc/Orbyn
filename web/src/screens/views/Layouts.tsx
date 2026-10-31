import {
  addDays,
  calendarDay,
  cellText,
  daysLeft,
  daysLeftText,
  fieldKeyId,
  groupHeader,
  isOverdue,
  localDateKey,
  statusText,
  type CustomField,
  type FieldValue,
  type Item,
  type ViewDefinition,
  type ViewGroup,
  type ViewRow,
} from "@orbyn/core";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, IconButton } from "../../ui/kit";
import { TaskRow } from "../shared-task";

const MIME = "application/x-orbyn-view-row";

type Shared = {
  timeZone: string;
  fields: CustomField[];
  people: { id: string; name: string }[];
  onOpen: (row: ViewRow) => void;
};

function facts(row: ViewRow, timeZone: string, fields: CustomField[]) {
  const ctx = { now: new Date(), timeZone };
  const parts: string[] = [];
  if (row.kind === "page") {
    parts.push(cellText(row, "kind", ctx));
    if (row.folder_name) parts.push(row.folder_name);
  } else {
    const due = cellText(row, "due", ctx);
    if (due) parts.push(`Due ${due}`);
    if (row.kind === "task" && row.status !== "todo" && row.status !== "done")
      parts.push(statusText(row.status));
    if (row.kind === "project" && row.task_count)
      parts.push(`${row.done_count ?? 0} of ${row.task_count} done`);
  }
  if (row.kind !== "project" && row.project_name) parts.push(row.project_name);
  if (row.team_name) parts.push(row.team_name);
  for (const f of fields.slice(0, 2)) {
    const text = cellText(row, `field:${f.id}`, ctx, { fields });
    if (text) parts.push(`${f.name}: ${text}`);
  }
  return parts.filter(Boolean).join(" · ");
}

/** One line each, the app's own row for tasks, groups that fold. */
export function List({
  groups,
  folded,
  onToggleFold,
  timeZone,
  fields,
  onOpen,
  itemOf,
}: Shared & {
  groups: ViewGroup[];
  folded: Set<string>;
  onToggleFold: (key: string) => void;
  itemOf: (row: ViewRow) => Item | undefined;
}) {
  const grouped = !(groups.length === 1 && groups[0].key === "all");
  const ctx = { now: new Date(), timeZone };
  return (
    <div className="vw-list">
      {groups.map((g) => {
        const shut = folded.has(g.key);
        const Chevron = shut ? ChevronRight : ChevronDown;
        return (
          <section key={g.key}>
            {grouped && (
              <button
                className="vw-fold"
                aria-expanded={!shut}
                onClick={() => onToggleFold(g.key)}
              >
                <Chevron aria-hidden="true" />
                {groupHeader({
                  title: g.title || "Everything",
                  items: g.rows as never[],
                  minutes: g.minutes,
                })}
              </button>
            )}
            {!shut && (
              <div className="st-rows">
                {g.rows.map((row) => {
                  const item = row.kind === "task" ? itemOf(row) : undefined;
                  if (item)
                    return (
                      <TaskRow
                        key={`${g.key}:${row.id}`}
                        item={item}
                        readOnly={!row.can_write}
                      />
                    );
                  const left = row.kind !== "page" ? daysLeft(row, ctx) : null;
                  return (
                    <button
                      key={`${g.key}:${row.id}`}
                      className="vw-row"
                      onClick={() => onOpen(row)}
                    >
                      <span className="vw-grow">
                        <span dir="auto">{row.title || "Untitled"}</span>
                        <small dir="auto">{facts(row, timeZone, fields)}</small>
                      </span>
                      {left !== null && row.status !== "done" && (
                        <span
                          className={
                            isOverdue(row, ctx)
                              ? "vw-late small"
                              : "muted small"
                          }
                        >
                          {daysLeftText(left)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Columns for pages and projects, and for tasks grouped by something a card
 * can't be dragged along. Grouped by a choice, person or checkbox field, cards
 * drag between columns to change it; every choice keeps a column.
 */
export function GroupBoard({
  groups,
  def,
  timeZone,
  fields,
  onOpen,
  onSetField,
}: Shared & {
  groups: ViewGroup[];
  def: ViewDefinition;
  onSetField: (row: ViewRow, field: string, value: FieldValue) => void;
}) {
  const fieldId = fieldKeyId(def.group_by);
  const field = fieldId ? fields.find((f) => f.id === fieldId) : undefined;
  const movable =
    !!field &&
    (field.type === "select" ||
      field.type === "person" ||
      field.type === "checkbox");
  const [over, setOver] = useState<string | null>(null);
  const columns: ViewGroup[] = [...groups];
  if (field?.type === "select")
    for (const o of field.options)
      if (!columns.some((c) => c.key === `v:${o}`))
        columns.push({ key: `v:${o}`, title: o, rows: [], minutes: 0 });
  if (movable && !columns.some((c) => c.key === "~none"))
    columns.push({
      key: "~none",
      title: `No ${field!.name}`,
      rows: [],
      minutes: 0,
    });
  if (field?.type === "select")
    columns.sort(
      (a, b) =>
        Number(a.key === "~none") - Number(b.key === "~none") ||
        field.options.indexOf(a.key.slice(2)) -
          field.options.indexOf(b.key.slice(2)),
    );
  const valueOf = (key: string): FieldValue => {
    if (key === "~none") return null;
    const raw = key.slice(2);
    return field?.type === "checkbox" ? raw === "true" : raw;
  };
  const drop = (e: DragEvent, key: string) => {
    setOver(null);
    if (!movable || !field) return;
    const id = e.dataTransfer.getData(MIME);
    const row = groups.flatMap((g) => g.rows).find((r) => r.id === id);
    if (!row || !row.can_write) return;
    e.preventDefault();
    const next = valueOf(key);
    if ((row.fields[field.id] ?? null) !== next)
      onSetField(row, field.id, next);
  };
  return (
    <div className="vw-board">
      {columns.map((col) => (
        <section
          key={col.key}
          className={over === col.key ? "is-over" : undefined}
          aria-label={col.title}
          onDragOver={(e) => {
            if (!movable || !e.dataTransfer.types.includes(MIME)) return;
            e.preventDefault();
            setOver(col.key);
          }}
          onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
          onDrop={(e) => drop(e, col.key)}
        >
          <header>
            {groupHeader({
              title: col.title || "Everything",
              items: col.rows as never[],
              minutes: col.minutes,
            })}
          </header>
          {col.rows.map((row) => (
            <button
              key={row.id}
              className="vw-card"
              draggable={movable && row.can_write}
              onDragStart={(e) => {
                e.dataTransfer.setData(MIME, row.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onOpen(row)}
            >
              <span dir="auto">{row.title || "Untitled"}</span>
              <small dir="auto">{facts(row, timeZone, fields)}</small>
            </button>
          ))}
          {!col.rows.length && <p className="muted small">Nothing here</p>}
        </section>
      ))}
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
};

/**
 * A month: rows on their deadline or a chosen date field. Dragging to another
 * day moves that date. A person's sessions stay where they are.
 */
export function MonthView({
  rows,
  def,
  timeZone,
  onOpen,
  onMoveDay,
}: Shared & {
  rows: ViewRow[];
  def: ViewDefinition;
  onMoveDay: (row: ViewRow, day: string) => void;
}) {
  const { ref, width } = useWidth();
  const today = localDateKey(new Date(), timeZone);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [over, setOver] = useState<string | null>(null);
  const first = `${month}-01`;
  const start = addDays(first, -new Date(`${first}T12:00:00Z`).getUTCDay());
  const days = Array.from({ length: 42 }, (_, n) => addDays(start, n));
  const byDay = new Map<string, ViewRow[]>();
  let undated = 0;
  for (const row of rows) {
    const day = calendarDay(row, def, timeZone);
    if (!day) {
      undated += 1;
      continue;
    }
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };
  const label = new Date(`${first}T12:00:00Z`).toLocaleDateString([], {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const movable = def.source === "tasks" || !!fieldKeyId(def.date_by ?? "");
  return (
    <div className="vw-month" ref={ref}>
      <div className="vw-month-head">
        <IconButton label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft />
        </IconButton>
        <h3>{label}</h3>
        <IconButton label="Next month" onClick={() => shift(1)}>
          <ChevronRight />
        </IconButton>
        <Button onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
        {undated > 0 && (
          <small className="muted">
            {undated === 1 ? "1 has no date" : `${undated} have no date`}
          </small>
        )}
      </div>
      {width > 0 && width < 560 ? (
        <div className="vw-agenda" role="group" aria-label={label}>
          {[...byDay]
            .filter(([day]) => day.slice(0, 7) === month)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, list]) => (
              <section key={day}>
                <h4>
                  {new Date(`${day}T12:00:00Z`).toLocaleDateString([], {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                </h4>
                {list.map((row) => (
                  <button
                    key={row.id}
                    className="vw-row"
                    onClick={() => onOpen(row)}
                  >
                    <span className="vw-grow" dir="auto">
                      {row.title || "Untitled"}
                    </span>
                    {row.status && <small>{statusText(row.status)}</small>}
                  </button>
                ))}
              </section>
            ))}
          {![...byDay.keys()].some((day) => day.slice(0, 7) === month) && (
            <p className="muted">No dated items this month</p>
          )}
        </div>
      ) : (
        <div className="vw-grid" role="group" aria-label={label}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="vw-weekday" aria-hidden="true">
              {d}
            </div>
          ))}
          {days.map((day) => (
            <div
              key={day}
              role="group"
              aria-label={day}
              className={`vw-day${day.slice(0, 7) !== month ? " is-other" : ""}${day === today ? " is-today" : ""}${over === day ? " is-over" : ""}`}
              onDragOver={(e) => {
                if (!movable || !e.dataTransfer.types.includes(MIME)) return;
                e.preventDefault();
                setOver(day);
              }}
              onDragLeave={() => setOver((o) => (o === day ? null : o))}
              onDrop={(e) => {
                setOver(null);
                const row = rows.find(
                  (r) => r.id === e.dataTransfer.getData(MIME),
                );
                if (!row || !row.can_write || !movable) return;
                e.preventDefault();
                if (calendarDay(row, def, timeZone) !== day)
                  onMoveDay(row, day);
              }}
            >
              <span>{Number(day.slice(8, 10))}</span>
              {(byDay.get(day) ?? []).map((row) => (
                <button
                  key={row.id}
                  className={`vw-chip${row.status === "done" ? " is-done" : ""}`}
                  dir="auto"
                  draggable={movable && row.can_write}
                  title={row.title}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MIME, row.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onOpen(row)}
                >
                  {row.title || "Untitled"}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pages as cards, with their own first picture when they have one. */
export function Gallery({
  rows,
  timeZone,
  fields,
  onOpen,
}: Shared & { rows: ViewRow[] }) {
  return (
    <div className="vw-gallery">
      {rows.map((row) => (
        <button key={row.id} onClick={() => onOpen(row)}>
          {row.cover && <img src={row.cover} alt="" loading="lazy" />}
          <span dir="auto">{row.title || "Untitled"}</span>
          {row.preview && <p dir="auto">{row.preview}</p>}
          <small dir="auto">{facts(row, timeZone, fields)}</small>
        </button>
      ))}
    </div>
  );
}
