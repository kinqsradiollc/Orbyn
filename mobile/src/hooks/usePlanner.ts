import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import type {
  Item,
  Maintenance,
  Notice,
  Tag,
  TaskList,
  Team,
  User,
} from "@orbyn/core";
import { parseAddDeepLink } from "@orbyn/core";
import { client } from "../lib/api";
import { disablePush } from "../lib/push";
import { clearSession, loadSession, saveSession } from "../lib/session";
import { clearCache, loadCache, saveCache } from "../lib/offlineCache";
import { deviceTimeZone } from "../lib/planning";
import { publishGlance } from "../lib/widget";
import { animateLayout } from "../motion";

export type SignInInput = {
  email: string;
  password: string;
  name: string;
  register: boolean;
  /** A two-step code, when the account has it on. */
  code?: string;
};

/**
 * Session + planner data layer: restores the token from SecureStore, loads
 * items / profile / notifications / teams, refreshes when the app returns to the
 * foreground or a push arrives, and signs out on 401.
 */
export function usePlanner() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState("");
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refreshSeq = useRef(0);
  const [maintenance, setMaintenanceState] = useState<Maintenance | null>(null);
  const maintenanceSnapshot = useRef("null");

  /** Store the maintenance state; unchanged polls don't re-render. */
  const setMaintenance = useCallback((m: Maintenance | null) => {
    const snapshot = JSON.stringify(m);
    if (snapshot === maintenanceSnapshot.current) return;
    maintenanceSnapshot.current = snapshot;
    setMaintenanceState(m);
  }, []);
  /** Silent: no spinner, no busy state, and failures are ignored. */
  const checkMaintenance = useCallback(async () => {
    try {
      setMaintenance(await client.getMaintenance());
    } catch {
      // Older servers have no /maintenance; a later poll tries again.
    }
  }, [setMaintenance]);

  const resetSession = () => {
    void clearCache();
    publishGlance([]);
    setToken("");
    setItems([]);
    setNotices([]);
    setTeams([]);
    setLists([]);
    setTags([]);
    setUser(null);
  };

  /** Run a mutation with busy/error handling; a 401 clears the session. */
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      // A 503 during maintenance carries the admin's message; show it as is
      // and bring the banner up without waiting for the next poll.
      setError((e as Error).message);
      if (status === 503) void checkMaintenance();
      if (status === 401) {
        await clearSession();
        resetSession();
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Reload planner data. With `animate`, rows that move, appear or disappear
   * (e.g. after ticking a checkbox) animate into their new places.
   */
  const lastData = useRef("");
  /** The message from the last failed background refresh, if showing. */
  const backgroundError = useRef("");
  const refresh = useCallback(
    async (options?: { animate?: boolean; silent?: boolean }) => {
      if (!token) return;
      const seq = ++refreshSeq.current;
      // Background refreshes never show the pull-to-refresh spinner.
      if (!options?.silent) setRefreshing(true);
      try {
        const list = await client.listAllItems(500);
        const [u, n, t, l, g] = await Promise.all([
          client.me(),
          client.listNotifications(),
          client.listTeams(),
          // Older servers have no lists or tags; the planner works without them.
          client.listLists().catch((): TaskList[] => []),
          client.listTags().catch((): Tag[] => []),
        ]);
        if (tokenRef.current !== token || seq !== refreshSeq.current) return;
        const snapshot = JSON.stringify([list, u, n, t, l, g]);
        // Nothing changed: skip the re-render entirely.
        if (options?.silent && snapshot === lastData.current) return;
        lastData.current = snapshot;
        if (options?.animate) animateLayout();
        setItems(list);
        setUser(u);
        setNotices(n);
        setTeams(t);
        setLists(l);
        setTags(g);
        // Keep a copy on the device for the next offline / cold start.
        void saveCache({
          items: list,
          user: u,
          notices: n,
          teams: t,
          lists: l,
          tags: g,
        });
        // Refresh the home-screen widget's glance (iOS only; no-ops elsewhere).
        publishGlance(list);
      } finally {
        if (tokenRef.current === token && !options?.silent)
          setRefreshing(false);
      }
    },
    [token],
  );

  /** Reload only lists and tags, after one is created, edited or deleted. */
  const reloadPlanning = useCallback(async () => {
    if (!token) return;
    const [l, g] = await Promise.all([client.listLists(), client.listTags()]);
    if (tokenRef.current !== token) return;
    // The next background refresh compares against fresh data, not stale lists.
    lastData.current = "";
    setLists(l);
    setTags(g);
  }, [token]);

  useEffect(() => {
    loadSession()
      .then(async (t) => {
        setToken(t);
        // Offline-first: show the last data we saved while the network loads
        // (or in its place, when there's no connection).
        if (t) {
          const cached = await loadCache();
          if (cached && tokenRef.current === t) {
            setItems(cached.items);
            if (cached.user) setUser(cached.user);
            setNotices(cached.notices);
            setTeams(cached.teams);
            setLists(cached.lists);
            setTags(cached.tags);
          }
        }
      })
      .catch(() => setError("Unable to restore your session"))
      .finally(() => setReady(true));
  }, []);

  // Quick capture: a Siri Shortcut, home-screen shortcut or share sheet can
  // open `orbyn://add?text=…` to add a task hands-free. Create it and refresh.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const handle = async (url: string | null) => {
      const text = parseAddDeepLink(url);
      if (!text) return;
      try {
        await client.quickAdd(text, deviceTimeZone());
        if (alive && tokenRef.current === token)
          await refresh({ animate: true });
      } catch {
        // Offline or a transient failure: the person can still add it by hand.
      }
    };
    void Linking.getInitialURL().then((u) => {
      if (alive) void handle(u);
    });
    const sub = Linking.addEventListener("url", (e) => void handle(e.url));
    return () => {
      alive = false;
      sub.remove();
    };
  }, [token, refresh]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Background refresh: no spinner, no busy state, and errors stay on
    // screen until a later refresh succeeds (then only its own error clears).
    const background = async () => {
      void checkMaintenance();
      try {
        await refresh({ silent: true });
        if (backgroundError.current) {
          const stale = backgroundError.current;
          backgroundError.current = "";
          setError((current) => (current === stale ? "" : current));
        }
      } catch (e) {
        if ((e as { status?: number }).status === 401) {
          await clearSession();
          resetSession();
          return;
        }
        backgroundError.current = (e as Error).message;
        setError(backgroundError.current);
      }
    };
    const loop = async () => {
      if (AppState.currentState === "active") await background();
      if (alive) timer = setTimeout(loop, 30000);
    };
    void loop();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void background();
    });
    const notification = Notifications.addNotificationReceivedListener(() => {
      void background();
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      sub.remove();
      notification.remove();
    };
  }, [token, refresh, checkMaintenance]);

  /** Register or log in, persist the session and enter the app. Call inside `act`. */
  const signIn = async ({
    email,
    password,
    name,
    register,
    code,
  }: SignInInput): Promise<boolean> => {
    // Clean values: no stray spaces, and a blank name means the default.
    const address = email.trim();
    let result;
    try {
      result = register
        ? await client.register({
            email: address,
            password,
            name: name.trim() || undefined,
          })
        : await client.login({
            email: address,
            password,
            code: code || undefined,
          });
    } catch (e) {
      // Two-step is on: reveal the code field instead of a scary error.
      if ((e as { message?: string }).message === "totp_required") {
        setTwoFactorRequired(true);
        setError("Enter the 6-digit code from your authenticator app.");
        return false;
      }
      throw e;
    }
    setTwoFactorRequired(false);
    await saveSession(result.token);
    setToken(result.token);
    setUser(result.user);
    return true;
  };

  const signOut = () =>
    act(async () => {
      await disablePush();
      await client.logout();
      await clearSession();
      resetSession();
    });

  /** Re-read the signed-in user, e.g. after confirming their email. */
  const refreshUser = () => act(async () => setUser(await client.me()));

  return {
    token,
    ready,
    user,
    setUser,
    items,
    notices,
    teams,
    lists,
    tags,
    reloadPlanning,
    error,
    setError,
    busy,
    refreshing,
    maintenance,
    setMaintenance,
    act,
    refresh,
    signIn,
    signOut,
    refreshUser,
    twoFactorRequired,
    resetTwoFactor: () => setTwoFactorRequired(false),
  };
}

export type Planner = ReturnType<typeof usePlanner>;
