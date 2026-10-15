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
  ready: boolean;
  failed: boolean;
  reload: () => void;
  /** Save the sidebar, shortcuts or Home's layout (each replaced whole). */
  save: (input: SaveInput) => Promise<boolean>;
  /** How one place was left: a task list, the calendar. */
  viewChoice: (place: string) => ViewChoice | undefined;
  setViewChoice: (place: string, choice: ViewChoice | null) => void;
};

/** What `save` replaces whole: the sidebar, shortcuts or Home's layout. */
type SaveInput = Partial<Pick<AccountPrefs, "sidebar" | "shortcuts" | "home">>;

const noop = () => {};
export const PrefsContext = createContext<Prefs>({
  prefs: EMPTY_PREFS,
  ready: false,
  failed: false,
  reload: noop,
  save: async () => false,
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
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const readReady = useRef(false);
  const lifetime = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  const binding = useRef(token);
  binding.current = token;
  const revision = useRef(0);
  const confirmed = useRef<AccountPrefs>(EMPTY_PREFS);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<Record<string, ViewChoice | null>>({});
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    lifetime.current++;
    readReady.current = false;
    setReady(false);
    setFailed(false);
    revision.current++;
    confirmed.current = EMPTY_PREFS;
    setPrefs(EMPTY_PREFS);
    pending.current = {};
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    let live = true;
    const before = revision.current;
    const initial = token
      ? client.getPrefs().then(
          (value) => {
            if (live && binding.current === token) {
              confirmed.current = value;
              readReady.current = true;
              setReady(true);
              if (revision.current === before) setPrefs(value);
            }
          },
          (error) => {
            if (live && binding.current === token) {
              setFailed(true);
              reportRef.current(error);
            }
          },
        )
      : Promise.resolve();
    queue.current = initial;
    return () => {
      live = false;
      mounted.current = false;
      lifetime.current++;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      pending.current = {};
    };
  }, [token, retry]);

  // A debounced view choice must survive an unrelated preference response.
  const reconcile = (value: AccountPrefs) => {
    const views = { ...value.views };
    for (const [place, choice] of Object.entries(pending.current)) {
      if (choice) views[place] = choice;
      else delete views[place];
    }
    return { ...value, views };
  };

  const persist = useCallback(
    (input: Parameters<typeof client.savePrefs>[0], version: number) => {
      const account = binding.current;
      const epoch = lifetime.current;
      const write = queue.current.then(async () => {
        if (
          !account ||
          !mounted.current ||
          binding.current !== account ||
          lifetime.current !== epoch ||
          !readReady.current
        )
          return false;
        try {
          const value = await client.savePrefs(input);
          if (
            !mounted.current ||
            binding.current !== account ||
            lifetime.current !== epoch
          )
            return false;
          confirmed.current = value;
          if (revision.current === version) setPrefs(reconcile(value));
          return true;
        } catch (error) {
          if (
            mounted.current &&
            binding.current === account &&
            lifetime.current === epoch
          ) {
            if (revision.current === version)
              setPrefs(reconcile(confirmed.current));
            reportRef.current(error);
          }
          return false;
        }
      });
      queue.current = write;
      return write;
    },
    [],
  );
  const save = useCallback(
    (input: SaveInput) => {
      if (!readReady.current) {
        reportRef.current(
          new Error("Preferences aren't ready. Reload them before saving."),
        );
        return Promise.resolve(false);
      }
      const version = ++revision.current;
      setPrefs((value) => ({ ...value, ...input }));
      const views = pending.current;
      pending.current = {};
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      return persist(
        Object.keys(views).length ? { ...input, views } : input,
        version,
      );
    },
    [persist],
  );

  const setViewChoice = useCallback(
    (place: string, choice: ViewChoice | null) => {
      if (!readReady.current) return;
      revision.current++;
      setPrefs((value) => {
        const views = { ...value.views };
        if (choice) views[place] = choice;
        else delete views[place];
        return { ...value, views };
      });
      pending.current[place] = choice;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const views = pending.current;
        pending.current = {};
        void persist({ views }, ++revision.current);
      }, 800);
    },
    [persist],
  );
  const viewChoice = useCallback(
    (place: string) => prefs.views[place],
    [prefs.views],
  );
  return {
    prefs,
    ready,
    failed,
    reload: () => setRetry((value) => value + 1),
    save,
    viewChoice,
    setViewChoice,
  };
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
    let request = 0;
    setStarred([]);
    const load = () => {
      const epoch = ++request;
      return client.listStarred().then(
        (list) => live && epoch === request && setStarred(list),
        () => {},
      );
    };
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
