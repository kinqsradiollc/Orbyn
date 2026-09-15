import type { CSSProperties } from "react";
import { Lock, Users } from "lucide-react";
import {
  monthGrid,
  sameDay,
  statusLabels,
  type FrameOccurrence,
  type Item,
  type TaskList,
} from "@orbyn/core";
import { usePlanning } from "../../app/planning";
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
  onOpen: (item: Item, anchor?: DOMRect) => void;
  /** Frames on these days, shown as small marks beside the date. */
  frames?: FrameOccurrence[];
};

/** Colors and markers for an item in any calendar view. */
export function entryClass(
  i: Pick<Item, "kind" | "priority" | "status" | "busy" | "all_day">,
) {
  return [
    "cal-entry",
    i.kind === "event" ? `is-event prio-${i.priority}` : `is-task`,
    `tone-${i.status}`,
    i.status === "done" ? "is-done" : "",
    // Free events are drawn lighter; all-day ones are never busy anyway.
    i.kind === "event" && i.busy === false && !i.all_day ? "is-free" : "",
  ].join(" ");
}

/**
 * Colour-coding by list: a `has-list` class and the list's colour as
 * `--list` (calendar.css), or nothing for items outside a list.
 */
export function listLook(
  listId: string | null | undefined,
  lists: Map<string, TaskList>,
  /** The item's own colour, which wins over its list's. */
  own?: string | null,
): { className: string; style?: CSSProperties } {
  const color = own || (listId ? lists.get(listId)?.color : undefined);
  return color
    ? { className: " has-list", style: { "--list": color } as CSSProperties }
    : { className: "" };
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
 * items as continuous bars, events as bars in their list's colour (else
 * their priority's), tasks as chips with a status dot. Phones show dots
 * instead (the agenda lists the day).
 */
export function MonthView({
  items,
  selected,
  onSelect,
  onOpenDay,
  onOpen,
  frames = [],
}: Props) {
  const { listById } = usePlanning();
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
              const dayFrames = frames.filter((f) =>
                sameDay(new Date(f.start_at), d),
              );
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
                  }${
                    dayFrames.length
                      ? ", frames: " + dayFrames.map((f) => f.name).join(", ")
                      : ""
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
                  {dayFrames.length > 0 && (
                    <span className="month-frames" aria-hidden="true">
                      {dayFrames.slice(0, 3).map((f) => (
                        <i
                          key={f.frame_id + f.start_at}
                          style={{ background: f.color }}
                        />
                      ))}
                    </span>
                  )}
                  {dayItems.length > 0 && (
                    <span className="month-dots" aria-hidden="true">
                      {dayItems.slice(0, 3).map((i) => {
                        const look = listLook(i.list_id, listById, i.color);
                        return (
                          <i
                            key={i.id}
                            className={entryClass(i) + look.className}
                            style={look.style}
                          />
                        );
                      })}
                    </span>
                  )}
                </button>
              );
            })}
            {bars.map((b) => {
              const i = b.item;
              const timed = i.due_at && !isAllDay(i) && !b.continuesBefore;
              const look = listLook(i.list_id, listById, i.color);
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
                    (b.continuesAfter ? " cont-after" : "") +
                    look.className
                  }
                  style={{
                    gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`,
                    gridRow: b.lane + 2,
                    ...look.style,
                  }}
                  title={entryLabel(i)}
                  aria-label={entryLabel(i)}
                  onClick={(e) =>
                    onOpen(i, e.currentTarget.getBoundingClientRect())
                  }
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
                  {i.id.startsWith("x:") && (
                    <Lock size={10} className="team-mark" aria-hidden="true" />
                  )}
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
