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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const account = useRef(token);
  account.current = token;
  const mounted = useRef(false);
  const readReady = useRef(false);
  const lifetime = useRef(0);
  const confirmed = useRef<AccountPrefs>(EMPTY_PREFS);
  const version = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, ViewChoice | null>>({});
  useEffect(() => {
    mounted.current = true;
    lifetime.current++;
    readReady.current = false;
    version.current++;
    setReady(false);
    setError("");
    setPrefs(EMPTY_PREFS);
    confirmed.current = EMPTY_PREFS;
    pending.current = {};
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    let live = true;
    queue.current = token
      ? client.getPrefs().then(
          (value) => {
            if (!live || account.current !== token) return;
            confirmed.current = value;
            readReady.current = true;
            setPrefs(value);
            setReady(true);
          },
          () => {
            if (live && account.current === token)
              setError("Couldn't load preferences.");
          },
        )
      : Promise.resolve();
    return () => {
      live = false;
      mounted.current = false;
      lifetime.current++;
      readReady.current = false;
      version.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current = {};
    };
  }, [token, retry]);
  const reconcile = useCallback((value: AccountPrefs) => {
    const views = { ...value.views };
    for (const [place, choice] of Object.entries(pending.current)) {
      if (choice) views[place] = choice;
      else delete views[place];
    }
    return { ...value, views };
  }, []);
  const persist = useCallback(
    (input: AccountPrefsInput, revision: number) => {
      const owner = account.current;
      const epoch = lifetime.current;
      const write = queue.current.then(async () => {
        if (
          !owner ||
          !mounted.current ||
          account.current !== owner ||
          lifetime.current !== epoch ||
          !readReady.current
        )
          return false;
        try {
          const value = await client.savePrefs(input);
          if (
            !mounted.current ||
            account.current !== owner ||
            lifetime.current !== epoch
          )
            return false;
          confirmed.current = value;
          if (version.current === revision) {
            setPrefs(reconcile(value));
            setError("");
          }
          return true;
        } catch {
          if (
            mounted.current &&
            account.current === owner &&
            lifetime.current === epoch &&
            version.current === revision
          ) {
            setPrefs(reconcile(confirmed.current));
            setError("Couldn't save preferences. Retry your change.");
          }
          return false;
        }
      });
      queue.current = write;
      return write;
    },
    [reconcile],
  );
  const save = useCallback(
    (input: Pick<AccountPrefsInput, "sidebar">) => {
      if (!readReady.current) return Promise.resolve(false);
      const revision = ++version.current;
      setPrefs((value) => ({ ...value, ...input }) as AccountPrefs);
      const views = pending.current;
      pending.current = {};
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      return persist(
        Object.keys(views).length ? { ...input, views } : input,
        revision,
      );
    },
    [persist],
  );
  const setViewChoice = useCallback(
    (place: string, choice: ViewChoice | null) => {
      if (!readReady.current) return;
      version.current++;
      setPrefs((value) => {
        const views = { ...value.views };
        if (choice) views[place] = choice;
        else delete views[place];
        return { ...value, views };
      });
      pending.current[place] = choice;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const views = pending.current;
        pending.current = {};
        void persist({ views }, ++version.current);
      }, 800);
    },
    [persist],
  );
  return {
    prefs,
    ready,
    error,
    reload: () => setRetry((value) => value + 1),
    save,
    setViewChoice,
  };
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
    let request = 0;
    setStarred([]);
    const load = () => {
      const epoch = ++request;
      return void client.listStarred().then(
        (list) => live && epoch === request && setStarred(list),
        () => {},
      );
    };
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
