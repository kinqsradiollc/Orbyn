import {
  initialTabs,
  restoreTabs,
  saveTabs,
  type TabsState,
  type WorkspaceTab,
} from "@orbyn/core";
import { persistentDestination } from "./destination";

const LIMIT = 512 * 1024;
const PREFIX = "orbyn-web-workspace-v1:";
export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;
export type StorageResult<T> = { value: T; error: string };
const keyFor = (userId: string) => {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(userId))
    throw new Error("Workspace needs a verified user ID.");
  return PREFIX + userId;
};

function project(state: TabsState): TabsState {
  const tabs: WorkspaceTab[] = [];
  for (const tab of state.tabs) {
    let at = -1;
    const history = tab.history.flatMap((place, index) => {
      const safe = persistentDestination(place);
      if (!safe) return [];
      if (index <= tab.at) at++;
      return [safe];
    });
    if (history.length)
      tabs.push({
        ...tab,
        history,
        at: Math.max(0, Math.min(at, history.length - 1)),
      });
  }
  if (!tabs.length) return initialTabs();
  return {
    ...state,
    tabs,
    active: tabs.some((tab) => tab.key === state.active)
      ? state.active
      : tabs[0].key,
    closed: [],
  };
}

export function loadWorkspace(
  storage: WorkspaceStorage,
  userId: string,
): StorageResult<TabsState | null> {
  try {
    const raw = storage.getItem(keyFor(userId));
    if (raw === null) return { value: null, error: "" };
    if (raw.length > LIMIT) throw new Error("Workspace snapshot is too large.");
    const envelope: unknown = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== "object" ||
      !("version" in envelope) ||
      envelope.version !== 1 ||
      !("userId" in envelope) ||
      envelope.userId !== userId ||
      !("tabs" in envelope) ||
      typeof envelope.tabs !== "string" ||
      envelope.tabs.length > LIMIT
    )
      throw new Error("Workspace snapshot is unreadable.");
    const parsed: unknown = JSON.parse(envelope.tabs);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("tabs" in parsed) ||
      !Array.isArray(parsed.tabs) ||
      parsed.tabs.length > 8
    )
      throw new Error("Workspace snapshot has invalid tab counts.");
    if (
      !("seq" in parsed) ||
      !Number.isSafeInteger(parsed.seq) ||
      (parsed.seq as number) < 0 ||
      (parsed.seq as number) > 999999999999
    )
      throw new Error("Workspace snapshot has an invalid sequence.");
    for (const tab of parsed.tabs) {
      if (
        !tab ||
        typeof tab !== "object" ||
        !Array.isArray(tab.history) ||
        tab.history.length > 50 ||
        typeof tab.key !== "string" ||
        !/^t\d{1,12}$/.test(tab.key) ||
        !Number.isSafeInteger(tab.opened) ||
        tab.opened < 0 ||
        tab.opened > 999999999999
      )
        throw new Error("Workspace snapshot has invalid history.");
    }
    // Parse core shape, then apply web route authority and redaction again.
    return { value: project(restoreTabs(envelope.tabs)), error: "" };
  } catch (error) {
    return {
      value: null,
      error:
        error instanceof Error
          ? error.message
          : "Couldn't restore this workspace.",
    };
  }
}

export function saveWorkspace(
  storage: WorkspaceStorage,
  userId: string,
  primary: TabsState,
): StorageResult<boolean> {
  try {
    const tabs = saveTabs(project(primary));
    const raw = JSON.stringify({ version: 1, userId, tabs });
    if (raw.length > LIMIT) throw new Error("Workspace snapshot is too large.");
    storage.setItem(keyFor(userId), raw);
    return { value: true, error: "" };
  } catch (error) {
    return {
      value: false,
      error:
        error instanceof Error
          ? error.message
          : "Workspace isn't saved on this device.",
    };
  }
}
