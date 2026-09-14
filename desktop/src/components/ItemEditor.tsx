import { Trash2, X } from "lucide-react";
import {
  freshItem,
  fromDateTimeLocal,
  toDateTimeLocal,
  type Item,
  type ItemInput,
  type Kind,
  type Priority,
} from "@orbyn/core";

type Props = {
  editing: Item | "new";
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (data: ItemInput) => void;
  onDelete: () => void;
};

/** Create/edit modal. Submits the full `ItemInput`; the caller adds the version. */
export function ItemEditor({
  editing,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const isNew = editing === "new";
  const base = isNew ? freshItem() : editing;
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
      >
        <div className="section-heading">
          <h2 id="edit-title">
            {isNew ? "Make a little plan" : "Edit your plan"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close editor"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            onSave({
              title: String(d.get("title")),
              notes: String(d.get("notes")),
              kind: d.get("kind") as Kind,
              priority: d.get("priority") as Priority,
              status: base.status,
              due_at: fromDateTimeLocal(d.get("due_at") as string | null),
              end_at: fromDateTimeLocal(d.get("end_at") as string | null),
              reminder_minutes: Number(d.get("reminder_minutes")),
            });
          }}
        >
          <label>
            What’s the plan?
            <input
              autoFocus
              required
              name="title"
              maxLength={200}
              defaultValue={base.title}
              placeholder="Something worth making time for"
            />
          </label>
          <div className="form-grid">
            <label>
              Type
              <select name="kind" defaultValue={base.kind}>
                <option value="task">Task</option>
                <option value="event">Event</option>
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue={base.priority}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Due / start time
              <input
                name="due_at"
                type="datetime-local"
                defaultValue={toDateTimeLocal(base.due_at)}
              />
            </label>
            <label>
              End time (optional)
              <input
                name="end_at"
                type="datetime-local"
                defaultValue={toDateTimeLocal(base.end_at)}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea
              name="notes"
              rows={3}
              maxLength={10000}
              defaultValue={base.notes}
              placeholder="A few details, a big idea…"
            />
          </label>
          <label>
            Remind me before (minutes)
            <input
              name="reminder_minutes"
              type="number"
              min={0}
              max={10080}
              defaultValue={base.reminder_minutes}
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="button-row">
            {!isNew && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm("Delete this item?")) onDelete();
                }}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save item"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
