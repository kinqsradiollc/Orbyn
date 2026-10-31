import type { Item, Project, ProjectStage } from "@orbyn/core";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type DragEvent } from "react";
import { Button, IconButton, SelectBox } from "../../ui/kit";
import { tasks } from "../shared-task";

const MIME = "application/x-orbyn-stage-card";
const REMOVE = "__remove";

type Grouped = Map<string | null, Item[]>;

/** Tasks in this project by stage, the unfiled last. */
export function groupStages(items: Item[], project: Project): Grouped {
  const mine = items.filter((i) => i.project_id === project.id);
  const by: Grouped = new Map(project.stages.map((s) => [s.id, [] as Item[]]));
  by.set(null, []);
  for (const item of mine)
    by.get(item.stage_id && by.has(item.stage_id) ? item.stage_id : null)!.push(
      item,
    );
  return by;
}

const Dot = ({ item }: { item: Item }) => (
  <span
    className={`pj-dotmark${item.status === "done" ? " is-done" : ""}`}
    aria-hidden="true"
  />
);

function TaskLine({
  item,
  project,
  canWrite,
  busy,
  onMove,
  onUnfile,
}: {
  item: Item;
  project: Project;
  canWrite: boolean;
  busy: boolean;
  onMove: (item: Item, stage: string | null) => void;
  onUnfile: (item: Item) => void;
}) {
  return (
    <li>
      <button
        className={`pj-task${item.status === "done" ? " is-done" : ""}`}
        dir="auto"
        onClick={() => tasks.open(item)}
      >
        <Dot item={item} />
        <span>{item.title}</span>
      </button>
      <SelectBox
        aria-label={`Stage for ${item.title}`}
        value={item.stage_id ?? ""}
        disabled={busy || !canWrite}
        onChange={(event) =>
          event.target.value === REMOVE
            ? onUnfile(item)
            : onMove(item, event.target.value || null)
        }
      >
        {project.stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        <option value="">No stage</option>
        <option value={REMOVE}>Remove from project</option>
      </SelectBox>
    </li>
  );
}

export function StageList({
  project,
  grouped,
  canWrite,
  busy,
  onMove,
  onUnfile,
  onAdd,
  onRename,
  onRemove,
  onNewStage,
}: {
  project: Project;
  grouped: Grouped;
  canWrite: boolean;
  busy: boolean;
  onMove: (item: Item, stage: string | null) => void;
  onUnfile: (item: Item) => void;
  onAdd: (stage: string | null) => void;
  onRename: (stage: ProjectStage) => void;
  onRemove: (stage: ProjectStage) => void;
  onNewStage: () => void;
}) {
  const line = (item: Item) => (
    <TaskLine
      key={item.id}
      item={item}
      project={project}
      canWrite={canWrite}
      busy={busy}
      onMove={onMove}
      onUnfile={onUnfile}
    />
  );
  const none = grouped.get(null) ?? [];
  return (
    <div className="pj-stages">
      {project.stages.map((stage) => {
        const rows = grouped.get(stage.id) ?? [];
        return (
          <section key={stage.id}>
            <header>
              <h3 dir="auto">{stage.name}</h3>
              <span className="pj-count-note">{rows.length}</span>
              <span className="pj-grow" />
              {canWrite && (
                <>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onAdd(stage.id)}
                  >
                    <Plus aria-hidden="true" /> Add task
                  </Button>
                  <IconButton
                    label={`Rename the ${stage.name} stage`}
                    disabled={busy}
                    onClick={() => onRename(stage)}
                  >
                    <Pencil />
                  </IconButton>
                  <IconButton
                    label={`Remove the ${stage.name} stage`}
                    disabled={busy}
                    onClick={() => onRemove(stage)}
                  >
                    <Trash2 />
                  </IconButton>
                </>
              )}
            </header>
            {rows.length ? (
              <ul>{rows.map(line)}</ul>
            ) : (
              <p className="muted small">Nothing here yet.</p>
            )}
          </section>
        );
      })}
      <section>
        <header>
          <h3>No stage</h3>
          <span className="pj-count-note">{none.length}</span>
          <span className="pj-grow" />
          {canWrite && (
            <Button variant="ghost" disabled={busy} onClick={() => onAdd(null)}>
              <Plus aria-hidden="true" /> Add task
            </Button>
          )}
        </header>
        {none.length ? (
          <ul>{none.map(line)}</ul>
        ) : (
          <p className="muted small">Everything is filed.</p>
        )}
      </section>
      {canWrite && (
        <Button variant="ghost" disabled={busy} onClick={onNewStage}>
          <Plus aria-hidden="true" /> Add a stage
        </Button>
      )}
    </div>
  );
}

/** Stages as columns. Cards drag; List keeps a keyboard way to move them. */
export function StageBoard({
  project,
  grouped,
  items,
  canWrite,
  busy,
  onMove,
}: {
  project: Project;
  grouped: Grouped;
  items: Item[];
  canWrite: boolean;
  busy: boolean;
  onMove: (item: Item, stage: string | null) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null | undefined>(undefined);
  const columns = [
    ...project.stages.map((s) => ({ id: s.id as string | null, name: s.name })),
    { id: null, name: "No stage" },
  ];
  const drop = (event: DragEvent, column: string | null) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(MIME) || dragging;
    const item = items.find((i) => i.id === id);
    setDragging(null);
    setOver(undefined);
    if (canWrite && item && (item.stage_id ?? null) !== column)
      onMove(item, column);
  };
  return (
    <div className="pj-board" role="group" aria-label="Stages as columns">
      {columns.map((column) => {
        const rows = grouped.get(column.id) ?? [];
        return (
          <section
            key={column.id ?? "none"}
            className={over === column.id ? "is-over" : undefined}
            aria-label={column.name}
            onDragOver={(event) => {
              if (canWrite && !busy && dragging) {
                event.preventDefault();
                setOver(column.id);
              }
            }}
            onDragLeave={() => setOver(undefined)}
            onDrop={(event) => drop(event, column.id)}
          >
            <header>
              <h3 dir="auto">{column.name}</h3>
              <span className="pj-count-note">{rows.length}</span>
            </header>
            {rows.map((item) => (
              <button
                key={item.id}
                className={`pj-card${dragging === item.id ? " is-dragging" : ""}${item.status === "done" ? " is-done" : ""}`}
                dir="auto"
                draggable={canWrite && !busy}
                onDragStart={(event) => {
                  event.dataTransfer.setData(MIME, item.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDragging(item.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(undefined);
                }}
                onClick={() => tasks.open(item)}
              >
                <Dot item={item} />
                <span>{item.title}</span>
              </button>
            ))}
            {!rows.length && (
              <p className="muted small">
                {canWrite ? "Drop a task here." : "Nothing here."}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
