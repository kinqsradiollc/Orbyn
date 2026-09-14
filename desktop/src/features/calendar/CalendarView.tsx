import { Fragment, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  monthGrid,
  byDueDate,
  addMonths,
  dateLabel,
  dayHeading,
  emptyDay,
  itemsOnDay,
  sameDay,
  type Item,
} from "@orbyn/core";
import { stagger } from "../../lib/motion";
import "./calendar.css";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  items: Item[];
  month: Date;
  onMonthChange: (month: Date) => void;
  onEdit: (item: Item) => void;
};

/**
 * Sunday-first month grid built from the shared `monthGrid`, like mobile.
 * Wide screens list item titles inside each day. On phones the days show dots
 * instead, and the selected day's items are listed under the grid, matching
 * the mobile calendar.
 */
export function CalendarView({ items, month, onMonthChange, onEdit }: Props) {
  const today = new Date();
  const [selected, setSelected] = useState(today);

  // Keep the selected day inside the month being shown.
  useEffect(() => {
    setSelected((current) =>
      current.getMonth() === month.getMonth() &&
      current.getFullYear() === month.getFullYear()
        ? current
        : sameDay(new Date(month.getFullYear(), month.getMonth(), 1), today) ||
            (today.getMonth() === month.getMonth() &&
              today.getFullYear() === month.getFullYear())
          ? today
          : new Date(month.getFullYear(), month.getMonth(), 1),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const selectedItems = itemsOnDay(items, selected).sort(byDueDate);

  return (
    <section className="card calendar">
      <div className="section-heading">
        <h2>
          {month.toLocaleDateString([], { month: "long", year: "numeric" })}
        </h2>
        <div>
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="text-button"
            onClick={() => {
              onMonthChange(new Date());
              setSelected(new Date());
            }}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {DAY_NAMES.map((d) => (
          <div className="day-name" key={d}>
            {d}
          </div>
        ))}
        {monthGrid(month)
          .flat()
          .map((d) => {
            const dayItems = itemsOnDay(items, d).sort(byDueDate);
            const isSelected = sameDay(d, selected);
            const select = () => {
              setSelected(d);
              if (d.getMonth() !== month.getMonth())
                onMonthChange(new Date(d.getFullYear(), d.getMonth(), 1));
            };
            return (
              <div
                key={d.toISOString()}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${d.toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}, ${dayItems.length} ${dayItems.length === 1 ? "item" : "items"}`}
                onClick={select}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select();
                  }
                }}
                className={
                  "calendar-day " +
                  (d.getMonth() !== month.getMonth() ? "outside " : "") +
                  (sameDay(d, today) ? "is-today " : "") +
                  (isSelected ? "is-selected" : "")
                }
              >
                <span>{d.getDate()}</span>
                {dayItems.map((i) => (
                  <button
                    key={i.id}
                    className={i.status === "done" ? "done" : ""}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(i);
                    }}
                  >
                    {i.title}
                  </button>
                ))}
                {dayItems.length > 0 && (
                  <div className="calendar-dots" aria-hidden="true">
                    {dayItems.slice(0, 3).map((i) => (
                      <i
                        key={i.id}
                        className={i.status === "done" ? "done" : ""}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <div className="calendar-agenda" aria-live="polite">
        <Fragment key={selected.toDateString()}>
          <h3 className="fade-in">
            {dayHeading(selected)}
            <span>{selectedItems.length}</span>
          </h3>
          {selectedItems.length === 0 ? (
            <p className="fade-in">
              <strong>{emptyDay.title}</strong> {emptyDay.body}
            </p>
          ) : (
            selectedItems.map((i, n) => (
              <button
                key={i.id}
                className={
                  "calendar-agenda-item fade-up stagger " +
                  (i.status === "done" ? "done" : "")
                }
                style={stagger(n)}
                onClick={() => onEdit(i)}
              >
                <strong>{i.title}</strong>
                <small>
                  {dateLabel(i.due_at)}
                  {i.kind === "event" ? " · Event" : ""}
                  {i.team_name ? " · " + i.team_name : ""}
                </small>
              </button>
            ))
          )}
        </Fragment>
      </div>
    </section>
  );
}
