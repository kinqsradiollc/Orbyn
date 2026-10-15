import { useEffect, useState } from "react";
import { Select } from "../components/Select";
import { describeRrule } from "@orbyn/core";
import {
  rruleFromDraft,
  WEEKDAY_SHORT,
  type RepeatDraft,
  type RepeatFreq,
} from "../lib/planning";
import { DateField } from "./DateField";

type Props = {
  value: RepeatDraft;
  onChange: (next: RepeatDraft) => void;
  /** Repeating items need a date; say so when there isn't one. */
  hasDate: boolean;
  originalRule?: string | null;
  onProblem?: (problem: string | null) => void;
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
export function RepeatPicker({
  value: d,
  onChange,
  hasDate,
  originalRule,
  onProblem,
}: Props) {
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...d, ...patch });
  const unit = UNITS[d.freq];
  const [intervalText, setIntervalText] = useState(String(d.interval));
  const [countText, setCountText] = useState(String(d.count));
  useEffect(() => setIntervalText(String(d.interval)), [d.interval]);
  useEffect(() => setCountText(String(d.count)), [d.count]);
  const valid = (text: string, max: number) =>
    !!text.trim() &&
    Number.isInteger(Number(text)) &&
    Number(text) >= 1 &&
    Number(text) <= max;
  const problem =
    unit && !valid(intervalText, 99)
      ? "Use a whole repeat interval from 1 to 99."
      : d.freq !== "none" && d.ends === "count" && !valid(countText, 999)
        ? "Use a whole repeat count from 1 to 999."
        : null;
  useEffect(() => {
    onProblem?.(problem);
  }, [problem, onProblem]);
  const rule = originalRule ?? rruleFromDraft(d);
  return (
    <fieldset className="repeat-picker">
      <legend>Repeat</legend>
      <div className="repeat-row">
        <label>
          <span className="sr-only">How often</span>
          <Select
            value={d.freq}
            onChange={(e) => set({ freq: e.target.value as RepeatFreq })}
          >
            {OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        {unit && (
          <label className="repeat-every">
            Every
            <input
              type="number"
              min={1}
              max={99}
              required
              step={1}
              value={intervalText}
              onChange={(event) => {
                const text = event.target.value;
                setIntervalText(text);
                onProblem?.(
                  valid(text, 99)
                    ? null
                    : "Use a whole repeat interval from 1 to 99.",
                );
                if (valid(text, 99)) set({ interval: Number(text) });
              }}
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
                disabled={on && d.byDay.length === 1}
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
            <Select
              value={d.ends}
              onChange={(e) =>
                set({ ends: e.target.value as RepeatDraft["ends"] })
              }
            >
              <option value="never">Never</option>
              <option value="count">After a number of times</option>
              <option value="until">On a date</option>
            </Select>
          </label>
          {d.ends === "count" && (
            <label>
              Times
              <input
                type="number"
                min={1}
                max={999}
                required
                step={1}
                value={countText}
                onChange={(event) => {
                  const text = event.target.value;
                  setCountText(text);
                  onProblem?.(
                    valid(text, 999)
                      ? null
                      : "Use a whole repeat count from 1 to 999.",
                  );
                  if (valid(text, 999)) set({ count: Number(text) });
                }}
              />
            </label>
          )}
          {d.ends === "until" && (
            <label>
              Last date
              <DateField
                type="date"
                required
                value={d.until}
                onChange={(e) => set({ until: e.target.value })}
              />
            </label>
          )}
        </div>
      )}
      {!!problem && (
        <small className="field-hint" role="alert">
          {problem}
        </small>
      )}
      {rule && (
        <small className="field-hint">
          {describeRrule(rule)}
          {!hasDate && " · Add a start date."}
        </small>
      )}
    </fieldset>
  );
}
