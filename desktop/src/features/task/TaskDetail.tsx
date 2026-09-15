import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  Crosshair,
  Eye,
  MapPin,
  Video,
  ListChecks,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  dateLabel,
  sameDay,
  statusLabels,
  statusOrder,
  type HttpError,
  type Item,
  type ItemDetail,
  type ItemStep,
  type Status,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { celebrate } from "../../lib/celebrate";
import { stagger } from "../../lib/motion";
import { progressOf, timeAgo } from "../../lib/tasks";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusPill } from "../../components/StatusPill";
import { ItemFacts } from "../../components/ItemFacts";
import "./task.css";

type Props = {
  /** The task as listed; the panel loads its checklist and timeline. */
  item: Item;
  /** Team name for team items (falls back to `item.team_name`). */
  teamName?: string | null;
  /** False for viewers of a team item: everything is read-only. */
  canWrite: boolean;
  /** True while another dialog (the item editor) sits on top. */
  suspended?: boolean;
  onClose: () => void;
  onEdit: (item: Item) => void;
  /** Opens focus mode for this task. */
  onFocus?: (item: Item) => void;
  /** Refresh the planner after a change. */
  onChanged: () => Promise<void>;
  /** Planner error handler (signs out on 401). */
  onError: (e: unknown) => void;
};

const SNAPS = [0, 25, 50, 75, 100];

/** "Sep 20, 9:00 AM → 11:00 AM", or across days "Sep 20, 9:00 AM → Sep 22, 5:00 PM". */
function timeRange(start: string | null, end: string | null) {
  if (!start) return "No date";
  if (!end) return dateLabel(start);
  const endLabel = sameDay(new Date(start), new Date(end))
    ? new Date(end).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : dateLabel(end);
  return `${dateLabel(start)} → ${endLabel}`;
}

/**
 * Task detail: a right-side drawer on wide screens and a full-screen sheet on
 * narrow ones. Status, progress, checklist and the updates timeline. Every
 * change returns the fresh `ItemDetail`, then the planner list refreshes.
 * Render it keyed by the item id so switching tasks starts fresh.
 */
