import { useState, type DragEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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
  type ViewDefinition,
  type ViewGroup,
  type ViewRow,
} from "@orbyn/core";

const VIEW_ROW_MIME = "application/x-orbyn-view-row";

type Shared = {
  timeZone: string;
  fields: CustomField[];
  people: { id: string; name: string }[];
  onOpen: (row: ViewRow) => void;
};

/** The short facts under a row's name: when it's due, where it sits. */
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
  // A few of your own fields, so a list says what a table would.
  for (const f of fields.slice(0, 2)) {
    const text = cellText(row, `field:${f.id}`, ctx, { fields });
    if (text) parts.push(`${f.name}: ${text}`);
  }
  return parts.filter(Boolean).join(" · ");
}

function GroupHead({
  group,
  folded,
  onToggle,
}: {
  group: ViewGroup;
  folded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="task-group-fold view-list-head"
      aria-expanded={!folded}
      onClick={onToggle}
    >
      {folded ? (
        <ChevronRight size={14} aria-hidden="true" />
      ) : (
        <ChevronDown size={14} aria-hidden="true" />
      )}
      {groupHeader({
        title: group.title || "Everything",
        items: group.rows as never[],
        minutes: group.minutes,
      })}
    </button>
  );
}

/** A view as a list: one line each, ticks for tasks, groups that fold. */
export function ViewList({
  groups,
  folded,
  onToggleFold,
  onToggle,
  timeZone,
  fields,
  onOpen,
}: Shared & {
  groups: ViewGroup[];
  folded: Set<string>;
  onToggleFold: (key: string) => void;
  onToggle: (row: ViewRow) => void;
}) {
  const grouped = !(groups.length === 1 && groups[0].key === "all");
  const ctx = { now: new Date(), timeZone };
  return (
    <div className="view-list">
      {groups.map((g) => (
        <section key={g.key} className="view-list-group">
          {grouped && (
            <GroupHead
              group={g}
              folded={folded.has(g.key)}
              onToggle={() => onToggleFold(g.key)}
            />
          )}
          {!folded.has(g.key) && (
            <ul>
              {g.rows.map((row) => {
                const left = row.kind !== "page" ? daysLeft(row, ctx) : null;
                return (
                  <li
                    key={`${g.key}:${row.id}`}
                    className={
                      "view-list-row" +
                      (row.status === "done" ? " is-done" : "")
                    }
                  >
                    {row.kind === "task" && (
                      <input
                        type="checkbox"
                        aria-label={`${row.status === "done" ? "Reopen" : "Finish"} ${row.title}`}
                        checked={row.status === "done"}
                        disabled={!row.can_write}
                        onChange={() => onToggle(row)}
                      />
                    )}
                    <button
                      className="view-list-title"
                      onClick={() => onOpen(row)}
                    >
                      <strong>{row.title || "Untitled"}</strong>
                      <small>{facts(row, timeZone, fields)}</small>
                    </button>
                    {left !== null && row.status !== "done" && (
                      <span
                        className={
                          "view-days-left" +
                          (isOverdue(row, ctx) ? " is-late" : "")
                        }
                      >
                        {daysLeftText(left)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * A board for pages and projects, and for tasks grouped by something a
 * card can't be dragged along (size, project, due week): columns are the
 * groups. Grouped by a choice, person or checkbox field, cards drag between
 * columns to change it.
 */
export function ViewBoard({
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
  // Every choice has a column, even an empty one, so a card can go there.
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
    if (field?.type === "checkbox") return raw === "true";
    return raw;
  };
  const drop = (e: DragEvent, key: string) => {
    setOver(null);
    if (!movable || !field) return;
    const id = e.dataTransfer.getData(VIEW_ROW_MIME);
    const row = groups.flatMap((g) => g.rows).find((r) => r.id === id);
    if (!row) return;
    e.preventDefault();
    const now = row.fields[field.id] ?? null;
    const next = valueOf(key);
    if (now !== next) onSetField(row, field.id, next);
  };
  return (
    <div className="view-board" role="list">
      {columns.map((col) => (
        <section
          key={col.key}
          role="listitem"
          className={"view-board-col" + (over === col.key ? " is-over" : "")}
          aria-label={col.title}
          onDragOver={(e) => {
            if (!movable || !e.dataTransfer.types.includes(VIEW_ROW_MIME))
              return;
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
              className="view-card"
              draggable={movable && row.can_write}
              onDragStart={(e) => {
                e.dataTransfer.setData(VIEW_ROW_MIME, row.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onOpen(row)}
            >
              <strong>{row.title || "Untitled"}</strong>
              <small>{facts(row, timeZone, fields)}</small>
            </button>
          ))}
          {!col.rows.length && <p className="view-board-empty">Nothing here</p>}
        </section>
      ))}
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A view as a month: each row on its deadline's day, or on the day of a
 * date field the view chose. Tasks can be dragged to another day to move
 * their deadline (their sessions stay put); pages and projects move their
 * date field the same way.
 */
export function ViewCalendar({
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
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const label = new Date(`${first}T12:00:00Z`).toLocaleDateString([], {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const movable = def.source === "tasks" || !!fieldKeyId(def.date_by ?? "");
  return (
    <div className="view-calendar">
      <div className="view-calendar-head">
        <button
          className="icon-button"
          aria-label="Previous month"
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <h3>{label}</h3>
        <button
          className="icon-button"
          aria-label="Next month"
          onClick={() => shift(1)}
        >
          <ChevronRight size={16} />
        </button>
        <button
          className="secondary"
          onClick={() => setMonth(today.slice(0, 7))}
        >
          Today
        </button>
        {undated > 0 && (
          <small className="muted">
            {undated === 1 ? "1 has no date" : `${undated} have no date`}
          </small>
        )}
      </div>
      <div className="view-calendar-grid" role="grid" aria-label={label}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="view-calendar-weekday" role="columnheader">
            {d}
          </div>
        ))}
        {days.map((day) => (
          <div
            key={day}
            role="gridcell"
            aria-label={day}
            className={
              "view-calendar-day" +
              (day.slice(0, 7) !== month ? " is-other" : "") +
              (day === today ? " is-today" : "") +
              (over === day ? " is-over" : "")
            }
            onDragOver={(e) => {
              if (!movable || !e.dataTransfer.types.includes(VIEW_ROW_MIME))
                return;
              e.preventDefault();
              setOver(day);
            }}
            onDragLeave={() => setOver((o) => (o === day ? null : o))}
            onDrop={(e) => {
              setOver(null);
              const id = e.dataTransfer.getData(VIEW_ROW_MIME);
              const row = rows.find((r) => r.id === id);
              if (!row) return;
              e.preventDefault();
              if (calendarDay(row, def, timeZone) !== day) onMoveDay(row, day);
            }}
          >
            <span className="view-calendar-date">
              {Number(day.slice(8, 10))}
            </span>
            {(byDay.get(day) ?? []).map((row) => (
              <button
                key={row.id}
                className={
                  "view-calendar-chip" +
                  (row.status === "done" ? " is-done" : "")
                }
                draggable={movable && row.can_write}
                onDragStart={(e) => {
                  e.dataTransfer.setData(VIEW_ROW_MIME, row.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onOpen(row)}
                title={row.title}
              >
                {row.title || "Untitled"}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Pages as cards (DATA-05): the title, the first lines, and the page's
 * first image as a cover when it has one of its own. Otherwise the card is
 * plain surface; no made-up colours.
 */
export function ViewGallery({
  rows,
  timeZone,
  fields,
  onOpen,
}: Shared & { rows: ViewRow[] }) {
  return (
    <div className="view-gallery">
      {rows.map((row) => (
        <button
          key={row.id}
          className="view-gallery-card"
          onClick={() => onOpen(row)}
        >
          {row.cover && <img src={row.cover} alt="" loading="lazy" />}
          <strong>{row.title || "Untitled"}</strong>
          {row.preview && <p>{row.preview}</p>}
          <small>{facts(row, timeZone, fields)}</small>
        </button>
      ))}
    </div>
  );
}
