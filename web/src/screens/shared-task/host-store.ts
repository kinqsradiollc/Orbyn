import type { Item, ItemInput } from "@orbyn/core";
import { useSyncExternalStore } from "react";
import type { OccurrenceRef } from "./draft";

export type NewItemInit = {
  /** Quick-add words to start from. Nothing is added until confirmed. */
  text?: string;
  /** Fields a new item starts with: a list, a team, a meeting time. */
  prefill?: Partial<ItemInput>;
  onClose?: () => void;
};
export type OpenOptions = {
  /** The time of a repeating item it was opened on. */
  occurrence?: OccurrenceRef | null;
  onClose?: () => void;
};

export type PeekTarget = { kind: "doc" | "project"; id: string };

type Layer = {
  open: { id: string; item?: Item; options: OpenOptions } | null;
  create: NewItemInit | null;
  focus: Item | null;
  peek: { target: PeekTarget; pinned: boolean } | null;
};

let layer: Layer = { open: null, create: null, focus: null, peek: null };
const listeners = new Set<() => void>();
const set = (next: Partial<Layer>) => {
  layer = { ...layer, ...next };
  listeners.forEach((listener) => listener());
};

/**
 * Opens a task or starts a new item from any screen, without leaving it.
 * Works from a click handler or from outside React; a `TaskHost` draws them.
 */
export const tasks = {
  open(target: string | Item, options: OpenOptions = {}) {
    const id = typeof target === "string" ? target : target.id;
    const item = typeof target === "string" ? undefined : target;
    set({ open: { id, item, options } });
  },
  /** Closes the panel; pass an id to close only that task. */
  close(id?: string) {
    if (!layer.open || (id && layer.open.id !== id)) return;
    const done = layer.open.options.onClose;
    set({ open: null });
    done?.();
  },
  create(init: NewItemInit = {}) {
    set({ create: init });
  },
  closeCreate() {
    const done = layer.create?.onClose;
    set({ create: null });
    done?.();
  },
  focus(item: Item) {
    set({ open: null, focus: item });
  },
  closeFocus() {
    set({ focus: null });
  },
  /** Reads a page or project beside the screen you are on. */
  peek(target: PeekTarget | { kind: "task"; id: string }) {
    if (target.kind === "task") tasks.open(target.id);
    else set({ peek: { target, pinned: layer.peek?.pinned ?? false } });
  },
  pinPeek(pinned: boolean) {
    if (layer.peek) set({ peek: { ...layer.peek, pinned } });
  },
  closePeek() {
    set({ peek: null });
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useTaskLayer = () => useSyncExternalStore(subscribe, () => layer);
/** `{ open, close, create }`, stable across renders. */
export const useTasks = () => tasks;
