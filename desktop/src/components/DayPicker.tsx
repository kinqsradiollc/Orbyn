import { WEEKDAY_SHORT } from "../features/planner/planning";

/** Toggle buttons for weekdays (0 = Sunday). */
export function DayPicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="day-toggles" role="group" aria-label={label}>
      {WEEKDAY_SHORT.map((name, day) => {
        const on = value.includes(day);
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            aria-label={
              [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ][day]
            }
            disabled={disabled}
            className={on ? "active" : ""}
            onClick={() =>
              onChange(
                on
                  ? value.filter((d) => d !== day)
                  : [...value, day].sort((a, b) => a - b),
              )
            }
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
