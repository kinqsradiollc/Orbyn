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
import { client } from "../../lib/session";

/** A change made in place: a table cell, a board or a calendar. */
export type CellEdit =
  | { column: "done" }
  | { column: string; field: string; value: FieldValue }
  | { column: string; value: string | null };

export type TaskActions = {
  toggle: (item: Item) => Promise<unknown>;
  status: (item: Item, status: Status) => Promise<unknown>;
  change: (item: Item, change: Partial<ItemInput>) => Promise<unknown>;
};

/** Saves one change. Throws with words for the person when it can't. */
export async function applyEdit(
  row: ViewRow,
  edit: CellEdit,
  item: Item | undefined,
  actions: TaskActions,
  timeZone: string,
) {
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
    return;
  }
  const value = "value" in edit ? edit.value : null;
  if (row.kind === "task") {
    if (!item) throw new Error("Reload this task before editing.");
    if (edit.column === "done") return void (await actions.toggle(item));
    switch (edit.column) {
      case "title":
        if (!value) throw new Error("Choose a value before saving.");
        return void (await actions.change(item, { title: value }));
      case "status":
        if (!value) throw new Error("Choose a value before saving.");
        return void (await actions.status(item, value as Status));
      case "priority":
        if (!value) throw new Error("Choose a priority.");
        return void (await actions.change(item, {
          priority: value as ItemInput["priority"],
        }));
      case "estimate": {
        const minutes = value ? parseMinutes(value) : null;
        if (value && minutes === null)
          throw new Error("Write the estimate in minutes, like 90 or 1h 30.");
        if (minutes !== null && minutes > 10080)
          throw new Error("Use an estimate of 10080 minutes or less.");
        return void (await actions.change(item, {
          estimate_minutes: minutes || null,
        }));
      }
      case "due": {
        const moved = viewDueChange(item, value, timeZone);
        if (!moved.ok) throw new Error(moved.reason);
        return void (await actions.change(item, moved.change));
      }
    }
    throw new Error("This field can't be edited here.");
  }
  if (row.kind === "page") {
    if (edit.column !== "title")
      throw new Error("This field can't be edited here.");
    if (!value) throw new Error("Enter a title.");
    if (!row.version) throw new Error("Reload this page before editing.");
    await client.updateDoc(row.id, { title: value, version: row.version });
    return;
  }
  switch (edit.column) {
    case "title":
      if (!value) throw new Error("Enter a name.");
      await client.updateProject(row.id, { name: value });
      return;
    case "status":
      if (!value) throw new Error("Choose a status.");
      await client.updateProject(row.id, { status: value as ProjectStatus });
      return;
    case "due":
      await client.updateProject(row.id, {
        deadline: changeProjectDeadline(row.due_at, { day: value }, timeZone),
      });
      return;
  }
  throw new Error("This field can't be edited here.");
}