export function TaskDetail({
  item,
  teamName,
  canWrite,
  suspended,
  onClose,
  onEdit,
  onFocus,
  onChanged,
  onError,
}: Props) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [newStep, setNewStep] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [nextStatus, setNextStatus] = useState<Status | "">("");
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onError });
  latest.current = { onError };

  // Reload when the task changes elsewhere: an edit bumps the version; a
  // teammate's step or update changes the counts on the next list refresh.
  const reloadKey = [
    item.id,
    item.version,
    item.status,
    item.steps_done,
    item.steps_total,
    item.updates_count,
    item.last_update_at,
  ].join("|");
  useEffect(() => {
    let alive = true;
    client.getItem(item.id).then(
      (d) => alive && setDetail(d),
      (e) => {
        if (!alive) return;
        setError((e as Error).message);
        latest.current.onError(e);
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadKey, item.id]);

  // Focus the panel on open; give focus back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => {
      clearTimeout(timer.current);
      opener?.focus?.();
    };
  }, []);

  // Escape closes; Tab stays inside the panel.
  useEffect(() => {
    if (suspended) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (renaming) return;
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [suspended, renaming, onClose]);

  const current: Item = detail ?? item;
  const steps = (detail?.steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const updates = detail?.updates ?? [];
  const stepsDone = detail
    ? steps.filter((s) => s.done).length
    : (item.steps_done ?? 0);
  const stepsTotal = detail ? steps.length : (item.steps_total ?? 0);
  const progress = draft ?? progressOf(current);
  const team = current.team_id ? (teamName ?? current.team_name) : null;

  /** Run a change, keep the fresh detail, then refresh the planner. */
  const run = async (fn: () => Promise<ItemDetail>) => {
    setPending(true);
    setError("");
    try {
      const before = (detail ?? item).status;
      const next = await fn();
      setDetail(next);
      // A status change, an update or the last checklist step can finish it.
      if (next.status === "done" && before !== "done") celebrate();
      await onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      if ((e as HttpError).status === 401) onError(e);
      // A 409 means the server state moved on (e.g. steps were added): reload.
      if ((e as HttpError).status === 409)
        client.getItem(item.id).then(setDetail, () => undefined);
      return false;
    } finally {
      setPending(false);
    }
  };

  const setStatus = (status: Status) => {
    if (status === current.status) return;
    void run(() => client.postItemUpdate(item.id, { status }));
  };

  const commitProgress = (value: number) => {
    clearTimeout(timer.current);
    if (value === progressOf(current)) {
      setDraft(null);
      return;
    }
    setDraft(value);
    void run(() => client.postItemUpdate(item.id, { progress: value })).then(
      () => setDraft(null),
    );
  };

  const slide = (raw: number) => {
    // Snap to 0/25/50/75/100 when close to a mark.
    const near = Math.round(raw / 25) * 25;
    const value = Math.abs(near - raw) <= 4 ? near : raw;
    setDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commitProgress(value), 500);
  };

  const addStep = (e: FormEvent) => {
    e.preventDefault();
    const title = newStep.trim();
    if (!title) return;
    void run(() => client.addStep(item.id, { title })).then(
      (ok) => ok && setNewStep(""),
    );
  };

  const toggleStep = (s: ItemStep) =>
    void run(() => client.updateStep(item.id, s.id, { done: !s.done }));

  const renameStep = (s: ItemStep, title: string) => {
    setRenaming(null);
    const next = title.trim();
    if (!next || next === s.title) return;
    void run(() => client.updateStep(item.id, s.id, { title: next }));
  };

  const deleteStep = (s: ItemStep) =>
    void run(() => client.deleteStep(item.id, s.id));

  const postUpdate = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text && !nextStatus) return;
    void run(() =>
      client.postItemUpdate(item.id, {
        ...(text ? { body: text } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
      }),
    ).then((ok) => {
      if (!ok) return;
      setBody("");
      setNextStatus("");
    });
  };

  const locked = !canWrite || pending;

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panel}
        className="task-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
        aria-busy={pending}
      >
        <header className="drawer-head">
          <div className="drawer-kicker">
            <span>{current.kind === "event" ? "Event" : "Task"}</span>
            {team && (
              <span className="team-badge" title={"Shared with " + team}>
                <Users size={11} />
                {team}
              </span>
            )}
            <button
              ref={closeButton}
              className="icon-button drawer-close"
              aria-label="Close task panel"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
          <h2 id="task-drawer-title">{current.title}</h2>
          <div className="drawer-facts">
            <span>
              <CalendarClock size={14} aria-hidden="true" />
              {timeRange(current.due_at, current.end_at)}
            </span>
            <span className={"priority " + current.priority}>
              {current.priority} priority
            </span>
            {current.location && (
              <span className="drawer-fact">
                <MapPin size={14} aria-hidden="true" />
                {current.location}
              </span>
            )}
            {current.meeting_url && (
              <a
                className="drawer-fact link-button"
                href={current.meeting_url}
                target="_blank"
                rel="noreferrer"
              >
                <Video size={14} aria-hidden="true" /> Meeting link
              </a>
            )}
          </div>
          <ItemFacts item={current} className="drawer-planning" />
          {canWrite ? (
            <div
              className="status-picker"
              role="radiogroup"
              aria-label="Status"
            >
              {statusOrder.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={current.status === s}
                  className={`tone-${s} ${current.status === s ? "active" : ""}`}
                  disabled={pending}
                  onClick={() => setStatus(s)}
                >
                  <i aria-hidden="true" />
                  {statusLabels[s]}
                </button>
              ))}
            </div>
          ) : (
            <div className="drawer-readonly">
              <StatusPill status={current.status} />
              <p className="view-only-note">
                <Eye size={14} /> View only — you&apos;re a viewer
                {team ? ` in ${team}` : ""}.
              </p>
            </div>
          )}
        </header>

        <div className="drawer-body">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          <section className="drawer-section" aria-labelledby="progress-title">
            <div className="drawer-section-head">
              <h3 id="progress-title">Progress</h3>
              <span className="drawer-count">
                {current.status === "done" ? "Complete" : `${progress}%`}
              </span>
            </div>
            <ProgressBar
              size="lg"
              value={progress}
              status={current.status}
              label={`Progress on ${current.title}`}
              hideValue
            />
            {stepsTotal > 0 ? (
              <p className="drawer-hint">
                Progress follows the checklist — {stepsDone} of {stepsTotal}{" "}
                steps done.
              </p>
            ) : canWrite ? (
              <div className="progress-control">
                <label htmlFor="progress-range" className="sr-only">
                  Set progress
                </label>
                <input
                  id="progress-range"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  list="progress-snaps"
                  value={progress}
                  disabled={pending || current.status === "done"}
                  aria-valuetext={`${progress}%`}
                  onChange={(e) => slide(Number(e.target.value))}
                />
                <datalist id="progress-snaps">
                  {SNAPS.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                <div className="progress-snaps">
                  {SNAPS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={progress === v ? "active" : ""}
                      disabled={pending || current.status === "done"}
                      onClick={() => commitProgress(v)}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
                {current.status === "done" && (
                  <p className="drawer-hint">
                    Reopen the task to change its progress.
                  </p>
                )}
              </div>
            ) : null}
          </section>

          {current.notes && (
            <section className="drawer-section">
              <h3>Notes</h3>
              <p className="drawer-notes">{current.notes}</p>
            </section>
          )}

          <section className="drawer-section" aria-labelledby="steps-title">
            <div className="drawer-section-head">
              <h3 id="steps-title">
                <ListChecks size={16} aria-hidden="true" /> Checklist
              </h3>
              {stepsTotal > 0 && (
                <span className="drawer-count">
                  {stepsDone} of {stepsTotal} done
                </span>
              )}
            </div>
            {detail === null && !error ? (
              <p className="drawer-hint">Loading checklist…</p>
            ) : steps.length ? (
              <ul className="step-list">
                {steps.map((s, n) => (
                  <li
                    key={s.id}
                    className={"step fade-up stagger " + (s.done ? "done" : "")}
                    style={stagger(n)}
                  >
                    <button
                      role="checkbox"
                      aria-checked={s.done}
                      aria-label={s.title}
                      className={"check " + (s.done ? "checked can-pop" : "")}
                      disabled={locked}
                      onClick={() => toggleStep(s)}
                    >
                      {s.done && <Check size={13} />}
                    </button>
                    {renaming === s.id ? (
                      <input
                        className="step-rename"
                        aria-label={`Rename step ${s.title}`}
                        autoFocus
                        maxLength={200}
                        defaultValue={s.title}
                        onBlur={(e) => renameStep(s, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            renameStep(s, e.currentTarget.value);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                      />
                    ) : canWrite ? (
                      <button
                        className="step-title"
                        title="Rename step"
                        disabled={pending}
                        onClick={() => setRenaming(s.id)}
                      >
                        {s.title}
                      </button>
                    ) : (
                      <span className="step-title">{s.title}</span>
                    )}
                    {canWrite && renaming !== s.id && (
                      <span className="step-actions">
                        <button
                          className="icon-button"
                          aria-label={`Rename step ${s.title}`}
                          disabled={pending}
                          onClick={() => setRenaming(s.id)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete step ${s.title}`}
                          disabled={pending}
                          onClick={() => deleteStep(s)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="drawer-hint">
                {canWrite
                  ? "Break it into small steps — progress then updates as you tick them off."
                  : "No checklist for this task."}
              </p>
            )}
            {canWrite && (
              <form className="step-add" onSubmit={addStep}>
                <input
                  aria-label="New step"
                  placeholder="Add a step…"
                  maxLength={200}
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                />
                <button
                  className="secondary"
                  disabled={pending || !newStep.trim()}
                >
                  <Plus size={15} /> Add
                </button>
              </form>
            )}
          </section>

          <section className="drawer-section" aria-labelledby="updates-title">
            <div className="drawer-section-head">
              <h3 id="updates-title">
                <MessageSquare size={16} aria-hidden="true" /> Updates
              </h3>
              {updates.length > 0 && (
                <span className="drawer-count">{updates.length}</span>
              )}
            </div>
            {canWrite && (
              <form className="update-composer" onSubmit={postUpdate}>
                <label htmlFor="update-body" className="sr-only">
                  Write an update
                </label>
                <textarea
                  id="update-body"
                  rows={2}
                  maxLength={2000}
                  placeholder="How is it going? Share progress, a blocker or a win…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div className="update-composer-row">
                  <label>
                    <span className="sr-only">Change status</span>
                    <select
                      value={nextStatus}
                      onChange={(e) =>
                        setNextStatus(e.target.value as Status | "")
                      }
                    >
                      <option value="">
                        Keep status ({statusLabels[current.status]})
                      </option>
                      {statusOrder
                        .filter((s) => s !== current.status)
                        .map((s) => (
                          <option key={s} value={s}>
                            Move to {statusLabels[s]}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={pending || (!body.trim() && !nextStatus)}
                  >
                    {pending ? "Posting…" : "Post update"}
                  </button>
                </div>
              </form>
            )}
            {updates.length ? (
              <ol className="timeline">
                {updates.map((u, n) => (
                  <li
                    key={u.id}
                    className="timeline-entry fade-up stagger"
                    style={stagger(n)}
                  >
                    <span className="timeline-avatar" aria-hidden="true">
                      {u.author_name.trim()[0]?.toUpperCase() ?? "?"}
                    </span>
                    <div className="timeline-main">
                      <p className="timeline-head">
                        <strong>{u.author_name}</strong>
                        <time
                          dateTime={u.created_at}
                          title={new Date(u.created_at).toLocaleString()}
                        >
                          {timeAgo(u.created_at)}
                        </time>
                      </p>
                      {u.body && <p className="timeline-body">{u.body}</p>}
                      {(u.status || u.progress !== null) && (
                        <p className="timeline-chips">
                          {u.status && (
                            <span className="timeline-chip">
                              Status → <StatusPill status={u.status} />
                            </span>
                          )}
                          {u.progress !== null && (
                            <span className="timeline-chip">
                              Progress → {u.progress}%
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              detail && (
                <p className="drawer-hint">
                  No updates yet.{" "}
                  {canWrite &&
                    "A quick note helps everyone see where this stands."}
                </p>
              )
            )}
          </section>
        </div>

        <div className="drawer-foot">
          {onFocus && current.kind === "task" && current.status !== "done" && (
            <button className="primary" onClick={() => onFocus(current)}>
              <Crosshair size={15} /> Focus
            </button>
          )}
          <button className="secondary" onClick={() => onEdit(current)}>
            {canWrite ? (
              <>
                <Pencil size={15} /> Edit details
              </>
            ) : (
              <>
                <Eye size={15} /> View details
              </>
            )}
          </button>
          <button className="text-button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
