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
  onToggle: (item: Item) => Promise<boolean>;
  onSetStatus: (item: Item, status: Status) => Promise<boolean>;
  onChangeItem: (item: Item, change: Partial<ItemInput>) => Promise<boolean>;
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
): Promise<boolean> {
  if (!row.can_write) throw new Error("This item is view only.");
  if ("field" in edit) {
    if (row.kind === "task")
      throw new Error("Custom fields are available on pages and projects.");
    await client.setFieldValue(
      edit.field,
      row.kind === "project" ? "project" : "page",
      row.id,
      edit.value,
    );
    return true;
  }
  if (row.kind === "task") {
    if (!item) throw new Error("Reload this task before editing.");
    if (edit.column === "done") return actions.onToggle(item);
    const value = "value" in edit ? edit.value : null;
    switch (edit.column) {
      case "title":
        if (value) return actions.onChangeItem(item, { title: value });
        throw new Error("Choose a value before saving.");
      case "status":
        if (value) return actions.onSetStatus(item, value as Status);
        throw new Error("Choose a value before saving.");
      case "priority":
        if (value)
          return actions.onChangeItem(item, {
            priority: value as ItemInput["priority"],
          });
        throw new Error("Choose a priority.");
      case "estimate": {
        const minutes = value ? parseMinutes(value) : null;
        if (value && minutes === null)
          throw new Error("Write the estimate in minutes, like 90 or 1h 30.");
        if (minutes !== null && minutes > 10080)
          throw new Error("Use an estimate of 10080 minutes or less.");
        return actions.onChangeItem(item, {
          estimate_minutes: minutes || null,
        });
      }
      case "due": {
        const moved = viewDueChange(item, value, timeZone);
        if (!moved.ok) throw new Error(moved.reason);
        return actions.onChangeItem(item, moved.change);
      }
    }
    throw new Error("This field cannot be edited here.");
  }
  const value = "value" in edit ? edit.value : null;
  if (row.kind === "page") {
    if (edit.column !== "title")
      throw new Error("This field cannot be edited here.");
    if (!value) throw new Error("Enter a title.");
    if (!row.version) throw new Error("Reload this page before editing.");
    await client.updateDoc(row.id, { title: value, version: row.version });
    return true;
  }
  switch (edit.column) {
    case "title":
      if (!value) throw new Error("Enter a name.");
      await client.updateProject(row.id, { name: value });
      return true;
    case "status":
      if (!value) throw new Error("Choose a status.");
      await client.updateProject(row.id, { status: value as ProjectStatus });
      return true;
    case "due":
      await client.updateProject(row.id, {
        deadline: changeProjectDeadline(row.due_at, { day: value }, timeZone),
      });
      return true;
  }
  throw new Error("This field cannot be edited here.");
}
