import { measureLabel, measureProgress } from "@orbyn/core";

export type Measure = {
  target: string;
  current: string;
  unit: string;
};

/** Numbers as typed into the fields, or null when left empty. */
export const measureValues = (m: Measure) => {
  const num = (s: string) =>
    s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s);
  const target = num(m.target);
  return {
    target_value: target,
    current_value: target === null ? null : (num(m.current) ?? 0),
    value_unit: target === null ? "" : m.unit.trim().slice(0, 16),
  };
};

export const measureFrom = (i: {
  target_value?: number | null;
  current_value?: number | null;
  value_unit?: string;
}): Measure => ({
  target: i.target_value == null ? "" : String(i.target_value),
  current: i.current_value == null ? "" : String(i.current_value),
  unit: i.value_unit ?? "",
});

/**
 * A number the task moves towards — a key result such as "signups: 320 of
 * 500". While there's a target, progress follows it.
 */
export function MeasureField({
  value,
  onChange,
  readOnly,
}: {
  value: Measure;
  onChange: (next: Measure) => void;
  readOnly?: boolean;
}) {
  const set = (patch: Partial<Measure>) => onChange({ ...value, ...patch });
  const numbers = measureValues(value);
  const pct = measureProgress(numbers);
  return (
    <fieldset className="measure-field">
      <legend>Number to reach</legend>
      <div className="measure-row">
        <label>
          Now
          <input
            type="number"
            inputMode="decimal"
            value={value.current}
            placeholder="0"
            disabled={readOnly || value.target.trim() === ""}
            onChange={(e) => set({ current: e.target.value })}
          />
        </label>
        <label>
          Target
          <input
            type="number"
            inputMode="decimal"
            value={value.target}
            placeholder="None"
            disabled={readOnly}
            onChange={(e) => set({ target: e.target.value })}
          />
        </label>
        <label>
          Unit
          <input
            value={value.unit}
            maxLength={16}
            placeholder="signups"
            disabled={readOnly || value.target.trim() === ""}
            onChange={(e) => set({ unit: e.target.value })}
          />
        </label>
      </div>
      <small className="muted">
        {pct === null
          ? "For a key result: progress follows the number."
          : `${measureLabel(numbers)} · ${pct}%`}
      </small>
    </fieldset>
  );
}
