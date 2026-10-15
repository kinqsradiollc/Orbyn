import { useEffect, useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { fromDateTimeLocal, toDateTimeLocal } from "@orbyn/core";
import { useModalFocus } from "../../hooks/useModalFocus";
import { DateField } from "../../components/DateField";

type Props = {
  heading: string;
  /** The task the time is for. */
  subject: string;
  start: Date;
  minutes: number;
  busy?: boolean;
  minimumMinutes?: number;
  minuteStep?: number;
  onRemove?: () => void;
  removeLabel?: string;
  hint?: string;
  error?: string;
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
  minimumMinutes = 5,
  minuteStep = 5,
  onRemove,
  removeLabel = "Remove from plan",
  hint,
  error,
  onSave,
  onClose,
}: Props) {
  const titleId = useId();
  const modal = useModalFocus(onClose, busy);
  const [when, setWhen] = useState(toDateTimeLocal(start.toISOString()));
  const [length, setLength] = useState(String(minutes));
  useEffect(() => {
    const node = modal.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const duration = Number(length);
    if (
      !length.trim() ||
      !Number.isFinite(duration) ||
      duration < minimumMinutes ||
      duration > 1440
    )
      return;
    const iso = fromDateTimeLocal(when);
    if (!iso) return;
    const from = new Date(iso);
    onSave(from, new Date(from.getTime() + duration * 60_000));
  };
  return createPortal(
    <dialog
      ref={(node) => {
        modal.ref.current = node;
      }}
      data-modal-focus={modal.id}
      className="modal modal-small block-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={titleId}>{heading}</h2>
        <button
          className="icon-button"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <form onSubmit={submit}>
        <p className="muted modal-lead">{subject}</p>
        {hint && <p className="field-hint">{hint}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-grid">
          <label>
            Starts
            <DateField
              type="datetime-local"
              disabled={busy}
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
              disabled={busy}
              min={minimumMinutes}
              max={1440}
              step={minuteStep}
              required
              value={length}
              onChange={(e) => setLength(e.target.value)}
            />
          </label>
        </div>
        {onRemove && (
          <details className="block-manage">
            <summary>More actions</summary>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={onRemove}
            >
              {removeLabel}
            </button>
          </details>
        )}
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save time
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
