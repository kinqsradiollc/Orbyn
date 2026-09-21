import { Select } from "../components/Select";
import { useState, type KeyboardEvent } from "react";
import { Check, Plus, X } from "lucide-react";
import type { AttendeeStatus } from "@orbyn/core";
import { plural, SWATCHES } from "../lib/planning";
import "./event-fields.css";

/** Minutes-before choices offered first. */
const ALERT_PRESETS = [0, 5, 10, 15, 30, 60, 1440];
const MAX_ALERTS = 5;
/** Four weeks, the longest alert the server takes. */
const MAX_ALERT_MINUTES = 40320;
const UNITS = { min: 1, hours: 60, days: 1440 } as const;

/** "At the time", "15 min before", "1 hour before", "2 days before". */
export function alertLabel(minutes: number) {
  if (minutes === 0) return "At the time";
  if (minutes % 1440 === 0) return `${plural(minutes / 1440, "day")} before`;
  if (minutes % 60 === 0) return `${plural(minutes / 60, "hour")} before`;
  return `${minutes} min before`;
}

/** Enter in a small add row adds instead of submitting the editor. */
const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
    e.preventDefault();
    fn();
  }
};

/** Up to five alerts: presets, or a custom number of minutes, hours or days. */
export function AlertsPicker({
  value,
  onChange,
  hint,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  /** Shown under the list, e.g. that these are your defaults. */
  hint?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState("30");
  const [amount, setAmount] = useState(20);
  const [unit, setUnit] = useState<keyof typeof UNITS>("min");
  const free = ALERT_PRESETS.filter((m) => !value.includes(m));

  const add = () => {
    const minutes =
      choice === "custom"
        ? Math.min(MAX_ALERT_MINUTES, Math.max(0, amount * UNITS[unit]))
        : Number(choice);
    onChange([...new Set([...value, minutes])].sort((a, b) => a - b));
    setAdding(false);
  };

  return (
    <fieldset className="event-field">
      <legend>Alerts</legend>
      {value.length ? (
        <ul className="event-chips">
          {value.map((m) => (
            <li key={m} className="chip">
              {alertLabel(m)}
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove the alert ${alertLabel(m)}`}
                onClick={() => onChange(value.filter((x) => x !== m))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No reminder.</p>
      )}
      {adding ? (
        <div className="event-add-row">
          <Select
            aria-label="When to remind"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {free.map((m) => (
              <option key={m} value={m}>
                {alertLabel(m)}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
          {choice === "custom" && (
            <>
              <input
                type="number"
                min={1}
                max={999}
                aria-label="How many"
                value={amount}
                onKeyDown={onEnter(add)}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
              <Select
                aria-label="Unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as keyof typeof UNITS)}
              >
                <option value="min">minutes before</option>
                <option value="hours">hours before</option>
                <option value="days">days before</option>
              </Select>
            </>
          )}
          <button type="button" className="secondary" onClick={add}>
            Add
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        value.length < MAX_ALERTS && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setChoice(free.length ? String(free[0]) : "custom");
              setAdding(true);
            }}
          >
            <Plus size={13} /> Add alert
          </button>
        )
      )}
      {hint && <small className="field-hint">{hint}</small>}
    </fieldset>
  );
}

/** Someone invited, with their answer once the event is saved. */
export type Invitee = { email: string; name?: string; status?: AttendeeStatus };

const RSVP_LABELS: Record<AttendeeStatus, string> = {
  needs_action: "No answer yet",
  accepted: "Going",
  tentative: "Maybe",
  declined: "Not going",
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** People invited to an event by email, with their answers. */
export function InviteesPicker({
  value,
  onChange,
  state,
}: {
  value: Invitee[];
  onChange: (next: Invitee[]) => void;
  /** Saved invitees load with the event; they can't be changed until then. */
  state: "loading" | "ready" | "failed";
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) return setError("Enter an email address.");
    if (value.some((v) => v.email === address))
      return setError("They're already invited.");
    if (value.length >= 50) return setError("Up to 50 people.");
    onChange([...value, { email: address, name: name.trim() || undefined }]);
    setEmail("");
    setName("");
    setError("");
  };

  return (
    <fieldset className="event-field" disabled={state !== "ready"}>
      <legend>Invitees</legend>
      {state === "loading" ? (
        <p className="field-hint">Loading who&apos;s invited…</p>
      ) : state === "failed" ? (
        <p className="field-hint">
          Couldn&apos;t load who&apos;s invited. They stay as they are.
        </p>
      ) : (
        value.length > 0 && (
          <ul className="event-chips invitees">
            {value.map((v) => (
              <li key={v.email} className="chip">
                <span>
                  {v.name ? (
                    <>
                      <strong>{v.name}</strong> {v.email}
                    </>
                  ) : (
                    v.email
                  )}
                </span>
                {v.status && (
                  <span className={"rsvp-chip is-" + v.status}>
                    {RSVP_LABELS[v.status]}
                  </span>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${v.name || v.email}`}
                  onClick={() =>
                    onChange(value.filter((x) => x.email !== v.email))
                  }
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <div className="event-add-row">
        <input
          type="email"
          placeholder="name@example.com"
          aria-label="Email to invite"
          value={email}
          maxLength={254}
          onKeyDown={onEnter(add)}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Name (optional)"
          aria-label="Their name (optional)"
          value={name}
          maxLength={120}
          onKeyDown={onEnter(add)}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="secondary" onClick={add}>
          <Plus size={13} /> Invite
        </button>
      </div>
      {error && (
        <small className="field-hint" role="alert">
          {error}
        </small>
      )}
      <small className="field-hint">
        They get an email invitation and answer from a link, no account needed.
      </small>
    </fieldset>
  );
}

/** The item's own calendar colour, from the list and tag colours, or none. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const current = value?.toLowerCase() ?? null;
  return (
    <fieldset className="event-field">
      <legend>Colour on the calendar</legend>
      <div
        className="swatches event-colors"
        role="radiogroup"
        aria-label="Colour"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!current}
          aria-label="No colour of its own (use its list's)"
          title="None"
          className={"swatch-none" + (!current ? " active" : "")}
          onClick={() => onChange(null)}
        >
          <X size={11} aria-hidden="true" />
        </button>
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={current === c}
            aria-label={c}
            className={current === c ? "active" : ""}
            style={{ background: c }}
            onClick={() => onChange(c)}
          >
            {current === c && <Check size={11} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
