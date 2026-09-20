import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  projectAtRisk,
  projectProgress,
  type Item,
  type Project,
  type ProjectStage,
} from "@orbyn/core";
import { client } from "../../lib/api";

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
  const [busy, setBusy] = useState(false);
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

  const removeStage = (stage: ProjectStage) => {
    if (
      !confirm(
        `Remove the “${stage.name}” stage? Its tasks stay in the project.`,
      )
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

  const addExisting = (stageId: string | null) => {
    if (!unfiledPool.length) {
      alert("Every task is already in a project.");
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

  const remove = () => {
    if (!confirm(`Delete “${project.name}”? Its tasks stay, unfiled.`)) return;
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
                      <select
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
                      </select>
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
                        "stage-dot" + (item.status === "done" ? " is-done" : "")
                      }
                      aria-hidden="true"
                    />
                    <span>{item.title}</span>
                  </button>
                  <select
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
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button className="add-stage" onClick={addStage} disabled={busy}>
          <Plus size={14} /> Add a stage
        </button>
      </div>
    </div>
  );
}
