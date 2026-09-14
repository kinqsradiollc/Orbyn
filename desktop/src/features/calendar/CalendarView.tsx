import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, itemsOnDay, sameDay, type Item } from "@orbyn/core";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  items: Item[];
  month: Date;
  onMonthChange: (month: Date) => void;
  onEdit: (item: Item) => void;
};

/** Fixed six-week (42 cell) month grid starting on Sunday. */
export function CalendarView({ items, month, onMonthChange, onEdit }: Props) {
  const today = new Date();
  const firstWeekday = new Date(
    month.getFullYear(),
    month.getMonth(),
    1,
  ).getDay();
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
            onClick={() => onMonthChange(new Date())}
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
        {Array.from({ length: 42 }, (_, n) => {
          const d = new Date(
            month.getFullYear(),
            month.getMonth(),
            n - firstWeekday + 1,
          );
          return (
            <div
              key={n}
              className={
                "calendar-day " +
                (d.getMonth() !== month.getMonth() ? "outside " : "") +
                (sameDay(d, today) ? "is-today" : "")
              }
            >
              <span>{d.getDate()}</span>
              {itemsOnDay(items, d).map((i) => (
                <button
                  key={i.id}
                  className={i.status === "done" ? "done" : ""}
                  onClick={() => onEdit(i)}
                >
                  {i.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
