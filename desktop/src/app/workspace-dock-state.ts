import type { ObjectRef } from "@orbyn/core";

export type DockTab =
  | { id: "notifications"; kind: "notifications"; title: string }
  | { id: string; kind: "object"; title: string; target: ObjectRef };
export type DockState = {
  account: string | null;
  tabs: DockTab[];
  activeId: string;
  open: boolean;
};
export const initialDock = (account: string | null): DockState => ({
  account,
  tabs: [],
  activeId: "",
  open: false,
});
export const objectDockId = (target: ObjectRef) =>
  `object:${target.kind}:${target.id}`;
export type DockAction =
  | { type: "reset"; account: string | null }
  | { type: "open"; account: string | null; target?: ObjectRef }
  | { type: "select" | "close"; account: string | null; id: string }
  | { type: "title"; account: string | null; id: string; title: string }
  | { type: "hide"; account: string | null };

/** Panel navigation never mutates workspace tabs, URLs or the main view. */
export function dockReducer(state: DockState, action: DockAction): DockState {
  if (action.type === "reset") return initialDock(action.account);
  if (!action.account || action.account !== state.account) return state;
  if (action.type === "hide") return { ...state, open: false };
  if (action.type === "open") {
    const id = action.target ? objectDockId(action.target) : "notifications";
    if (state.tabs.some((tab) => tab.id === id))
      return { ...state, activeId: id, open: true };
    // Never silently evict a mounted panel, its form or pending operation.
    if (state.tabs.length >= 8) return state;
    const tab: DockTab = action.target
      ? {
          id,
          kind: "object",
          target: action.target,
          title:
            action.target.kind === "doc"
              ? "Page"
              : action.target.kind === "project"
                ? "Project"
                : "Task",
        }
      : { id: "notifications", kind: "notifications", title: "Notifications" };
    return { ...state, tabs: [...state.tabs, tab], activeId: id, open: true };
  }
  if (!state.tabs.some((tab) => tab.id === action.id)) return state;
  if (action.type === "select")
    return { ...state, activeId: action.id, open: true };
  if (action.type === "title")
    return state.tabs.find((tab) => tab.id === action.id)?.title ===
      action.title
      ? state
      : {
          ...state,
          tabs: state.tabs.map((tab) =>
            tab.id === action.id ? { ...tab, title: action.title } : tab,
          ),
        };
  const index = state.tabs.findIndex((tab) => tab.id === action.id);
  const tabs = state.tabs.filter((tab) => tab.id !== action.id);
  return {
    ...state,
    tabs,
    activeId:
      action.id === state.activeId
        ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? "")
        : state.activeId,
    open: tabs.length > 0 && state.open,
  };
}
