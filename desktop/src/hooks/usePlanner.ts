import { useCallback, useEffect, useRef, useState } from "react";
import {
  type HttpError,
  type Item,
  type Maintenance,
  type Notice,
  type Status,
  type Team,
  type User,
} from "@orbyn/core";
import { startAuthentication } from "@simplewebauthn/browser";
import { client } from "../lib/api";
import { deviceId } from "../lib/device";
import { celebrate } from "../lib/celebrate";
import { onSessionChange, session } from "../lib/session";
import { deviceTimeZone } from "../lib/planning";
import { errorText } from "../lib/errors";
import { chatgptStore } from "../lib/chatgpt";

export type AuthMode = "register" | "login";

/**
 * Data layer for the planner: session token, user/items/notices, the 30s
 * refresh loop (while the tab is visible), and the `act` wrapper that tracks
 * busy/error state and signs out on 401.
 */
export function usePlanner() {
  const [token, setToken] = useState(() => session.get());
  const [user, setUser] = useState<User | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  /** Bumps after every successful refresh so dependent views can reload. */
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  /** Maintenance mode, for the banner. Null until the first check. */
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refreshSeq = useRef(0);
  const lastData = useRef("");

  const clearSession = useCallback(() => {
    tokenRef.current = "";
    refreshSeq.current++;
    lastData.current = "";
    session.clear();
    setToken("");
    setUser(null);
    setItems([]);
    setNotices([]);
    setTeams([]);
    setMaintenance(null);
  }, []);

  // Another tab signed in or out: follow it, so every tab shows the same account.
  useEffect(
    () =>
      onSessionChange((next) => {
        if (next === tokenRef.current) return;
        if (next) {
          tokenRef.current = next;
          refreshSeq.current++;
          lastData.current = "";
          setUser(null);
          setItems([]);
          setNotices([]);
          setTeams([]);
          setMaintenance(null);
          setError("");
          setToken(next);
        } else clearSession();
      }),
    [clearSession],
  );

  // Tell the server which zone this device is in, once per sign-in, so what
  // it writes (agendas, digests, reminders) and working hours are in your
  // time rather than UTC. Ignored when you've picked a zone in settings.
  useEffect(() => {
    if (!token) return;
    client.reportTimeZone(deviceTimeZone()).catch(() => {
      // The next start tries again.
    });
  }, [token]);

  const lastMaintenance = useRef("");
  /** Apply a maintenance state, re-rendering only when it changed. */
  const applyMaintenance = useCallback((m: Maintenance) => {
    const snapshot = JSON.stringify(m);
    if (snapshot === lastMaintenance.current) return;
    lastMaintenance.current = snapshot;
    setMaintenance(m);
  }, []);

  /** Silent maintenance check: failures are ignored until the next one. */
  const refreshMaintenance = useCallback(async () => {
    try {
      applyMaintenance(await client.getMaintenance());
    } catch {
      // Keep the last known state.
    }
  }, [applyMaintenance]);

  /**
   * Surface an error in the banner; a 401 signs the user out. A 503 during
   * maintenance carries the server's message, and the banner is re-checked.
   */
  const report = useCallback(
    (e: unknown, options?: { quiet?: boolean }) => {
      // errorText also writes the details to the console.
      const text = errorText(e);
      // Something the person did shows its failure; a background refresh
      // failing (a blip, a deploy) only goes to the console, and the last
      // data stays on screen.
      if (!options?.quiet) setError(text);
      const status = (e as HttpError).status;
      if (status === 401) clearSession();
      if (status === 503) void refreshMaintenance();
    },
    [clearSession, refreshMaintenance],
  );

  useEffect(() => {
    void chatgptStore.syncSession(token || null);
  }, [token]);
  // Account identity must not wait for planner pagination or other boot reads.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loadProfile = async (initial = false) => {
      if (!initial && document.visibilityState !== "visible") {
        if (alive) timer = setTimeout(loadProfile, 30000);
        return;
      }
      try {
        const profile = await client.me();
        if (alive && tokenRef.current === token) setUser(profile);
      } catch (e) {
        if (alive && tokenRef.current === token) report(e);
      }
      if (alive) timer = setTimeout(loadProfile, 30000);
    };
    void loadProfile(true);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, report]);

  /**
   * Reload planner data. Background refreshes pass `silent`: no loading
   * indicator, and nothing re-renders when the data is unchanged.
   */
  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!token) return;
      const seq = ++refreshSeq.current;
      if (!options?.silent) setLoading(true);
      try {
        const all = await client.listAllItems(500);
        const [n, t] = await Promise.all([
          client.listNotifications(),
          client.listTeams(),
        ]);
        if (tokenRef.current !== token || seq !== refreshSeq.current) return;
        const snapshot = JSON.stringify([all, n, t]);
        if (options?.silent && snapshot === lastData.current) return;
        lastData.current = snapshot;
        setItems(all);
        setNotices(n);
        setTeams(t);
        setRevision((r) => r + 1);
      } finally {
        if (tokenRef.current === token && !options?.silent) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      try {
        if (document.visibilityState === "visible") {
          if (tokenRef.current) void refreshMaintenance();
          await refresh({ silent: true });
        }
      } catch (e) {
        if (alive) report(e, { quiet: true });
      }
      if (alive) timer = setTimeout(loop, 30000);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh, report, refreshMaintenance]);

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

  /** Adopt a session from a flow that returns one directly (password reset). */
  const adoptSession = (result: { token: string; user: User }) => {
    session.set(result.token);
    tokenRef.current = result.token;
    setToken(result.token);
    setUser(result.user);
  };

  /** Re-read the signed-in user, e.g. after confirming their email. */
  const refreshUser = () =>
    act(async () => {
      const owner = tokenRef.current;
      if (!owner) return;
      try {
        const profile = await client.me();
        if (tokenRef.current === owner) setUser(profile);
      } catch (error) {
        if (tokenRef.current === owner) throw error;
      }
    });

  const authenticate = (mode: AuthMode, values: Record<string, string>) =>
    act(async () => {
      let result;
      try {
        result =
          mode === "register"
            ? await client.register({
                name: values.name,
                email: values.email,
                password: values.password,
                accept_terms: values.accept_terms || undefined,
              })
            : await client.login({
                email: values.email,
                password: values.password,
                code: values.code || undefined,
              });
      } catch (e) {
        // The account has two-step on: reveal the code field, no scary error.
        if ((e as { message?: string }).message === "totp_required") {
          setTwoFactorRequired(true);
          setError("Enter the 6-digit code from your authenticator app.");
          return;
        }
        throw e;
      }
      setTwoFactorRequired(false);
      session.set(result.token);
      tokenRef.current = result.token;
      setToken(result.token);
      setUser(result.user);
    });

  /** Sign in with a passkey. Optional email narrows the credential list. */
  const passkeyLogin = (email?: string) =>
    act(async () => {
      const { handle, options } = await client.passkeyLoginOptions(email);
      // The browser prompts for the device/biometric here; a cancel throws.
      const response = await startAuthentication({
        optionsJSON: options as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      const result = await client.passkeyLogin(handle, response);
      setTwoFactorRequired(false);
      session.set(result.token);
      tokenRef.current = result.token;
      setToken(result.token);
      setUser(result.user);
    });

  const logout = () =>
    act(async () => {
      // This device leaves presence while the session can still say so.
      await client.leavePresence(deviceId()).catch(() => {});
      await client.logout();
      clearSession();
    });

  /** Status changes go through the timeline so everyone sees who moved what. */
  const setItemStatus = (i: Item, status: Status) =>
    act(async () => {
      await client.postItemUpdate(i.id, { status });
      if (status === "done" && i.status !== "done") celebrate();
      await refresh();
    });

  /** Quick-complete: done, or back to in progress / to do when reopened. */
  const toggleItem = (i: Item) =>
    setItemStatus(
      i,
      i.status !== "done"
        ? "done"
        : (i.progress ?? 0) > 0
          ? "in_progress"
          : "todo",
    );

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
    maintenance,
    applyMaintenance,
    refresh,
    act,
    report,
    clearSession,
    authenticate,
    twoFactorRequired,
    resetTwoFactor: () => setTwoFactorRequired(false),
    adoptSession,
    passkeyLogin,
    refreshUser,
    logout,
    toggleItem,
    setItemStatus,
    markRead,
    setEmailReminders,
  };
}

export type Planner = ReturnType<typeof usePlanner>;
