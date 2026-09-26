import {
  changeProjectDeadline,
  parseMinutes,
  viewDueChange,
  type FieldValue,
  type Item,
  type ItemInput,
  type ProjectStatus,
  type Status,
  type ViewRow,
} from "@orbyn/core";
import { client } from "../../lib/api";

/** A change made in place, in a table cell, a board or a calendar. */
export type CellEdit =
  | { column: "done" }
  | { column: string; field: string; value: FieldValue }
  | { column: string; value: string | null };

/** What the app does with a task's change (saves it and refreshes). */
export type TaskActions = {
  /** Tick or untick, with the app's usual celebration and undo. */
  onToggle: (item: Item) => void;
  onSetStatus: (item: Item, status: Status) => void;
  onChangeItem: (item: Item, change: Partial<ItemInput>) => void;
};

/**
 * Save one change made in place. Tasks go through the app's own task
 * changes (so ticking celebrates and the planner hears of it); pages and
 * projects are saved here. Resolves once saved, so the view reads afresh.
 */
export async function applyEdit(
  row: ViewRow,
  edit: CellEdit,
  item: Item | undefined,
  actions: TaskActions,
  timeZone: string,
): Promise<void> {
  if ("field" in edit) {
    await client.setFieldValue(
      edit.field,
      row.kind === "project" ? "project" : "page",
      row.id,
      edit.value,
    );
    return;
  }
  if (row.kind === "task") {
    if (!item) return;
    if (edit.column === "done") return actions.onToggle(item);
    const value = "value" in edit ? edit.value : null;
    switch (edit.column) {
      case "title":
        if (value) actions.onChangeItem(item, { title: value });
        return;
      case "status":
        if (value) actions.onSetStatus(item, value as Status);
        return;
      case "priority":
        if (value)
          actions.onChangeItem(item, {
            priority: value as ItemInput["priority"],
          });
        return;
      case "estimate": {
        const minutes = value ? parseMinutes(value) : null;
        if (value && minutes === null)
          throw new Error("Write the estimate in minutes, like 90 or 1h 30.");
        actions.onChangeItem(item, {
          estimate_minutes: minutes ? Math.min(minutes, 10080) : null,
        });
        return;
      }
      case "due": {
        const moved = viewDueChange(item, value, timeZone);
        if (!moved.ok) throw new Error(moved.reason);
        actions.onChangeItem(item, moved.change);
        return;
      }
    }
    return;
  }
  const value = "value" in edit ? edit.value : null;
  if (row.kind === "page") {
    if (edit.column === "title" && value && row.version)
      await client.updateDoc(row.id, { title: value, version: row.version });
    return;
  }
  switch (edit.column) {
    case "title":
      if (value) await client.updateProject(row.id, { name: value });
      return;
    case "status":
      if (value)
        await client.updateProject(row.id, { status: value as ProjectStatus });
      return;
    case "due":
      await client.updateProject(row.id, {
        deadline: changeProjectDeadline(row.due_at, { day: value }, timeZone),
      });
      return;
  }
}
