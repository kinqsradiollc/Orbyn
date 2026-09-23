import { Select } from "../../components/Select";
import { ProjectNotes } from "./ProjectNotes";
import { ProjectRecords } from "./ProjectRecords";
import { ProjectTimeMachine } from "./ProjectTimeMachine";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarRange,
  Columns3,
  History,
  List,
  Plus,
  Trash2,
  LayoutTemplate,
} from "lucide-react";
import {
  projectAtRisk,
  projectProgress,
  projectTimeline,
  projectReentry,
  type Item,
  type ProjectActivity,
  type Project,
  type ProjectStage,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Timeline } from "./Timeline";
import { DateField } from "../../components/DateField";

const HISTORY_FIELDS: Record<string, string> = {
  name: "Name",
  summary: "Summary",
  status: "Status",
  deadline: "Deadline",
  title: "Title",
  due_at: "Due date",
  progress: "Progress",
  stage_id: "Stage",
  version: "Document version",
  position: "Order",
};

function historyValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (key === "progress") return `${value}%`;
  if (key === "deadline" || key === "due_at") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime()))
      return date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
  }
  if (key === "stage_id") return "Stage changed";
  return String(value);
}

function historyDiff(event: ProjectActivity) {
  const before = event.before_state ?? {};
  const after = event.after_state ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        HISTORY_FIELDS[key] &&
        !(before[key] == null && after[key] == null) &&
        before[key] !== after[key],
    )
    .map((key) => ({
      label: HISTORY_FIELDS[key],
      from: historyValue(key, before[key]),
      to: historyValue(key, after[key]),
    }));
}

/** Tasks that sit in this project, grouped by stage with the unfiled last. */
function group(items: Item[], project: Project) {
  const mine = items.filter((i) => i.project_id === project.id);
  const byStage = new Map<string | null, Item[]>();
  for (const stage of project.stages) byStage.set(stage.id, []);
  byStage.set(null, []);
  for (const item of mine) {
    const key =
      item.stage_id && byStage.has(item.stage_id) ? item.stage_id : null;
    byStage.get(key)!.push(item);
  }
  return byStage;
}

