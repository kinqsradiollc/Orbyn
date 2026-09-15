import { WEEKDAY_SHORT } from "../lib/planning";

/** Toggle buttons for weekdays (0 = Sunday). */
export function DayPicker({
  value,
  onChange,
  label,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  label: string;
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
