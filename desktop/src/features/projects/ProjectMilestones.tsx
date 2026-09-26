import { useEffect, useState } from "react";
import { Flag, Plus, X } from "lucide-react";
import {
  MILESTONE_STATUS_LABELS,
  addDays,
  isClosed,
  localDateKey,
  shortMinutes,
  type Item,
  type ProjectMilestone,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { DateField } from "../../components/DateField";
import { useConfirm } from "../../components/Confirm";

/** "Fri 16 Oct" for a milestone's day. */
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const TONE: Record<ProjectMilestone["status"], string> = {
  done: "is-ok",
  on_track: "is-ok",
  not_planned: "is-warn",
  late: "is-warn",
  passed: "is-warn",
  empty: "",
};

type Draft = {
  id: string | null;
  name: string;
  due_on: string;
  item_ids: string[];
};

/**
 * A project's milestones on its Home: named, dated checkpoints in their own
 * list (never dates on stages), each rolling up its tasks — how many are
 * done, and for your part, whether it's planned to finish by the day.
 */
export function ProjectMilestones({
  projectId,
  items,
  canWrite,
  onChanged,
  report,
  refreshKey,
}: {
  projectId: string;
  /** The project's tasks. */
  items: Item[];
  canWrite: boolean;
  /** Tasks changed (they joined or left a milestone). */
  onChanged: () => void;
  report: (e: unknown) => void;
  /** Changes when sessions or tasks may have, to roll up again. */
  refreshKey?: unknown;
}) {
  const { ask } = useConfirm();
  const [list, setList] = useState<ProjectMilestone[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    client.projectMilestones(projectId).then(setList, (e) => {
      setList([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // Reloads with its project and whenever its tasks change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  const tasks = items.filter((i) => i.kind === "task" && !isClosed(i.status));

  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.due_on) return;
    setBusy(true);
    try {
      if (draft.id) {
        await client.updateMilestone(projectId, draft.id, {
          name: draft.name.trim(),
          due_on: draft.due_on,
        });
        const was = new Set(
          items.filter((i) => i.milestone_id === draft.id).map((i) => i.id),
        );
        const now = new Set(draft.item_ids);
        for (const id of now)
          if (!was.has(id)) await client.setItemMilestone(id, draft.id);
        for (const id of was)
          if (!now.has(id)) await client.setItemMilestone(id, null);
      } else
        await client.createMilestone(projectId, {
          name: draft.name.trim(),
          due_on: draft.due_on,
          item_ids: draft.item_ids,
        });
      setDraft(null);
      await load();
      onChanged();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: ProjectMilestone) => {
    if (
      !(await ask({
        title: `Remove the milestone “${m.name}”?`,
        body: "Its tasks stay in the project, with their deadlines as they are.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    try {
      await client.deleteMilestone(projectId, m.id);
      setDraft(null);
      await load();
      onChanged();
    } catch (e) {
      report(e);
    }
  };

  const markDone = async (m: ProjectMilestone, done: boolean) => {
    try {
      await client.updateMilestone(projectId, m.id, { done });
      await load();
    } catch (e) {
      report(e);
    }
  };

  if (list === null || (!list.length && !canWrite)) return null;
  const today = localDateKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  return (
    <section className="project-home-section project-milestones">
      <div className="project-milestones-head">
        <h3>Milestones</h3>
        {canWrite && (
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setDraft({
                id: null,
                name: "",
                due_on: addDays(today, 7),
                item_ids: [],
              })
            }
          >
            <Plus size={14} aria-hidden="true" /> Add
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted">
          Dated checkpoints, like “Draft ready”. Each one shows whether its
          tasks are planned to finish by then.
        </p>
      ) : (
        <ul className="milestone-list">
          {list.map((m) => (
            <li key={m.id} className="milestone-row">
              <Flag size={14} aria-hidden="true" className="milestone-flag" />
              <span className="milestone-main">
                {canWrite ? (
                  <button
                    type="button"
                    className="text-button milestone-name"
                    onClick={() =>
                      setDraft({
                        id: m.id,
                        name: m.name,
                        due_on: m.due_on,
                        item_ids: items
                          .filter((i) => i.milestone_id === m.id)
                          .map((i) => i.id),
                      })
                    }
                  >
                    {m.name}
                  </button>
                ) : (
                  <strong className="milestone-name">{m.name}</strong>
                )}
                <small className="muted">
                  {dayLabel(m.due_on)} · {m.done_count} of {m.task_count}{" "}
                  {m.task_count === 1 ? "task" : "tasks"} done
                  {m.planned_finish_at && m.status !== "done"
                    ? ` · planned finish ${new Date(m.planned_finish_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}`
                    : ""}
                  {m.status === "not_planned" && m.needed_minutes > m.planned_minutes
                    ? ` · ${shortMinutes(m.needed_minutes - m.planned_minutes)} not planned`
                    : ""}
                </small>
              </span>
              <span className={`plan-chip ${TONE[m.status]}`}>
                {MILESTONE_STATUS_LABELS[m.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
          }}
        >
          <form
            className="modal modal-small milestone-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="milestone-title"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="section-heading">
              <h2 id="milestone-title">
                {draft.id ? "Milestone" : "New milestone"}
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setDraft(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted modal-lead">
              A dated checkpoint in its own list. It never changes a task's
              deadline.
            </p>
            <label>
              Name
              <input
                autoFocus
                required
                maxLength={120}
                placeholder="Draft ready"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Date
              <DateField
                value={draft.due_on}
                onChange={(e) => setDraft({ ...draft, due_on: e.target.value })}
              />
            </label>
            {tasks.length > 0 && (
              <fieldset className="milestone-tasks">
                <legend>Its tasks</legend>
                {tasks.map((t) => (
                  <label key={t.id} className="check-line">
                    <input
                      type="checkbox"
                      checked={draft.item_ids.includes(t.id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          item_ids: e.target.checked
                            ? [...draft.item_ids, t.id]
                            : draft.item_ids.filter((id) => id !== t.id),
                        })
                      }
                    />
                    <span>{t.title}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {draft.id && (
              <div className="milestone-more">
                {(() => {
                  const m = list.find((x) => x.id === draft.id);
                  if (!m) return null;
                  return (
                    <>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setDraft(null);
                          void markDone(m, !m.done_at);
                        }}
                      >
                        {m.done_at ? "Not done yet" : "Mark done"}
                      </button>
                      <button
                        type="button"
                        className="text-button is-destructive"
                        onClick={() => void remove(m)}
                      >
                        Remove milestone
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
