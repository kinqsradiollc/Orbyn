import { useCallback, useEffect, useRef, useState } from "react";
import {
  itemBody,
  type HttpError,
  type Item,
  type Notice,
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refreshSeq = useRef(0);

  const clearSession = () => {
    session.clear();
    setToken("");
    setUser(null);
    setItems([]);
    setNotices([]);
  };

  const refresh = useCallback(async () => {
    if (!token) return;
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const all = await client.listAllItems(500);
      const [u, n] = await Promise.all([
        client.me(),
        client.listNotifications(),
      ]);
      if (tokenRef.current !== token || seq !== refreshSeq.current) return;
      setItems(all);
      setUser(u);
      setNotices(n);
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
        if (alive) {
          setError((e as Error).message);
          if ((e as HttpError).status === 401) clearSession();
        }
      }
      if (alive) timer = setTimeout(loop, 30000);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as HttpError).status === 401) clearSession();
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
    error,
    setError,
    busy,
    loading,
    refresh,
    act,
    clearSession,
    authenticate,
    logout,
    toggleItem,
    markRead,
    setEmailReminders,
  };
}

export type Planner = ReturnType<typeof usePlanner>;
