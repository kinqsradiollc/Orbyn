import type {
  FocusPreparation,
  FocusPreparationResult,
} from "../calendar/focus-lifecycle";
import { useRouteScope, type RouteScope } from "../../lib/route-scope";
import { getSessionVersion, onToken } from "../../lib/session";
import type { Item, ItemInput } from "@orbyn/core";
import { useMemo, useSyncExternalStore } from "react";
import type { OccurrenceRef } from "./draft";

export type LayerOrigin = {
  scope: RouteScope | null;
  /** Opening input authority may be a task overlay/chrome wrapper over the retained origin. */
  inputScope?: RouteScope | null;
  generation: number;
};
export type NewItemInit = {
  origin?: LayerOrigin;
  /** Quick-add words to start from. Nothing is added until confirmed. */
  text?: string;
  /** Fields a new item starts with: a list, a team, a meeting time. */
  prefill?: Partial<ItemInput>;
  onClose?: () => void;
};
export type OpenOptions = {
  origin?: LayerOrigin;
  /** The time of a repeating item it was opened on. */
  occurrence?: OccurrenceRef | null;
  onClose?: () => void;
};

export type PeekTarget = { kind: "doc" | "project"; id: string };

type Layer = {
  open: {
    id: string;
    presentation: number;
    item?: Item;
    options: OpenOptions;
  } | null;
  create: (NewItemInit & { presentation: number }) | null;
  focus: Item | null;
  focusVersion: number;
  focusVisible: boolean;
  focusOrigin?: LayerOrigin;
  error?: string;
  peek: { target: PeekTarget; pinned: boolean; origin?: LayerOrigin } | null;
};

let layer: Layer = {
  open: null,
  create: null,
  focus: null,
  focusVersion: 0,
  focusVisible: false,
  peek: null,
};
const listeners = new Set<() => void>();
let prepareLayer: (() => Promise<boolean>) | null = null;

let prepareFocus: FocusPreparation | null = null;
export function registerFocusPreparation(
  prepare: NonNullable<typeof prepareFocus>,
) {
  prepareFocus = prepare;
  return () => {
    if (prepareFocus === prepare) prepareFocus = null;
  };
}
/** Global timer has an account lifetime, including after its opening tab has closed. */
export async function prepareTaskWorkspaceExit() {
  const opening = layer,
    generation = getSessionVersion(),
    ticket = transition;
  let focusPermit: FocusPreparationResult = false;
  const current = () =>
    generation === getSessionVersion() &&
    layer === opening &&
    ticket === transition &&
    (!opening.focus || (!!focusPermit && focusPermit.current()));
  if (opening.focus) {
    focusPermit = prepareFocus ? await prepareFocus("exit") : false;
    if (!focusPermit) return { allowed: false, current };
  }
  if (!current()) return { allowed: false, current };
  if (
    (opening.open || opening.create) &&
    (!prepareLayer || !(await prepareLayer()))
  )
    return { allowed: false, current };
  return { allowed: current(), current };
}

let transition = 0;
let focusSerial = 0;
let presentationSerial = 0;
let replacing = false;
export function registerTaskPreparation(prepare: () => Promise<boolean>) {
  prepareLayer = prepare;
  return () => {
    if (prepareLayer === prepare) prepareLayer = null;
  };
}
const hasInputAuthority = (origin: LayerOrigin | undefined) => {
  if (!origin) return true;
  if (origin.generation !== getSessionVersion()) return false;
  const route = (origin.inputScope ?? origin.scope)?.getSnapshot();
  return !route || (route.visible && route.focused && !!route.pathname);
};
async function replaceLayer(change: Partial<Layer>, origin?: LayerOrigin) {
  if (replacing || !hasInputAuthority(origin)) return;
  const ticket = ++transition,
    opening = layer,
    generation = getSessionVersion();
  const current = () =>
    ticket === transition &&
    opening === layer &&
    generation === getSessionVersion() &&
    hasInputAuthority(origin);
  replacing = true;
  try {
    const ready =
      !(layer.open || layer.create) ||
      (!!prepareLayer && (await prepareLayer()));
    if (!current()) return;
    let disposition: FocusPreparationResult = false;
    if (ready && opening.focus && change.focus?.id !== opening.focus.id) {
      disposition = prepareFocus
        ? await prepareFocus(change.focus ? "replace" : "hide")
        : false;
      if (!disposition) {
        if (current())
          set({
            error:
              "Save or resolve the current focus session before opening another view.",
          });
        return;
      }
    }
    if (!current() || (disposition && !disposition.current())) return;
    if (!ready) {
      set({
        error: "Resolve or close the current item before opening another.",
      });
      return;
    }
    set({
      ...(opening.focus && !change.focus
        ? {
            focusVisible: false,
            ...(disposition && disposition.kind === "settled"
              ? { focus: null, focusOrigin: undefined }
              : {}),
          }
        : {}),
      ...change,
      error: "",
    });
  } catch {
    if (current())
      set({
        error: "Could not prepare the current item. Its draft is still open.",
      });
  } finally {
    if (ticket === transition) replacing = false;
  }
}

onToken(() => {
  transition++;
  replacing = false;
  prepareLayer = null;
  prepareFocus = null;
  set({
    open: null,
    create: null,
    focus: null,
    focusVisible: false,
    peek: null,
    focusOrigin: undefined,
    error: "",
  });
});
const set = (next: Partial<Layer>) => {
  layer = { ...layer, ...next };
  listeners.forEach((listener) => listener());
};

