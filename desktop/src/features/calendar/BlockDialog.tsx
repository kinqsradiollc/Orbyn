import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { fromDateTimeLocal, toDateTimeLocal } from "@orbyn/core";

type Props = {
  heading: string;
  /** The task the time is for. */
  subject: string;
  start: Date;
  minutes: number;
  busy?: boolean;
  onSave: (start: Date, end: Date) => void;
  onClose: () => void;
};

/** Pick a start and length for a time block (the keyboard way to schedule). */
export function BlockDialog({
  heading,
  subject,
  start,
  minutes,
  busy,
  onSave,
  onClose,
}: Props) {
  const [when, setWhen] = useState(toDateTimeLocal(start.toISOString()));
  const [length, setLength] = useState(minutes);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const iso = fromDateTimeLocal(when);
    if (!iso) return;
    const from = new Date(iso);
    onSave(from, new Date(from.getTime() + length * 60_000));
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <section
        className="modal modal-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-dialog-title"
      >
        <div className="section-heading">
          <h2 id="block-dialog-title">{heading}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit}>
          <p className="muted modal-lead">{subject}</p>
          <div className="form-grid">
            <label>
              Starts
              <input
                type="datetime-local"
                required
                autoFocus
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
            <label>
              Length (minutes)
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                required
                value={length}
                onChange={(e) => setLength(Number(e.target.value) || 30)}
              />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Save time
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
