import {
  changeProjectDeadline,
  itemBody,
  parseMinutes,
  taskDueChange,
  type FieldValue,
  type Item,
  type ItemInput,
  type ProjectStatus,
  type Status,
  type ViewRow,
} from "@orbyn/core";
import { client } from "../../lib/api";
import * as outbox from "../../lib/outbox";

/** A change made in a view: a tick, a cell, or one of your own fields. */
export type CellEdit =
  | { column: "done" }
  | { column: string; field: string; value: FieldValue }
  | { column: string; value: string | null };

/** The app's own ways to tick and change a task's status. */
export type TaskActions = {
  onToggle: (item: Item) => void;
  onSetStatus?: (item: Item, status: Status) => void;
};

/**
 * Save one change made in a view. Ticks and statuses go through the app's
 * own task changes (so they celebrate and work offline); other task
 * changes go through the outbox; pages and projects are saved directly.
 */
export async function applyEdit(
  row: ViewRow,
  edit: CellEdit,
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
  const value = "value" in edit ? edit.value : null;
  if (row.kind === "task") {
    const item = row.item;
    if (!item) return;
    if (edit.column === "done") return actions.onToggle(item);
    if (edit.column === "status" && value && actions.onSetStatus)
      return actions.onSetStatus(item, value as Status);
    let change: Partial<ItemInput> | null = null;
    switch (edit.column) {
      case "title":
        if (value) change = { title: value };
        break;
      case "priority":
        if (value) change = { priority: value as ItemInput["priority"] };
        break;
      case "estimate": {
        const minutes = value ? parseMinutes(value) : null;
        if (value && minutes === null)
          throw new Error("Write the estimate in minutes, like 90 or 1h 30.");
        change = {
          estimate_minutes: minutes ? Math.min(minutes, 10080) : null,
        };
        break;
      }
      case "due":
        change = taskDueChange(item, value, timeZone);
        break;
    }
    if (change) await outbox.updateItem(item, { ...itemBody(item), ...change });
    return;
  }
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
