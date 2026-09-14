import { useCallback, useEffect, useRef, useState } from "react";
import {
  itemBody,
  type HttpError,
  type Item,
  type Notice,
  type Team,
  type User,
} from "@orbyn/core";
import { client } from "../lib/api";
import { session } from "../lib/session";

export type AuthMode = "register" | "login";

/**
 * Data layer for the planner: session token, user/items/notices, the 30s
 * refresh loop (while the tab is visible), and the `act` wrapper that tracks
 * busy/error state and signs out on 401.
 */
export function usePlanner() {
  const [token, setToken] = useState(() => session.get());
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  /** Bumps after every successful refresh so dependent views can reload. */
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refreshSeq = useRef(0);

  const clearSession = useCallback(() => {
    session.clear();
    setToken("");
    setUser(null);
    setItems([]);
    setNotices([]);
    setTeams([]);
  }, []);

  /** Surface an error in the banner; a 401 signs the user out. */
  const report = useCallback(
    (e: unknown) => {
      setError((e as Error).message);
      if ((e as HttpError).status === 401) clearSession();
    },
    [clearSession],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const all = await client.listAllItems(500);
      const [u, n, t] = await Promise.all([
        client.me(),
        client.listNotifications(),
        client.listTeams(),
      ]);
      if (tokenRef.current !== token || seq !== refreshSeq.current) return;
      setItems(all);
      setUser(u);
      setNotices(n);
      setTeams(t);
      setRevision((r) => r + 1);
    } finally {
      if (tokenRef.current === token) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      try {
        if (document.visibilityState === "visible") await refresh();
      } catch (e) {
        if (alive) report(e);
      }
      if (alive) timer = setTimeout(loop, 30000);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh, report]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const authenticate = (mode: AuthMode, values: Record<string, string>) =>
    act(async () => {
      const result =
        mode === "register"
          ? await client.register({
              name: values.name,
              email: values.email,
              password: values.password,
            })
          : await client.login({
              email: values.email,
              password: values.password,
            });
      session.set(result.token);
      setToken(result.token);
      setUser(result.user);
    });

  const logout = () =>
    act(async () => {
      await client.logout();
      clearSession();
    });

  const toggleItem = (i: Item) =>
    act(async () => {
      await client.updateItem(i.id, {
        ...itemBody(i),
        status: i.status === "done" ? "todo" : "done",
      });
      await refresh();
    });

  const markRead = (n: Notice) =>
    act(async () => {
      await client.markNotificationRead(n.id);
      await refresh();
    });

  const setEmailReminders = (checked: boolean) =>
    act(async () => {
      setUser(await client.updatePreferences({ email_reminders: checked }));
    });

  return {
    token,
    user,
    items,
    notices,
    teams,
    revision,
    error,
    setError,
    busy,
    loading,
    refresh,
    act,
    report,
    clearSession,
    authenticate,
    logout,
    toggleItem,
    markRead,
    setEmailReminders,
  };
}

export type Planner = ReturnType<typeof usePlanner>;
