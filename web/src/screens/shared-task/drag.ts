import { refFromUrl, type Item } from "@orbyn/core";
import type { DragEvent } from "react";
import { getSessionVersion, getToken } from "../../lib/session";

export const TASK_MIME = "application/x-orbyn-task";
export const ITEM_LINK_MIME = "application/x-orbyn-link";
const SOURCE_MIME = "application/x-orbyn-task-session";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const consumed = new WeakSet<DataTransfer>();
export const taskWebLink = (id: string) =>
  new URL("/app/task/" + encodeURIComponent(id), location.origin).toString();

/** Add link/scheduling formats without destroying a board's reorder format. */
export function startItemDrag(
  event: DragEvent,
  item: Item,
  generation = getSessionVersion(),
) {
  if (!getToken() || getSessionVersion() !== generation || !uuid(item.id)) {
    event.preventDefault();
    return false;
  }
  const transfer = event.dataTransfer;
  transfer.setData(
    ITEM_LINK_MIME,
    JSON.stringify({
      kind: item.kind === "event" ? "event" : "task",
      id: item.id,
    }),
  );
  transfer.setData(SOURCE_MIME, String(generation));
  if (item.kind === "task") transfer.setData(TASK_MIME, item.id);
  const url = taskWebLink(item.id);
  transfer.setData("text/uri-list", url);
  transfer.setData("text/plain", url);
  transfer.effectAllowed = "copyMove";
  return true;
}
export const carriesTask = (transfer: DataTransfer) =>
  transfer.types.includes(TASK_MIME);
export const carriesItemLink = (transfer: DataTransfer) =>
  carriesTask(transfer) ||
  transfer.types.includes(ITEM_LINK_MIME) ||
  transfer.types.includes("text/uri-list");
function currentSource(transfer: DataTransfer) {
  const source = transfer.getData(SOURCE_MIME);
  // A foreign/older client has no generation stamp. IDs still grant no authority:
  // each target resolves the object through its current owner and API permissions.
  return !!getToken() && (!source || source === String(getSessionVersion()));
}
export function draggedItem(
  transfer: DataTransfer,
): { id: string; kind: "task" | "event" } | null {
  if (!currentSource(transfer)) return null;
  const task = transfer.getData(TASK_MIME);
  if (uuid(task)) return { id: task, kind: "task" };
  const raw = transfer.getData(ITEM_LINK_MIME);
  if (raw.length <= 1000)
    try {
      const value = JSON.parse(raw);
      if (uuid(value?.id) && ["task", "event"].includes(value.kind))
        return { id: value.id, kind: value.kind };
    } catch {}
  const uri = transfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith("#"));
  const ref = refFromUrl(uri);
  return ref && ["task", "event"].includes(ref.kind) && uuid(ref.id)
    ? { id: ref.id, kind: ref.kind as "task" | "event" }
    : null;
}
/** Consume once per native drop object; nested targets cannot dispatch twice. */
export function takeTaskDrop(transfer: DataTransfer) {
  if (consumed.has(transfer) || !currentSource(transfer)) return null;
  const id = transfer.getData(TASK_MIME);
  if (!uuid(id)) return null;
  consumed.add(transfer);
  return id;
}
export function takeItemDrop(transfer: DataTransfer) {
  const item = draggedItem(transfer);
  if (!item || consumed.has(transfer)) return null;
  consumed.add(transfer);
  return item;
}
