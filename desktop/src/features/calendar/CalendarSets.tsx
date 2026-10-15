import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { Plus, Trash2, X } from "lucide-react";
import type {
  CalendarSet,
  CalendarSubscription,
  TaskList,
  Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
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
  const accountAtRender = session.get();
  const [expanded, setExpanded] = useState<string | null>(
    () => draft[0]?.id ?? null,
  );
  const [query, setQuery] = useState("");
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const titleId = useId();
  const savePending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const focus = useModalFocus(onClose, pending);
  const [subsError, setSubsError] = useState("");
  const [subsLoading, setSubsLoading] = useState(true);
  const [subsVersion, setSubsVersion] = useState(0);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  useEffect(() => {
    let active = true;
    const account = session.get();
    const current = () => active && alive.current && account === session.get();
    setSubsLoading(true);
    setSubsError("");
    client.listCalendarSubscriptions().then(
      (next) => {
        if (current()) {
          setSubs(next);
          setSubsLoading(false);
        }
      },
      (error) => {
        if (current()) {
          setSubsError(errorText(error));
          setSubsLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [subsVersion]);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  /** A set from before subscriptions could be picked shows all of them. */
  const subsOf = (s: CalendarSet) =>
    s.subscription_ids ?? subs.map((x) => x.id);
  const update = (id: string, patch: Partial<CalendarSet>) => {
    if (!pending)
      setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const save = async () => {
    if (
      savePending.current ||
      !alive.current ||
      session.get() !== accountAtRender
    )
      return;
    const unnamed = draft.find((s) => !s.name.trim());
    if (unnamed) {
      setExpanded(unnamed.id);
      setError("Give every set a name.");
      return;
    }
    const account = accountAtRender;
    const current = () => alive.current && account === session.get();
    savePending.current = true;
    setPending(true);
    setError("");
    try {
      await onSave(draft.map((s) => ({ ...s, name: s.name.trim() })));
      if (current()) onClose();
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      savePending.current = false;
      if (current()) setPending(false);
    }
  };

  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      className="modal modal-wide calendar-sets-dialog"
      data-modal-focus={focus.id}
      aria-labelledby={titleId}
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={titleId}>Calendar sets</h2>
        <button
          className="icon-button"
          aria-label="Close"
          disabled={pending}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">
        <p className="muted modal-lead">Choose calendars for each set.</p>
        <details className="sets-help">
          <summary>Keyboard shortcuts</summary>
          <p className="field-hint">
            Keys 1–9 switch sets; 0 shows all calendars.
          </p>
        </details>
        {subsLoading && (
          <p className="field-hint" role="status">
            Loading subscribed calendars…
          </p>
        )}
        {subsError && (
          <div className="error" role="alert">
            {subsError}
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => setSubsVersion((v) => v + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {draft.map((s, n) => (
          <details
            key={s.id}
            className="set-group"
            open={expanded === s.id}
            onToggle={(event) => {
              if (event.currentTarget.open) setExpanded(s.id);
              else
                setExpanded((current) => (current === s.id ? null : current));
            }}
          >
            <summary>
              <span className="set-key" aria-hidden="true">
                {n + 1}
              </span>
              <span>{s.name || "Unnamed set"}</span>
            </summary>
            <fieldset className="set-card" disabled={pending}>
              <legend className="sr-only">Set {n + 1}</legend>
              <div className="set-card-head">
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
                  onClick={() => {
                    setDraft((d) => d.filter((x) => x.id !== s.id));
                    if (expanded === s.id) setExpanded(null);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <label className="set-search">
                <span className="sr-only">
                  Find calendars in {s.name || "this set"}
                </span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find calendars"
                />
              </label>
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
                {teams
                  .filter((t) => matches(t.name))
                  .map((t) => (
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
                <details
                  className="set-options"
                  open={query.trim() ? true : undefined}
                >
                  <summary>
                    Lists ·{" "}
                    {s.list_ids.length
                      ? `${s.list_ids.length} selected`
                      : "All"}
                  </summary>
                  <small className="field-hint">
                    No selection includes every list.
                  </small>
                  <div className="check-grid">
                    {lists
                      .filter((l) => matches(`${l.name} ${l.team_name ?? ""}`))
                      .map((l) => (
                        <label key={l.id} className="check-line">
                          <input
                            type="checkbox"
                            checked={s.list_ids.includes(l.id)}
                            onChange={() =>
                              update(s.id, {
                                list_ids: toggle(s.list_ids, l.id),
                              })
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
                </details>
              )}
              {subs.length > 0 && (
                <details
                  className="set-options"
                  open={query.trim() ? true : undefined}
                >
                  <summary>
                    Subscribed calendars · {subsOf(s).length} selected
                  </summary>
                  <div className="check-grid">
                    {subs
                      .filter((c) => matches(c.name))
                      .map((c) => (
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
                </details>
              )}
            </fieldset>
          </details>
        ))}
        {draft.length < 9 && (
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => {
              const next = newSet(draft.length);
              setDraft((d) => [...d, next]);
              setExpanded(next.id);
              setQuery("");
            }}
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
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onClose}
          >
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
    </dialog>,
    document.body,
  );
}