export function ProjectDetail({
  project,
  items,
  report,
  onBack,
  onChanged,
  onDeleted,
  onItemsChanged,
  onOpenItem,
  onOpenNote,
  userId,
  canWrite,
}: {
  project: Project;
  items: Item[];
  report: (e: unknown) => void;
  onBack: () => void;
  onChanged: (p: Project) => void;
  onDeleted: () => void;
  onItemsChanged: () => void;
  onOpenItem: (item: Item) => void;
  /** Opens a note of this project's in the documents view. */
  onOpenNote?: (docId: string) => void;
  userId: string;
  canWrite: boolean;
}) {
  const { ask, tell } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"list" | "board" | "timeline" | "history">(
    "list",
  );
  const [activity, setActivity] = useState<ProjectActivity[] | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [reentry, setReentry] = useState<ReturnType<
    typeof projectReentry
  > | null>(null);
  /** The task being dragged across the board, if any. */
  const [dragging, setDragging] = useState<string | null>(null);
  const grouped = useMemo(() => group(items, project), [items, project]);
  const percent = projectProgress(project);
  const risk = projectAtRisk(project);
  // Only tasks in the project's own space can be filed into it.
  const unfiledPool = items.filter(
    (i) =>
      !i.project_id &&
      i.kind === "task" &&
      (i.team_id ?? null) === (project.team_id ?? null),
  );

  useEffect(() => {
    let active = true;
    const key = `orbyn.project.reentry.${project.id}`;
    const previous = localStorage.getItem(key);
    client
      .projectActivity(project.id)
      .then((rows) => {
        if (!active) return;
        setReentry(
          previous
            ? projectReentry(rows.filter((row) => row.created_at > previous))
            : null,
        );
        localStorage.setItem(key, new Date().toISOString());
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openHistory = () => {
    const key = `orbyn.project.seen.${project.id}`;
    setLastSeen(sessionStorage.getItem(key));
    setMode("history");
    client
      .projectActivity(project.id)
      .then((rows) => {
        setActivity(rows);
        sessionStorage.setItem(key, new Date().toISOString());
      })
      .catch(report);
  };

  const save = (patch: Parameters<typeof client.updateProject>[1]) => {
    setBusy(true);
    client
      .updateProject(project.id, patch)
      .then(onChanged)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const addStage = () => {
    const name = prompt("Name the new stage")?.trim();
    if (!name) return;
    save({
      stages: [
        ...project.stages.map((s) => ({ id: s.id, name: s.name })),
        { name },
      ],
    });
  };

  const renameStage = (stage: ProjectStage) => {
    const name = prompt("Rename this stage", stage.name)?.trim();
    if (!name || name === stage.name) return;
    save({
      stages: project.stages.map((s) => ({
        id: s.id,
        name: s.id === stage.id ? name : s.name,
      })),
    });
  };

  const removeStage = async (stage: ProjectStage) => {
    if (
      !(await ask({
        title: `Remove the “${stage.name}” stage? Its tasks stay in the project.`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    save({
      stages: project.stages
        .filter((s) => s.id !== stage.id)
        .map((s) => ({ id: s.id, name: s.name })),
    });
  };

  const moveTo = (item: Item, stageId: string | null) => {
    setBusy(true);
    client
      .setItemProject(item.id, { project_id: project.id, stage_id: stageId })
      .then(onItemsChanged)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const addExisting = async (stageId: string | null) => {
    if (!unfiledPool.length) {
      await tell({ title: "Every task is already in a project." });
      return;
    }
    const list = unfiledPool
      .slice(0, 20)
      .map((t, n) => `${n + 1}. ${t.title}`)
      .join("\n");
    const pick = prompt(`Which task should join this stage?\n\n${list}`);
    const index = Number(pick) - 1;
    const chosen = unfiledPool[index];
    if (!chosen) return;
    moveTo(chosen, stageId);
  };

  const unfile = (item: Item) => {
    setBusy(true);
    client
      .setItemProject(item.id, { project_id: null })
      .then(onItemsChanged)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const remove = async () => {
    if (
      !(await ask({
        title: `Delete “${project.name}”? Its tasks stay, unfiled.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    client.deleteProject(project.id).then(onDeleted).catch(report);
  };

  const deadlineValue = project.deadline
    ? new Date(project.deadline).toISOString().slice(0, 10)
    : "";

  return (
    <div className="project-detail">
      <div className="project-bar-top">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> All projects
        </button>
        <div
          className="pboard-toggle"
          role="group"
          aria-label="How to show the work"
        >
          <button
            className={mode === "list" ? "is-on" : ""}
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            <List size={14} /> List
          </button>
          <button
            className={mode === "board" ? "is-on" : ""}
            aria-pressed={mode === "board"}
            onClick={() => setMode("board")}
          >
            <Columns3 size={14} /> Board
          </button>
          <button
            className={mode === "timeline" ? "is-on" : ""}
            aria-pressed={mode === "timeline"}
            onClick={() => setMode("timeline")}
          >
            <CalendarRange size={14} /> Timeline
          </button>
          <button
            className={mode === "history" ? "is-on" : ""}
            aria-pressed={mode === "history"}
            onClick={openHistory}
          >
            <History size={14} /> History
          </button>
        </div>
        <button
          className="icon-button"
          title="Save as template"
          aria-label="Save as template"
          onClick={() =>
            void client
              .templateFromProject(project.id)
              .then((t) =>
                tell({
                  title: `Saved “${t.name}” as a template.`,
                  body: "Start a project from it with Templates, on the projects page.",
                }),
              )
              .catch(report)
          }
        >
          <LayoutTemplate size={15} />
        </button>
        <button
          className="icon-button"
          onClick={remove}
          aria-label="Delete project"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {reentry && reentry.total > 0 && (
        <section className="project-reentry" aria-label="Since your last visit">
          <div>
            <strong>Since your last visit</strong>
            <p>
              {reentry.total} change{reentry.total === 1 ? "" : "s"}
              {reentry.completedTasks > 0 &&
                ` · ${reentry.completedTasks} task${reentry.completedTasks === 1 ? "" : "s"} completed`}
              {reentry.changedRecords > 0 &&
                ` · ${reentry.changedRecords} commitment update${reentry.changedRecords === 1 ? "" : "s"}`}
            </p>
            <ul>
              {reentry.recent.map((summary, index) => (
                <li key={`${summary}-${index}`}>{summary}</li>
              ))}
            </ul>
          </div>
          <button className="secondary" onClick={openHistory}>
            View history
          </button>
        </section>
      )}

      <header className="project-header">
        <div className="project-title-row">
          <h2>{project.name}</h2>
          {risk && <span className="chip chip-warn">At risk</span>}
        </div>
        <p className="muted">{project.summary || "No summary yet."}</p>
        <div className="project-meta">
          <span className="project-bar" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </span>
          <span className="muted">
            {project.done_count} of {project.task_count} done · {percent}%
          </span>
          <label className="project-deadline">
            Deadline
            <DateField
              id="project-deadline"
              type="date"
              value={deadlineValue}
              disabled={busy}
              onChange={(e) =>
                save({
                  deadline: e.target.value
                    ? new Date(`${e.target.value}T12:00:00`).toISOString()
                    : null,
                })
              }
            />
          </label>
        </div>
      </header>

      {mode === "history" ? (
        <section
          className="project-history"
          aria-labelledby="project-history-title"
        >
          <div className="project-history-heading">
            <div>
              <h3 id="project-history-title">Project history</h3>
              <p className="muted">
                Changes to the project, its tasks, and its notes in one place.
              </p>
            </div>
            <button
              className="secondary"
              onClick={() =>
                client
                  .projectActivity(project.id)
                  .then(setActivity)
                  .catch(report)
              }
            >
              Refresh
            </button>
          </div>
          <ProjectTimeMachine projectId={project.id} report={report} />
          {activity === null ? (
            <p className="muted">Loading project history…</p>
          ) : activity.length === 0 ? (
            <p className="project-history-empty muted">
              Changes will appear here as work on this project evolves.
            </p>
          ) : (
            <>
              {lastSeen && (
                <p className="project-catchup" role="status">
                  <strong>
                    {
                      activity.filter((event) => event.created_at > lastSeen)
                        .length
                    }
                  </strong>{" "}
                  {activity.filter((event) => event.created_at > lastSeen)
                    .length === 1
                    ? "change since your last visit"
                    : "changes since your last visit"}
                </p>
              )}
              <ol className="project-history-list">
                {activity.map((event) => {
                  const changes = historyDiff(event);
                  const relatedItem =
                    event.entity_type === "task"
                      ? items.find((item) => item.id === event.entity_id)
                      : undefined;
                  return (
                    <li key={event.id}>
                      <span
                        className="project-history-dot"
                        aria-hidden="true"
                      />
                      <div className="project-history-entry">
                        <div className="project-history-title">
                          <strong>{event.summary}</strong>
                          <time dateTime={event.created_at}>
                            {new Date(event.created_at).toLocaleString([], {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        </div>
                        <small className="muted">
                          {event.actor_name ?? "Workspace activity"}
                        </small>
                        {!!changes.length && (
                          <ul className="project-history-diff">
                            {changes.map((change) => (
                              <li key={change.label}>
                                <span>{change.label}</span>
                                <span>{change.from}</span>
                                <span aria-hidden="true">→</span>
                                <strong>{change.to}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                        {relatedItem && (
                          <button
                            className="text-button"
                            onClick={() => onOpenItem(relatedItem)}
                          >
                            Open task
                          </button>
                        )}
                        {event.entity_type === "note" &&
                          event.entity_id &&
                          onOpenNote && (
                            <button
                              className="text-button"
                              onClick={() => onOpenNote(event.entity_id!)}
                            >
                              Open note
                            </button>
                          )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      ) : mode === "timeline" ? (
        <Timeline project={project} items={items} onOpenItem={onOpenItem} />
      ) : mode === "board" ? (
        <div className="pboard" aria-label="Stages as columns">
          {[
            ...project.stages.map((st) => ({ id: st.id, name: st.name })),
            {
              id: null as string | null,
              name: "No stage",
            },
          ].map((column) => {
            const rows = grouped.get(column.id) ?? [];
            return (
              <section
                key={column.id ?? "none"}
                className={"pboard-column" + (dragging ? " is-target" : "")}
                onDragOver={(e) => {
                  // Allowing the drop is what makes the column a target.
                  if (dragging) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  const item = items.find((i) => i.id === id);
                  setDragging(null);
                  if (item && item.stage_id !== column.id)
                    moveTo(item, column.id);
                }}
              >
                <div className="pboard-head">
                  <strong>{column.name}</strong>
                  <span className="muted stage-count">{rows.length}</span>
                </div>
                <div className="pboard-cards">
                  {rows.map((item) => (
                    <button
                      key={item.id}
                      className={
                        "pboard-card" +
                        (dragging === item.id ? " is-dragging" : "")
                      }
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", item.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(item.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => onOpenItem(item)}
                    >
                      <span
                        className={
                          "stage-dot" +
                          (item.status === "done" ? " is-done" : "")
                        }
                        aria-hidden="true"
                      />
                      <span
                        className={
                          item.status === "done" ? "stage-task-done" : ""
                        }
                      >
                        {item.title}
                      </span>
                    </button>
                  ))}
                  {rows.length === 0 && (
                    <p className="pboard-empty muted">Drop a task here.</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="stage-list">
          {project.stages.map((stage) => {
            const rows = grouped.get(stage.id) ?? [];
            return (
              <section key={stage.id} className="stage">
                <div className="stage-head">
                  <button
                    className="stage-name"
                    onClick={() => renameStage(stage)}
                    title="Rename this stage"
                  >
                    {stage.name}
                  </button>
                  <span className="muted stage-count">{rows.length}</span>
                  <button
                    className="text-button"
                    onClick={() => addExisting(stage.id)}
                    disabled={busy}
                  >
                    <Plus size={13} /> Add task
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => removeStage(stage)}
                    aria-label={`Remove the ${stage.name} stage`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {rows.length === 0 ? (
                  <p className="stage-empty muted">Nothing here yet.</p>
                ) : (
                  <ul className="stage-tasks">
                    {rows.map((item) => (
                      <li key={item.id}>
                        <button
                          className="stage-task"
                          onClick={() => onOpenItem(item)}
                        >
                          <span
                            className={
                              "stage-dot" +
                              (item.status === "done" ? " is-done" : "")
                            }
                            aria-hidden="true"
                          />
                          <span
                            className={
                              item.status === "done" ? "stage-task-done" : ""
                            }
                          >
                            {item.title}
                          </span>
                        </button>
                        <Select
                          id={`stage-for-${item.id}`}
                          className="stage-move"
                          value={item.stage_id ?? ""}
                          disabled={busy}
                          aria-label={`Stage for ${item.title}`}
                          onChange={(e) =>
                            e.target.value === "__remove"
                              ? unfile(item)
                              : moveTo(item, e.target.value || null)
                          }
                        >
                          {project.stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                          <option value="">No stage</option>
                          <option value="__remove">Remove from project</option>
                        </Select>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <section className="stage">
            <div className="stage-head">
              <span className="stage-name is-static">No stage</span>
              <span className="muted stage-count">
                {(grouped.get(null) ?? []).length}
              </span>
              <button
                className="text-button"
                onClick={() => addExisting(null)}
                disabled={busy}
              >
                <Plus size={13} /> Add task
              </button>
            </div>
            {(grouped.get(null) ?? []).length === 0 ? (
              <p className="stage-empty muted">Everything is filed.</p>
            ) : (
              <ul className="stage-tasks">
                {(grouped.get(null) ?? []).map((item) => (
                  <li key={item.id}>
                    <button
                      className="stage-task"
                      onClick={() => onOpenItem(item)}
                    >
                      <span
                        className={
                          "stage-dot" +
                          (item.status === "done" ? " is-done" : "")
                        }
                        aria-hidden="true"
                      />
                      <span>{item.title}</span>
                    </button>
                    <Select
                      id={`stage-for-${item.id}`}
                      className="stage-move"
                      value=""
                      disabled={busy}
                      aria-label={`Stage for ${item.title}`}
                      onChange={(e) =>
                        e.target.value === "__remove"
                          ? unfile(item)
                          : moveTo(item, e.target.value || null)
                      }
                    >
                      <option value="">No stage</option>
                      {project.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="__remove">Remove from project</option>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button className="add-stage" onClick={addStage} disabled={busy}>
            <Plus size={14} /> Add a stage
          </button>
        </div>
      )}

      <ProjectRecords
        project={project}
        items={items}
        userId={userId}
        canWrite={canWrite}
        onOpenNote={onOpenNote}
        report={report}
      />

      {!!onOpenNote && (
        <ProjectNotes
          projectId={project.id}
          teamId={project.team_id}
          canWrite={!busy}
          report={report}
          onOpen={onOpenNote}
        />
      )}
    </div>
  );
}
