import { useState } from "react";
import { Eye, Trash2, X } from "lucide-react";
import {
  freshItem,
  fromDateTimeLocal,
  hasTeamPermission,
  toDateTimeLocal,
  type Item,
  type ItemInput,
  type Kind,
  type Priority,
  type Team,
} from "@orbyn/core";

type Props = {
  editing: Item | "new";
  /** Your teams; the "Share with" picker offers those you can write to. */
  teams: Team[];
  /** Prefilled team for new items created from a team page. */
  defaultTeamId?: string | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (data: ItemInput) => void;
  onDelete: () => void;
};

/**
 * Create/edit modal. Submits the full `ItemInput` (including `team_id`); the
 * caller adds the version. Team items you can only view (viewer role) open
 * read-only.
 */
export function ItemEditor({
  editing,
  teams,
  defaultTeamId = null,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const existing = editing === "new" ? null : editing;
  const isNew = !existing;
  const base: ItemInput = existing ?? {
    ...freshItem(),
    team_id: defaultTeamId,
  };
  const [teamId, setTeamId] = useState<string | null>(base.team_id ?? null);

  const currentTeam = base.team_id
    ? teams.find((t) => t.id === base.team_id)
    : undefined;
  const teamName = currentTeam?.name ?? existing?.team_name ?? "this team";
  const readOnly =
    !!base.team_id && !hasTeamPermission(currentTeam?.role, "items:write");
  // Moving an item out of a team (to personal or another team) needs
  // member-management rights in the team it leaves.
  const lockTeam =
    readOnly ||
    (!isNew &&
      !!base.team_id &&
      !hasTeamPermission(currentTeam?.role, "members:manage"));
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const shareOptions =
    base.team_id && !writable.some((t) => t.id === base.team_id)
      ? [{ id: base.team_id, name: teamName }, ...writable]
      : writable;

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
            {readOnly
              ? "View plan"
              : isNew
                ? "Make a little plan"
                : "Edit your plan"}
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
            if (readOnly) return;
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
              team_id: teamId,
            });
          }}
        >
          {readOnly && (
            <p className="view-only-note">
              <Eye size={14} /> View only — you&apos;re a viewer in {teamName}.
            </p>
          )}
          <fieldset className="plain-fieldset" disabled={readOnly}>
            <label>
              What’s the plan?
              <input
                autoFocus={!readOnly}
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
            <div className="form-grid">
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
              <label>
                Share with
                <select
                  name="team_id"
                  value={teamId ?? ""}
                  disabled={lockTeam}
                  onChange={(e) => setTeamId(e.target.value || null)}
                >
                  <option value="">Personal</option>
                  {shareOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {lockTeam && !readOnly && (
                  <small className="field-hint">
                    Only owners and admins can move items out of {teamName}.
                  </small>
                )}
              </label>
            </div>
          </fieldset>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="button-row">
            {!isNew && !readOnly && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this item?")) onDelete();
                }}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save item"}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
