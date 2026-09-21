import { Select } from "../../components/Select";
import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { alertLabel } from "../../components/EventFields";

/** Offered reminder times, in minutes before the meeting (10 to 10080). */
const PRESETS = [10, 30, 60, 120, 1440, 2880, 10080];
const MAX_REMINDERS = 3;

/** Up to three emails to the booker before the meeting. */
export function RemindersField({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState("");
  const free = PRESETS.filter((m) => !value.includes(m));
  return (
    <fieldset className="check-group">
      <legend>Reminder emails to the booker</legend>
      {value.length ? (
        <ul className="chip-list">
          {[...value]
            .sort((a, b) => b - a)
            .map((m) => (
              <li key={m} className="chip">
                {alertLabel(m)}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove the reminder ${alertLabel(m)}`}
                  onClick={() => onChange(value.filter((x) => x !== m))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
        </ul>
      ) : (
        <p className="field-hint">No reminders.</p>
      )}
      {value.length < MAX_REMINDERS && free.length > 0 && (
        <div className="field-row">
          <label className="sr-only" htmlFor={id}>
            Add a reminder
          </label>
          <Select
            id={id}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Add a reminder…</option>
            {free.map((m) => (
              <option key={m} value={m}>
                {alertLabel(m)}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="secondary"
            disabled={!choice}
            onClick={() => {
              onChange([...value, Number(choice)]);
              setChoice("");
            }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      )}
      <small className="field-hint">
        Up to three, each with the link to change or cancel.
      </small>
    </fieldset>
  );
}
