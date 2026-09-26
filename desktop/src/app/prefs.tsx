import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  EMPTY_PREFS,
  readStartScreen,
  type AccountPrefs,
  type AccountPrefsInput,
  type StarredItem,
  type StartScreen,
  type ViewChoice,
} from "@orbyn/core";
import { client } from "../lib/api";

/**
 * Choices that follow the account (NAV-08, NAV-09, SHR-08): the sidebar's
 * Arrange list, changed shortcuts and view choices, read once when signed
 * in and saved as they change. A view choice is saved a moment after the
 * last change, so dragging through layouts doesn't send each one.
 */
export type Prefs = {
  prefs: AccountPrefs;
  /** Save the sidebar or shortcuts (replaced whole). */
  save: (input: Pick<AccountPrefsInput, "sidebar" | "shortcuts">) => void;
  /** How one place was left: a task list, the calendar. */
  viewChoice: (place: string) => ViewChoice | undefined;
  setViewChoice: (place: string, choice: ViewChoice | null) => void;
};

const noop = () => {};
export const PrefsContext = createContext<Prefs>({
  prefs: EMPTY_PREFS,
  save: noop,
  viewChoice: () => undefined,
  setViewChoice: noop,
});

export const usePrefs = () => useContext(PrefsContext);

/** The account's choices, for the provider at the top of the app. */
export function useAccountPrefs(
  token: string | null,
  report: (e: unknown) => void,
): Prefs {
  const [prefs, setPrefs] = useState<AccountPrefs>(EMPTY_PREFS);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    if (!token) {
      setPrefs(EMPTY_PREFS);
      return;
    }
    let live = true;
    client.getPrefs().then(
      (p) => live && setPrefs(p),
      () => {
        // The app works with its own defaults until the next sign-in.
      },
    );
    return () => {
      live = false;
    };
  }, [token]);

  const save = useCallback(
    (input: Pick<AccountPrefsInput, "sidebar" | "shortcuts">) => {
      setPrefs((p) => ({ ...p, ...input }) as AccountPrefs);
      client.savePrefs(input).then(setPrefs, (e) => reportRef.current(e));
    },
    [],
  );

  const pending = useRef<Record<string, ViewChoice | null>>({});
  const timer = useRef<number | null>(null);
  const setViewChoice = useCallback(
    (place: string, choice: ViewChoice | null) => {
      setPrefs((p) => {
        const views = { ...p.views };
        if (choice) views[place] = choice;
        else delete views[place];
        return { ...p, views };
      });
      pending.current[place] = choice;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const views = pending.current;
        pending.current = {};
        client.savePrefs({ views }).catch(() => {
          // A view choice not saved is kept for this visit; nothing to say.
        });
      }, 800);
    },
    [],
  );
  const viewChoice = useCallback(
    (place: string) => prefs.views[place],
    [prefs.views],
  );
  return { prefs, save, viewChoice, setViewChoice };
}

// ----------------------------------------------------------- the stars ---

/** Something was starred or unstarred: the Starred group reads again. */
export const STARS_CHANGED = "orbyn:stars-changed";
export const announceStars = () =>
  window.dispatchEvent(new Event(STARS_CHANGED));

/** The Starred group's items (NAV-07), kept fresh as stars change. */
export function useStarred(token: string | null): StarredItem[] {
  const [starred, setStarred] = useState<StarredItem[]>([]);
  useEffect(() => {
    if (!token) {
      setStarred([]);
      return;
    }
    let live = true;
    const load = () =>
      client.listStarred().then(
        (list) => live && setStarred(list),
        () => {},
      );
    void load();
    window.addEventListener(STARS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(STARS_CHANGED, load);
    };
  }, [token]);
  return starred;
}

// ----------------------------------------------- what opens at start ---

const START_KEY = "orbyn-start";
const LAST_PAGE_KEY = "orbyn-last-page";

/** What opens at start on this device (NAV-12). */
export function startScreen(): StartScreen {
  try {
    return readStartScreen(localStorage.getItem(START_KEY));
  } catch {
    return "overview";
  }
}
export function setStartScreen(s: StartScreen) {
  try {
    localStorage.setItem(START_KEY, s);
  } catch {
    // Storage can be blocked; the choice lasts this visit.
  }
}
/** The page last open on this device, for "Open to: last page". */
export function lastPage(): string | null {
  try {
    return localStorage.getItem(LAST_PAGE_KEY);
  } catch {
    return null;
  }
}
export function rememberLastPage(id: string) {
  try {
    localStorage.setItem(LAST_PAGE_KEY, id);
  } catch {
    // Nothing to remember it in.
  }
}
