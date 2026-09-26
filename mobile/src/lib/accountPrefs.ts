import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_PREFS,
  readStartScreen,
  type AccountPrefs,
  type AccountPrefsInput,
  type StarredItem,
  type StartScreen,
  type ViewChoice,
} from "@orbyn/core";
import { client } from "./api";
import { readLocal, saveLocal } from "./localPrefs";

/**
 * Choices that follow the account (NAV-08, SHR-08) on the phone: the one
 * Arrange list (which Workspace rows show, and in what order, shared with
 * the web's sidebar), and view choices. Read once when signed in; saved as
 * they change. What opens at start (NAV-12) stays on this phone.
 */
export function useAccountPrefs(token: string | null) {
  const [prefs, setPrefs] = useState<AccountPrefs>(EMPTY_PREFS);
  useEffect(() => {
    if (!token) {
      setPrefs(EMPTY_PREFS);
      return;
    }
    let live = true;
    client.getPrefs().then(
      (p) => live && setPrefs(p),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [token]);
  const save = useCallback((input: Pick<AccountPrefsInput, "sidebar">) => {
    setPrefs((p) => ({ ...p, ...input }) as AccountPrefs);
    client.savePrefs(input).then(setPrefs, () => {});
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, ViewChoice | null>>({});
  const setViewChoice = useCallback(
    (place: string, choice: ViewChoice | null) => {
      setPrefs((p) => {
        const views = { ...p.views };
        if (choice) views[place] = choice;
        else delete views[place];
        return { ...p, views };
      });
      pending.current[place] = choice;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const views = pending.current;
        pending.current = {};
        client.savePrefs({ views }).catch(() => {});
      }, 800);
    },
    [],
  );
  return { prefs, save, setViewChoice };
}

// ----------------------------------------------------------- the stars ---

const listeners = new Set<() => void>();
/** Something was starred or unstarred: the Starred lists read again. */
export const announceStars = () => listeners.forEach((l) => l());

/** The Starred list (NAV-07), kept fresh as stars change. */
export function useStarred(token: string | null): StarredItem[] {
  const [starred, setStarred] = useState<StarredItem[]>([]);
  useEffect(() => {
    if (!token) {
      setStarred([]);
      return;
    }
    let live = true;
    const load = () =>
      void client.listStarred().then(
        (list) => live && setStarred(list),
        () => {},
      );
    load();
    listeners.add(load);
    return () => {
      live = false;
      listeners.delete(load);
    };
  }, [token]);
  return starred;
}

// ----------------------------------------------- what opens at start ---

const START_KEY = "orbyn-start";
const LAST_PAGE_KEY = "orbyn-last-page";

export const startScreen = (): StartScreen =>
  readStartScreen(readLocal(START_KEY));
export const setStartScreen = (s: StartScreen) => saveLocal(START_KEY, s);
export const lastPage = () => readLocal(LAST_PAGE_KEY);
export const rememberLastPage = (id: string) => saveLocal(LAST_PAGE_KEY, id);