/**
 * Opens a task or starts a new item from any screen, without leaving it.
 * Works from a click handler or from outside React; a `TaskHost` draws them.
 */
export function detachTaskLayer() {
  transition++;
  replacing = false;
  prepareLayer = null;
  set({ open: null, create: null, peek: null });
}
export const tasks = {
  open(target: string | Item, options: OpenOptions = {}) {
    const id = typeof target === "string" ? target : target.id;
    const item = typeof target === "string" ? undefined : target;
    void replaceLayer(
      {
        open: { id, presentation: ++presentationSerial, item, options },
        create: null,
      },
      options.origin,
    );
  },
  /** Closes the panel; pass an id to close only that task. */
  close(id?: string, expected?: NonNullable<Layer["open"]>) {
    if (
      !layer.open ||
      (id && layer.open.id !== id) ||
      (expected && layer.open !== expected)
    )
      return;
    const done = layer.open.options.onClose;
    set({ open: null });
    done?.();
  },
  create(init: NewItemInit = {}) {
    void replaceLayer(
      { create: { ...init, presentation: ++presentationSerial }, open: null },
      init.origin,
    );
  },
  closeCreate(expected?: NewItemInit) {
    if (expected && layer.create !== expected) return;
    const done = layer.create?.onClose;
    set({ create: null });
    done?.();
  },
  focus(item: Item, origin?: LayerOrigin) {
    void replaceLayer(
      {
        open: null,
        create: null,
        focus: item,
        focusVersion: ++focusSerial,
        focusVisible: true,
        focusOrigin: origin,
      },
      origin,
    );
  },
  hideFocus(
    expected: Item,
    expectedOrigin: LayerOrigin | undefined,
    expectedVersion: number,
  ) {
    if (
      layer.focus !== expected ||
      layer.focusOrigin !== expectedOrigin ||
      layer.focusVersion !== expectedVersion ||
      !layer.focusVisible
    )
      return;
    set({ focusVisible: false });
  },
  closeFocus(
    expected?: Item,
    expectedOrigin?: LayerOrigin,
    expectedVersion?: number,
  ) {
    if (
      (expected && layer.focus !== expected) ||
      (expectedOrigin && layer.focusOrigin !== expectedOrigin) ||
      (expectedVersion !== undefined && layer.focusVersion !== expectedVersion)
    )
      return;
    set({ focus: null, focusOrigin: undefined, focusVisible: false });
  },
  /** Reads a page or project beside the screen you are on. */
  peek(
    target: PeekTarget | { kind: "task"; id: string },
    origin?: LayerOrigin,
  ) {
    if (target.kind === "task") tasks.open(target.id, { origin });
    else set({ peek: { target, pinned: layer.peek?.pinned ?? false, origin } });
  },
  pinPeek(pinned: boolean) {
    if (layer.peek) set({ peek: { ...layer.peek, pinned } });
  },
  closePeek(expected?: NonNullable<Layer["peek"]>) {
    if (expected && layer.peek !== expected) return;
    set({ peek: null });
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useTaskLayer = () => useSyncExternalStore(subscribe, () => layer);
/** `{ open, close, create }`, stable across renders. */
export function useTasks() {
  const scope = useRouteScope(),
    generation = getSessionVersion();
  return useMemo(() => {
    const origin = {
      scope: scope?.originScope ?? scope,
      inputScope: scope,
      generation,
    };
    const current = () =>
      generation === getSessionVersion() &&
      (!scope || (scope.getSnapshot().visible && scope.getSnapshot().focused));
    return {
      ...tasks,
      open: (target: string | Item, options: OpenOptions = {}) => {
        if (current()) tasks.open(target, { ...options, origin });
      },
      create: (init: NewItemInit = {}) => {
        if (current()) tasks.create({ ...init, origin });
      },
      peek: (target: PeekTarget | { kind: "task"; id: string }) => {
        if (current()) tasks.peek(target, origin);
      },
      focus: (item: Item) => {
        if (current()) tasks.focus(item, origin);
      },
      close: (id?: string) => {
        if (
          generation === getSessionVersion() &&
          layer.open?.options.origin?.scope === origin.scope &&
          layer.open.options.origin.generation === generation
        )
          tasks.close(id);
      },
      closeCreate: () => {
        if (
          generation === getSessionVersion() &&
          layer.create?.origin?.scope === origin.scope &&
          layer.create.origin.generation === generation
        )
          tasks.closeCreate();
      },
      closePeek: () => {
        if (
          generation === getSessionVersion() &&
          layer.peek?.origin?.scope === origin.scope &&
          layer.peek.origin.generation === generation
        )
          tasks.closePeek();
      },
      pinPeek: (pinned: boolean) => {
        if (
          current() &&
          layer.peek?.origin?.scope === origin.scope &&
          layer.peek.origin.generation === generation
        )
          tasks.pinPeek(pinned);
      },
      closeFocus: () => {
        if (
          generation === getSessionVersion() &&
          layer.focusOrigin?.scope === origin.scope &&
          layer.focusOrigin.generation === generation
        )
          tasks.closeFocus();
      },
      openFromAction: async (target: string | Item) => {
        if (generation !== getSessionVersion()) return;
        if (scope?.activateNavigate) {
          const s = scope.getSnapshot();
          const result = await scope.activateNavigate(
            s.pathname + s.search + s.hash,
            true,
          );
          if (result.kind !== "committed") return;
        }
        if (generation === getSessionVersion()) tasks.open(target, { origin });
      },
    };
  }, [scope, generation]);
}
