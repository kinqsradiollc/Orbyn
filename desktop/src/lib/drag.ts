import type { DragEvent } from "react";
import { refFromUrl, type LinkKind, type ObjectRef } from "@orbyn/core";
import { linkTo } from "./links";

/**
 * Drag and drop between the app's own places (ORG-06). A task, page or
 * project picked up anywhere carries what it is, so each place it can land
 * takes what it understands: a page into a page makes a link, a page onto a
 * folder files it, a task onto a calendar day plans a session there, a card
 * onto a board column moves it. Each drag also carries the thing's web
 * link, so it drops into another app (or another Orbyn window) as a link.
 * Every drop has a menu or button that does the same without a mouse.
 */

/** A task: its id (the calendar reads this). */
export const TASK_MIME = "application/x-orbyn-task";
/** Anything that can be linked: `{ kind, id, title }`. */
export const LINK_MIME = "application/x-orbyn-link";
/** A page from the library: its id (folders read this). */
export const DOC_MIME = "application/x-orbyn-doc";
/** A board card: `{ id, from }`, the column it left. */
export const CARD_MIME = "application/x-orbyn-card";

export type DraggedLink = { ref: ObjectRef; title: string };

/**
 * Start dragging a task, page or project: everything a drop could want.
 * Tasks are offered to the calendar, pages to folders, and all to pages.
 */
export function startDrag(
  e: DragEvent,
  thing: {
    kind: "task" | "doc" | "project";
    id: string;
    title: string;
    /** An event is linked like a task but never gets a session. */
    event?: boolean;
  },
) {
  const dt = e.dataTransfer;
  dt.effectAllowed = "copyMove";
  const url = linkTo({ kind: thing.kind, id: thing.id });
  dt.setData(
    LINK_MIME,
    JSON.stringify({
      kind: thing.event ? "event" : thing.kind,
      id: thing.id,
      title: thing.title,
    }),
  );
  if (thing.kind === "task" && !thing.event) dt.setData(TASK_MIME, thing.id);
  if (thing.kind === "doc") dt.setData(DOC_MIME, thing.id);
  dt.setData("text/uri-list", url);
  dt.setData("text/plain", url);
}

/** Whether what's being dragged has this type (readable while dragging). */
export const carries = (e: DragEvent, type: string) =>
  e.dataTransfer.types.includes(type);

/** Whether a drop could become a link in a page. */
export const carriesLink = (e: DragEvent) =>
  carries(e, LINK_MIME) || carries(e, "text/uri-list");

/**
 * The thing a drop links to: one of ours picked up in the app, or an
 * Orbyn link dragged in from elsewhere. Null for anything else.
 */
export function droppedLink(e: DragEvent): DraggedLink | null {
  const raw = e.dataTransfer.getData(LINK_MIME);
  if (raw)
    try {
      const v = JSON.parse(raw) as {
        kind: LinkKind;
        id: string;
        title: string;
      };
      const ref = refFromUrl(`orbyn://${v.kind}/${v.id}`);
      if (ref) return { ref, title: String(v.title ?? "") };
    } catch {
      // Not ours after all: fall through to the link itself.
    }
  const uri = e.dataTransfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((l) => l && !l.startsWith("#"));
  const ref = refFromUrl(uri ?? e.dataTransfer.getData("text/plain"));
  return ref ? { ref, title: "" } : null;
}

/**
 * While dragging near the left or right edge of a scrolling row (a board),
 * scroll it along so a far column can be reached.
 */
export function edgeScroll(el: HTMLElement | null, clientX: number) {
  if (!el || el.scrollWidth <= el.clientWidth) return;
  const r = el.getBoundingClientRect();
  const zone = Math.min(80, r.width / 5);
  if (clientX < r.left + zone) el.scrollLeft -= 14;
  else if (clientX > r.right - zone) el.scrollLeft += 14;
}

/** "2026-10-02" for a day on this device's calendar. */
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

/**
 * Handlers that let a calendar day take a dropped task (ORG-06): `onTask`
 * gets its id; `onHover` says when one is held over the day.
 */
export function dayDropTarget(
  onTask: (itemId: string) => void,
  onHover?: (over: boolean) => void,
) {
  return {
    onDragOver: (e: DragEvent) => {
      if (!carries(e, TASK_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      onHover?.(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (
        e.currentTarget instanceof Node &&
        e.currentTarget.contains(e.relatedTarget as Node | null)
      )
        return;
      onHover?.(false);
    },
    onDrop: (e: DragEvent) => {
      onHover?.(false);
      const id = e.dataTransfer.getData(TASK_MIME);
      if (!id) return;
      e.preventDefault();
      onTask(id);
    },
  };
}
