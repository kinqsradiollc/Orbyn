import {
  DEFAULT_HOME,
  EMPTY_PREFS,
  type AccountPrefs,
  type AccountPrefsInput,
  type HomeLayout,
  type ViewChoice,
} from "@orbyn/core";
import { useEffect, useSyncExternalStore } from "react";
import { messageOf } from "../../lib/resource";
import { client, getToken, onToken } from "../../lib/session";

export type PrefsState = {
  prefs: AccountPrefs;
  phase: "loading" | "ready" | "error";
  error: string;
};

const EMPTY: PrefsState = { prefs: EMPTY_PREFS, phase: "loading", error: "" };
const listeners = new Set<() => void>();
let state = EMPTY;
let started = false;
let run = 0;
let queue: Promise<unknown> = Promise.resolve();

const publish = (next: Partial<PrefsState>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

/** Reads the account's choices. Only the newest read for this account counts. */
export async function reloadPrefs() {
  const token = getToken();
  const id = ++run;
  started = true;
  publish({ phase: state.phase === "ready" ? "ready" : "loading", error: "" });
  try {
    const prefs = await client.getPrefs();
    if (id === run && token === getToken()) publish({ prefs, phase: "ready" });
  } catch (error) {
    if (id === run && token === getToken())
      publish({
        phase: state.phase === "ready" ? "ready" : "error",
        error: messageOf(error, "Couldn't load your layout."),
      });
  }
}

onToken(() => {
  run++;
  started = false;
  queue = Promise.resolve();
  state = EMPTY;
  listeners.forEach((listener) => listener());
  if (listeners.size) void reloadPrefs();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The account's layout choices, kept for the whole session. */
export function usePrefs() {
  useEffect(() => {
    if (!started) void reloadPrefs();
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * Saves in order, shown at once. A failed write puts back what the server
 * last agreed to, and throws so the caller can keep its draft and say why.
 */
export function savePrefs(input: AccountPrefsInput): Promise<void> {
  if (state.phase !== "ready")
    return Promise.reject(
      new Error("Your layout hasn't loaded. Reload it before saving."),
    );
  const token = getToken();
  const before = state.prefs;
  const { views, ...whole } = input;
  const nextViews = { ...before.views };
  for (const [place, choice] of Object.entries(views ?? {})) {
    if (choice) nextViews[place] = choice;
    else delete nextViews[place];
  }
  publish({
    prefs: { ...before, ...(whole as Partial<AccountPrefs>), views: nextViews },
  });
  const write = queue.then(async () => {
    if (token !== getToken()) return;
    try {
      const prefs = await client.savePrefs(input);
      if (token === getToken()) publish({ prefs });
    } catch (error) {
      if (token === getToken()) publish({ prefs: before });
      throw error;
    }
  });
  queue = write.catch(() => undefined);
  return write;
}

export const saveHome = (home: HomeLayout) => savePrefs({ home });
export const saveViewChoice = (place: string, choice: ViewChoice | null) =>
  savePrefs({ views: { [place]: choice } });
export const homeOf = (prefs: AccountPrefs) => prefs.home ?? DEFAULT_HOME;
