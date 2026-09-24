import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
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
import { applyOutbox, isOfflineError } from "@orbyn/core";
import { client } from "../lib/api";
import { disablePush } from "../lib/push";
import { clearSession, loadSession, saveSession } from "../lib/session";
import { clearCache, loadCache, saveCache } from "../lib/offlineCache";
import {
  clearOutbox,
  flush,
  loadOutbox,
  noteOffline,
  noteOnline,
  outboxState,
  subscribeOutbox,
  whenSent,
} from "../lib/outbox";
import { deviceTimeZone } from "../lib/planning";
import { deviceId } from "../lib/device";
import { clearGlance, publishGlance } from "../lib/widget";
import { animateLayout } from "../motion";
import { errorText } from "../lib/errors";

export type SignInInput = {
  email: string;
  password: string;
  name: string;
  register: boolean;
  /** A two-step code, when the account has it on. */
  code?: string;
  /** The Terms version agreed to on the sign-up form. */
  acceptTerms?: string;
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
  // Changes made offline and not sent yet, shown as if they had happened.
  const [outbox, setOutbox] = useState(outboxState);
  useEffect(() => {
    void loadOutbox();
    return subscribeOutbox(setOutbox);
  }, []);
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
    clearGlance();
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
      setError(
        isOfflineError(e)
          ? "You're offline, and this needs a connection. Your other changes are kept on this phone."
          : errorText(e),
      );
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
    let alive = true;
    (async () => {
      const t = await loadSession();
      // Offline-first: show the last data we saved while the network loads
      // (or in its place, when there's no connection).
      //
      // The cache goes in *before* the token, because setting the token is
      // what starts the first refresh. Applied after, a cache that resolved
      // late would overwrite the fresher data that refresh had already put
      // on screen — which on a fast connection is every time, and leaves the
      // app looking empty while the server has just answered.
      if (t) {
        const cached = await loadCache();
        if (cached && alive) {
          setItems(cached.items);
          if (cached.user) setUser(cached.user);
          setNotices(cached.notices);
          setTeams(cached.teams);
          setLists(cached.lists);
          setTags(cached.tags);
        }
      }
      if (alive) setToken(t);
    })()
      .catch(() => alive && setError("Unable to restore your session"))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Background refresh: no spinner, no busy state, and errors stay on
    // screen until a later refresh succeeds (then only its own error clears).
    const background = async () => {
      void checkMaintenance();
      // Anything made offline goes first, so the refresh below includes it.
      await flush();
      try {
        await refresh({ silent: true });
        noteOnline();
      } catch (e) {
        if ((e as { status?: number }).status === 401) {
          await clearSession();
          resetSession();
          return;
        }
        // No connection isn't an error to show: the sync pill says so, and
        // the last data stays on screen.
        if (isOfflineError(e)) {
          noteOffline();
          return;
        }
        // A background refresh failing (a blip, a deploy) goes to the log;
        // the last data stays on screen and the next refresh tries again.
        errorText(e, "Refreshing the planner");
      }
    };
    whenSent(() => void refresh({ silent: true }).catch(() => {}));
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
    acceptTerms,
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
            accept_terms: acceptTerms || undefined,
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
      // This phone leaves presence while the session can still say so.
      await client.leavePresence(deviceId()).catch(() => {});
      await client.logout();
      await clearOutbox();
      await clearSession();
      resetSession();
    });

  // Tell the server which zone this phone is in, once per sign-in, so what
  // it writes (agendas, digests, reminders) and working hours are in your
  // time rather than UTC. Ignored when you've picked a zone in settings.
  useEffect(() => {
    if (!token) return;
    client.reportTimeZone(deviceTimeZone()).catch(() => {
      // The next start tries again.
    });
  }, [token]);

  /** Forget this sign-in on the phone only: the account is already gone. */
  const forgetSession = () =>
    act(async () => {
      await disablePush().catch(() => {});
      await clearOutbox();
      await clearSession();
      resetSession();
    });

  /** Re-read the signed-in user, e.g. after confirming their email. */
  const refreshUser = () => act(async () => setUser(await client.me()));

  const shownItems = useMemo(
    () => applyOutbox(items, outbox.entries),
    [items, outbox.entries],
  );

  return {
    token,
    ready,
    user,
    setUser,
    items: shownItems,
    /** Changes made offline, waiting or needing a decision. */
    outbox,
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
    forgetSession,
    refreshUser,
    twoFactorRequired,
    resetTwoFactor: () => setTwoFactorRequired(false),
  };
}

export type Planner = ReturnType<typeof usePlanner>;
