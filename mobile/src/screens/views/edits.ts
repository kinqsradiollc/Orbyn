import {
  changeProjectDeadline,
  itemBody,
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
import * as outbox from "../../lib/outbox";

/** A change made in a view: a tick, a cell, or one of your own fields. */
export type CellEdit =
  | { column: "done" }
  | { column: string; field: string; value: FieldValue }
  | { column: string; value: string | null };

/** The app's own ways to tick and change a task's status. */
export type EditResult = "saved" | "queued";
export type TaskActions = {
  onToggle: (item: Item) => Promise<EditResult>;
  onSetStatus: (item: Item, status: Status) => Promise<EditResult>;
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
): Promise<EditResult> {
  if (!row.can_write) throw new Error("You cannot change this item.");
  if ("field" in edit) {
    if (row.kind === "task")
      throw new Error("This field cannot be edited here.");
    await client.setFieldValue(
      edit.field,
      row.kind === "project" ? "project" : "page",
      row.id,
      edit.value,
    );
    return "saved";
  }
  const value = "value" in edit ? edit.value : null;
  if (row.kind === "task") {
    const item = row.item;
    if (!item) throw new Error("Reload this task before editing.");
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
        if (minutes !== null && minutes > 10080)
          throw new Error("Use an estimate of 10080 minutes or less.");
        change = { estimate_minutes: minutes || null };
        break;
      }
      case "due": {
        const moved = viewDueChange(item, value, timeZone);
        if (!moved.ok) throw new Error(moved.reason);
        change = moved.change;
        break;
      }
    }
    if (!change) throw new Error("Choose a value before saving.");
    const saved = await outbox.updateItem(item, {
      ...itemBody(item),
      ...change,
    });
    return saved ? "saved" : "queued";
  }
  if (row.kind === "page") {
    if (edit.column === "title" && value && row.version)
      await client.updateDoc(row.id, { title: value, version: row.version });
    else throw new Error("This field cannot be edited here.");
    return "saved";
  }
  switch (edit.column) {
    case "title":
      if (!value) throw new Error("Choose a name before saving.");
      await client.updateProject(row.id, { name: value });
      return "saved";
    case "status":
      if (!value) throw new Error("Choose a status before saving.");
      await client.updateProject(row.id, { status: value as ProjectStatus });
      return "saved";
    case "due":
      await client.updateProject(row.id, {
        deadline: changeProjectDeadline(row.due_at, { day: value }, timeZone),
      });
      return "saved";
  }
  throw new Error("This field cannot be edited here.");
}
