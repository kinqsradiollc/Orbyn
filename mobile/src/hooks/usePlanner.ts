import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import type { Item, Notice, Team, User } from "@orbyn/core";
import { client } from "../lib/api";
import { disablePush } from "../lib/push";
import { clearSession, loadSession, saveSession } from "../lib/session";
import { animateLayout } from "../motion";

export type SignInInput = {
  email: string;
  password: string;
  name: string;
  register: boolean;
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refreshSeq = useRef(0);

  const resetSession = () => {
    setToken("");
    setItems([]);
    setNotices([]);
    setTeams([]);
    setUser(null);
  };

  /** Run a mutation with busy/error handling; a 401 clears the session. */
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 401) {
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
        const [u, n, t] = await Promise.all([
          client.me(),
          client.listNotifications(),
          client.listTeams(),
        ]);
        if (tokenRef.current !== token || seq !== refreshSeq.current) return;
        const snapshot = JSON.stringify([list, u, n, t]);
        // Nothing changed: skip the re-render entirely.
        if (options?.silent && snapshot === lastData.current) return;
        lastData.current = snapshot;
        if (options?.animate) animateLayout();
        setItems(list);
        setUser(u);
        setNotices(n);
        setTeams(t);
      } finally {
        if (tokenRef.current === token && !options?.silent)
          setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadSession()
      .then((t) => setToken(t))
      .catch(() => setError("Unable to restore your session"))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Background refresh: no spinner, no busy state, and errors stay on
    // screen until a later refresh succeeds (then only its own error clears).
    const background = async () => {
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
  }, [token, refresh]);

  /** Register or log in, persist the session and enter the app. Call inside `act`. */
  const signIn = async ({ email, password, name, register }: SignInInput) => {
    const result = register
      ? await client.register({ email, password, name })
      : await client.login({ email, password });
    await saveSession(result.token);
    setToken(result.token);
    setUser(result.user);
  };

  const signOut = () =>
    act(async () => {
      await disablePush();
      await client.logout();
      await clearSession();
      resetSession();
    });

  return {
    token,
    ready,
    user,
    setUser,
    items,
    notices,
    teams,
    error,
    setError,
    busy,
    refreshing,
    act,
    refresh,
    signIn,
    signOut,
  };
}

export type Planner = ReturnType<typeof usePlanner>;
