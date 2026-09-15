import { describeRrule } from "@orbyn/core";
import {
  rruleFromDraft,
  WEEKDAY_SHORT,
  type RepeatDraft,
  type RepeatFreq,
} from "../lib/planning";

type Props = {
  value: RepeatDraft;
  onChange: (next: RepeatDraft) => void;
  /** Repeating items need a date; say so when there isn't one. */
  hasDate: boolean;
};

const OPTIONS: { id: RepeatFreq; label: string }[] = [
  { id: "none", label: "Does not repeat" },
  { id: "DAILY", label: "Daily" },
  { id: "WEEKDAYS", label: "Every weekday" },
  { id: "WEEKLY", label: "Weekly" },
  { id: "MONTHLY", label: "Monthly" },
  { id: "YEARLY", label: "Yearly" },
];

const UNITS: Partial<Record<RepeatFreq, string>> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
  YEARLY: "years",
};

/** How an item repeats: frequency, every N, weekdays, and when it ends. */
export function RepeatPicker({ value: d, onChange, hasDate }: Props) {
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...d, ...patch });
  const unit = UNITS[d.freq];
  const rule = rruleFromDraft(d);
  return (
    <fieldset className="repeat-picker">
      <legend>Repeat</legend>
      <div className="repeat-row">
        <label>
          <span className="sr-only">How often</span>
          <select
            value={d.freq}
            onChange={(e) => set({ freq: e.target.value as RepeatFreq })}
          >
            {OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {unit && (
          <label className="repeat-every">
            Every
            <input
              type="number"
              min={1}
              max={99}
              value={d.interval}
              onChange={(e) => set({ interval: Number(e.target.value) || 1 })}
            />
            {d.interval === 1 ? unit.slice(0, -1) : unit}
          </label>
        )}
      </div>
      {d.freq === "WEEKLY" && (
        <div className="day-toggles" role="group" aria-label="Repeat on">
          {WEEKDAY_SHORT.map((name, day) => {
            const on = d.byDay.includes(day);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                className={on ? "active" : ""}
                onClick={() => {
                  const next = on
                    ? d.byDay.filter((x) => x !== day)
                    : [...d.byDay, day].sort();
                  if (next.length) set({ byDay: next });
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
      {d.freq !== "none" && (
        <div className="repeat-row">
          <label>
            Ends
            <select
              value={d.ends}
              onChange={(e) =>
                set({ ends: e.target.value as RepeatDraft["ends"] })
              }
            >
              <option value="never">Never</option>
              <option value="count">After a number of times</option>
              <option value="until">On a date</option>
            </select>
          </label>
          {d.ends === "count" && (
            <label>
              Times
              <input
                type="number"
                min={1}
                max={999}
                value={d.count}
                onChange={(e) => set({ count: Number(e.target.value) || 1 })}
              />
            </label>
          )}
          {d.ends === "until" && (
            <label>
              Last date
              <input
                type="date"
                required
                value={d.until}
                onChange={(e) => set({ until: e.target.value })}
              />
            </label>
          )}
        </div>
      )}
      {rule && (
        <small className="field-hint">
          {describeRrule(rule)}
          {!hasDate && " · Add a date so it knows when to start."}
        </small>
      )}
    </fieldset>
  );
}
