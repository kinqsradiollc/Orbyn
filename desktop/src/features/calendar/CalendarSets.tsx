import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type {
  CalendarSet,
  CalendarSubscription,
  TaskList,
  Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";

type Props = {
  sets: CalendarSet[];
  teams: Team[];
  lists: TaskList[];
  onSave: (sets: CalendarSet[]) => Promise<void>;
  onClose: () => void;
};

const newSet = (n: number): CalendarSet => ({
  id: `set-${Date.now().toString(36)}-${n}`,
  name: n === 0 ? "Work" : `Set ${n + 1}`,
  personal: true,
  team_ids: [],
  list_ids: [],
  subscription_ids: [],
});

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/**
 * Calendar sets: named views of what the calendar shows (personal items,
 * some teams, some lists, some subscribed calendars). Number keys 1–9
 * switch between them; 0 shows all.
 */
export function CalendarSetsDialog({
  sets,
  teams,
  lists,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<CalendarSet[]>(() =>
    sets.length ? sets : [newSet(0)],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  useEffect(() => {
    client.listCalendarSubscriptions().then(setSubs, () => setSubs([]));
  }, []);
  /** A set from before subscriptions could be picked shows all of them. */
  const subsOf = (s: CalendarSet) =>
    s.subscription_ids ?? subs.map((x) => x.id);
  const update = (id: string, patch: Partial<CalendarSet>) =>
    setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const save = async () => {
    if (draft.some((s) => !s.name.trim())) {
      setError("Give every set a name.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await onSave(draft.map((s) => ({ ...s, name: s.name.trim() })));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <section
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sets-title"
      >
        <div className="section-heading">
          <h2 id="sets-title">Calendar sets</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted modal-lead">
            Each set shows selected calendars. Use number keys to switch; 0
            shows all.
          </p>
          {draft.map((s, n) => (
            <fieldset key={s.id} className="set-card">
              <legend className="sr-only">Set {n + 1}</legend>
              <div className="set-card-head">
                <span className="set-key" aria-hidden="true">
                  {n + 1}
                </span>
                <label className="set-name">
                  <span className="sr-only">Name of set {n + 1}</span>
                  <input
                    value={s.name}
                    maxLength={40}
                    onChange={(e) => update(s.id, { name: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete ${s.name || "set"}`}
                  onClick={() =>
                    setDraft((d) => d.filter((x) => x.id !== s.id))
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="check-grid">
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={s.personal}
                    onChange={(e) =>
                      update(s.id, { personal: e.target.checked })
                    }
                  />
                  Personal items
                </label>
                {teams.map((t) => (
                  <label key={t.id} className="check-line">
                    <input
                      type="checkbox"
                      checked={s.team_ids.includes(t.id)}
                      onChange={() =>
                        update(s.id, { team_ids: toggle(s.team_ids, t.id) })
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
              {lists.length > 0 && (
                <>
                  <small className="field-hint">
                    Only these lists (leave all unticked for any list):
                  </small>
                  <div className="check-grid">
                    {lists.map((l) => (
                      <label key={l.id} className="check-line">
                        <input
                          type="checkbox"
                          checked={s.list_ids.includes(l.id)}
                          onChange={() =>
                            update(s.id, { list_ids: toggle(s.list_ids, l.id) })
                          }
                        />
                        <i
                          className="list-dot"
                          style={{ background: l.color }}
                          aria-hidden="true"
                        />
                        {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
                      </label>
                    ))}
                  </div>
                </>
              )}
              {subs.length > 0 && (
                <>
                  <small className="field-hint">Subscribed calendars:</small>
                  <div className="check-grid">
                    {subs.map((c) => (
                      <label key={c.id} className="check-line">
                        <input
                          type="checkbox"
                          checked={subsOf(s).includes(c.id)}
                          onChange={() =>
                            update(s.id, {
                              subscription_ids: toggle(subsOf(s), c.id),
                            })
                          }
                        />
                        <i
                          className="list-dot"
                          style={{ background: c.color }}
                          aria-hidden="true"
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </fieldset>
          ))}
          {draft.length < 9 && (
            <button
              type="button"
              className="secondary"
              onClick={() => setDraft((d) => [...d, newSet(d.length)])}
            >
              <Plus size={14} /> Add a set
            </button>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="button-row">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={() => void save()}
            >
              {pending ? "Saving…" : "Save sets"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
