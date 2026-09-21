import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarRange,
  Columns3,
  List,
  Plus,
  Trash2,
} from "lucide-react";
import {
  projectAtRisk,
  projectProgress,
  projectTimeline,
  type Item,
  type Project,
  type ProjectStage,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Timeline } from "./Timeline";

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
}: {
  project: Project;
  items: Item[];
  report: (e: unknown) => void;
  onBack: () => void;
  onChanged: (p: Project) => void;
  onDeleted: () => void;
  onItemsChanged: () => void;
  onOpenItem: (item: Item) => void;
}) {
  const { ask, tell } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"list" | "board" | "timeline">("list");
  /** The task being dragged across the board, if any. */
  const [dragging, setDragging] = useState<string | null>(null);
  const grouped = useMemo(() => group(items, project), [items, project]);
  const percent = projectProgress(project);
  const risk = projectAtRisk(project);
  const unfiledPool = items.filter((i) => !i.project_id && i.kind === "task");

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
        </div>
        <button
          className="icon-button"
          onClick={remove}
          aria-label="Delete project"
        >
          <Trash2 size={15} />
        </button>
      </div>

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
            <input
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

      {mode === "timeline" ? (
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
    </div>
  );
}
