import { Users } from "lucide-react";
import { monthGrid, sameDay, statusLabels, type Item } from "@orbyn/core";
import { isAllDay, itemsForDay, timeLabel } from "./dates";
import { layoutWeek } from "./layout";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Bars shown per week row before "+N more". */
const LANES = 3;

type Props = {
  items: Item[];
  selected: Date;
  onSelect: (day: Date) => void;
  /** "+N more": show that day on its own. */
  onOpenDay: (day: Date) => void;
  onOpen: (item: Item) => void;
};

/** Colors and markers for an item in any calendar view. */
export function entryClass(i: Pick<Item, "kind" | "priority" | "status">) {
  return [
    "cal-entry",
    i.kind === "event" ? `is-event prio-${i.priority}` : `is-task`,
    `tone-${i.status}`,
    i.status === "done" ? "is-done" : "",
  ].join(" ");
}

/** "Event · 9:00 AM · Blocked" style label for screen readers and tooltips. */
export function entryLabel(i: Item) {
  const when =
    i.due_at && !isAllDay(i) ? " · " + timeLabel(new Date(i.due_at)) : "";
  const kind = i.kind === "event" ? "Event" : statusLabels[i.status];
  const team = i.team_name ? " · " + i.team_name : "";
  return `${i.title} (${kind}${when}${team})`;
}

/**
 * Sunday-first month grid. Each week row lays items out in lanes: multi-day
 * items as continuous bars, events as priority-colored bars, tasks as chips
 * with a status dot. Phones show dots instead (the agenda lists the day).
 */
export function MonthView({
  items,
  selected,
  onSelect,
  onOpenDay,
  onOpen,
}: Props) {
  const today = new Date();
  const month = selected.getMonth();
  return (
    <div className="month">
      <div className="month-head" aria-hidden="true">
        {DAY_NAMES.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {monthGrid(selected).map((week) => {
        const { bars, hidden } = layoutWeek(items, week, LANES);
        return (
          <div className="month-week" key={week[0].toISOString()}>
            {week.map((d, c) => {
              const dayItems = itemsForDay(items, d);
              const isSelected = sameDay(d, selected);
              return (
                <button
                  key={d.toISOString()}
                  aria-pressed={isSelected}
                  aria-current={sameDay(d, today) ? "date" : undefined}
                  aria-label={`${d.toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}${sameDay(d, today) ? ", today" : ""}, ${dayItems.length} ${
                    dayItems.length === 1 ? "item" : "items"
                  }`}
                  style={{ gridColumn: c + 1 }}
                  className={
                    "month-cell " +
                    (d.getMonth() !== month ? "outside " : "") +
                    (sameDay(d, today) ? "is-today " : "") +
                    (isSelected ? "is-selected" : "")
                  }
                  onClick={() => onSelect(d)}
                >
                  <span className="month-date">{d.getDate()}</span>
                  {dayItems.length > 0 && (
                    <span className="month-dots" aria-hidden="true">
                      {dayItems.slice(0, 3).map((i) => (
                        <i key={i.id} className={entryClass(i)} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
            {bars.map((b) => {
              const i = b.item;
              const timed = i.due_at && !isAllDay(i) && !b.continuesBefore;
              return (
                <button
                  key={i.id}
                  className={
                    entryClass(i) +
                    " month-bar" +
                    (b.endCol > b.startCol ||
                    b.continuesBefore ||
                    b.continuesAfter
                      ? " is-multi"
                      : "") +
                    (b.continuesBefore ? " cont-before" : "") +
                    (b.continuesAfter ? " cont-after" : "")
                  }
                  style={{
                    gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`,
                    gridRow: b.lane + 2,
                  }}
                  title={entryLabel(i)}
                  aria-label={entryLabel(i)}
                  onClick={() => onOpen(i)}
                >
                  {i.kind === "task" && (
                    <i className="dot" aria-hidden="true" />
                  )}
                  {timed && (
                    <span className="cal-time">
                      {timeLabel(new Date(i.due_at!))}
                    </span>
                  )}
                  <span className="cal-title">{i.title}</span>
                  {i.team_id && (
                    <Users size={10} className="team-mark" aria-hidden="true" />
                  )}
                </button>
              );
            })}
            {hidden.map(
              (n, c) =>
                n > 0 && (
                  <button
                    key={"more-" + c}
                    className="month-more"
                    style={{ gridColumn: c + 1, gridRow: LANES + 2 }}
                    aria-label={`${n} more on ${week[c].toLocaleDateString([], {
                      month: "long",
                      day: "numeric",
                    })}`}
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
