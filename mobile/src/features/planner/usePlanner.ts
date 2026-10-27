import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PlannerItemStore } from "@orbyn/api-client";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import type {
  Item,
  Maintenance,
  Notice,
  PlannedFeed,
  Tag,
  TaskList,
  Team,
  TodayList,
  User,
} from "@orbyn/core";
import { applyOutbox, dayBounds, isOfflineError } from "@orbyn/core";
import { client } from "../../lib/api";
import { disablePush } from "../../lib/push";
import {
  clearSession,
  loadSession,
  saveSession,
  session,
  setSessionUser,
  SessionStorageError,
  subscribeSession,
} from "../../lib/session";
import {
  clearCache,
  loadCache,
  saveCache,
  purgeCacheTeams,
} from "../../lib/offlineCache";
import {
  clearPageCache,
  forgetLostTeams,
} from "../documents/library/pageCache";
import {
  flush,
  loadOutbox,
  noteOffline,
  noteOnline,
  outboxState,
  subscribeOutbox,
  whenSent,
} from "../../lib/outbox";
import { deviceTimeZone } from "./planning";
import { deviceId } from "../../lib/device";
import { clearGlance, publishGlance } from "../../lib/widget";
import { animateLayout } from "../../motion";
import { errorText } from "../../lib/errors";

/** Planned time and Today are asked for again at least this often. */
const PLANNED_EVERY_MS = 2 * 60_000;

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
  const itemStore = useMemo(
    () => new PlannerItemStore(client, () => session.generation),
    [],
  );
  const items = useSyncExternalStore(
    itemStore.subscribe,
    itemStore.getSnapshot,
  );
  useEffect(() => subscribeSession(() => itemStore.reset()), [itemStore]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const knownTeams = useRef<Team[] | null>(null);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  /** Planned time by task ("Planned 9:15", status chips), for this day. */
  const [planned, setPlanned] = useState<PlannedFeed | null>(null);
  /** The Today list, for this day. */
  const [today, setToday] = useState<TodayList | null>(null);
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
    // The outbox publishes its storage error for Sync details; loading must
    // not create an unhandled rejection while that recovery remains visible.
    void loadOutbox().catch(() => {});
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
    tokenRef.current = "";
    refreshSeq.current++;
    void clearCache();
    void clearPageCache();
    clearGlance();
    setToken("");
    itemStore.reset();
    setNotices([]);
    setTeams([]);
    knownTeams.current = null;
    setLists([]);
    setTags([]);
    setPlanned(null);
    setToday(null);
    kept.current = { planned: null, today: null };
    plannedAt.current = { at: 0, items: "" };
    setUser(null);
  };

  /** Run a mutation with busy/error handling; a 401 clears the session. */
  const act = async (fn: () => Promise<void>) => {
    const owner = tokenRef.current;
    const generation = session.generation;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      // This action may have advanced the generation itself. Its persistence
      // failure belongs to that new generation, unless another login replaced it.
      if (e instanceof SessionStorageError) {
        if (e.generation === session.generation) setError(e.message);
        return;
      }
      if (tokenRef.current !== owner || session.generation !== generation)
        return;
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
        try {
          const cleared = await clearSession(owner);
          if (cleared && !session.token && tokenRef.current === owner)
            resetSession();
        } catch (error) {
          if (
            error instanceof SessionStorageError &&
            error.generation === session.generation
          )
            setError(error.message);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Reload planner data. With `animate`, rows that move, appear or disappear
   * (e.g. after ticking a checkbox) animate into their new places.
   */
  /** The last planned feed and Today list, kept when a later load fails. */
  const kept = useRef<{ planned: PlannedFeed | null; today: TodayList | null }>(
    { planned: null, today: null },
  );
  /** When planned time and Today were last asked for, and the tasks then. */
  const plannedAt = useRef({ at: 0, items: "" });
  const refresh = useCallback(
    async (options?: {
      animate?: boolean;
      silent?: boolean;
      force?: boolean;
      /** Sessions may have changed (news from another device): ask again. */
      planned?: boolean;
    }) => {
      if (!token || session.token !== token || tokenRef.current !== token)
        return;
      let generation = session.generation;
      const seq = ++refreshSeq.current;
      let cacheFailed = false;
      let cacheError: unknown;
      const current = () =>
        tokenRef.current === token &&
        session.token === token &&
        session.generation === generation &&
        seq === refreshSeq.current;
      if (!options?.silent) setRefreshing(true);
      try {
        // An opaque legacy token has no proven account for item/cache ownership.
        let verified: User | undefined;
        if (!session.userId) {
          verified = await client.me();
          if (!current() || !(await setSessionUser(verified.id, token))) return;
          generation = session.generation;
          if (!current()) return;
          setUser(verified);
        }
        const companions = Promise.allSettled([
          verified ? Promise.resolve(verified) : client.me(),
          client.listNotifications(),
          client.listLists(),
          client.listTags(),
        ] as const);
        const [t] = await Promise.allSettled([client.listTeams()]);
        if (!current()) return;
        if (
          t.status === "rejected" &&
          (t.reason as { status?: number }).status === 401
        )
          throw t.reason;
        if (t.status === "fulfilled") {
          const ids = t.value.map((team) => team.id);
          const lostAccess =
            knownTeams.current?.some((team) => !ids.includes(team.id)) ||
            itemStore
              .getSnapshot()
              .some((item) => item.team_id && !ids.includes(item.team_id));
          knownTeams.current = t.value;
          if (lostAccess) {
            clearGlance();
            setLists((current) =>
              current.filter(
                (list) => !list.team_id || ids.includes(list.team_id),
              ),
            );
            setTags((current) =>
              current.filter(
                (tag) => !tag.team_id || ids.includes(tag.team_id),
              ),
            );
            kept.current = { planned: null, today: null };
            setPlanned(null);
            setToday(null);
            plannedAt.current = { at: 0, items: "" };
          }
          itemStore.restrictTeams(ids);
          setTeams(t.value);
          const purges = await Promise.allSettled([
            purgeCacheTeams(ids),
            forgetLostTeams(ids),
          ]);
          if (!current()) return;
          const failed = purges.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") {
            cacheFailed = true;
            cacheError = failed.reason;
          }
        }
        const scope =
          t.status === "fulfilled"
            ? JSON.stringify(
                [...t.value].sort((a, b) => a.id.localeCompare(b.id)),
              )
            : null;
        const [read] = await Promise.allSettled([
          itemStore.refresh(
            scope,
            !!options?.force || !options?.silent,
            t.status === "fulfilled"
              ? t.value.map((team) => team.id)
              : undefined,
          ),
        ]);
        if (!current()) return;
        const list = itemStore.getSnapshot();
        const itemsNow = JSON.stringify(list);
        const ask =
          !options?.silent ||
          !!options?.planned ||
          itemsNow !== plannedAt.current.items ||
          Date.now() - plannedAt.current.at > PLANNED_EVERY_MS;
        const { from, to } = dayBounds(new Date());
        const [[u, n, l, g], p, d] = await Promise.all([
          companions,
          Promise.allSettled([
            ask
              ? client.planned({
                  from: from.toISOString(),
                  to: to.toISOString(),
                })
              : Promise.resolve(kept.current.planned),
          ]).then(([value]) => value),
          Promise.allSettled([
            ask
              ? client.today(deviceTimeZone())
              : Promise.resolve(kept.current.today),
          ]).then(([value]) => value),
        ]);
        if (!current()) return;
        for (const result of [u, n, t, l, g, p, d])
          if (
            result.status === "rejected" &&
            (result.reason as { status?: number }).status === 401
          )
            throw result.reason;
        if (u.status === "fulfilled") {
          if (!(await setSessionUser(u.value.id, token)) || !current()) return;
          setUser(u.value);
        }
        if (options?.animate) animateLayout();
        if (n.status === "fulfilled") setNotices(n.value);
        if (t.status === "fulfilled") {
          setTeams(t.value);
        }
        const visibleTeamIds =
          t.status === "fulfilled" ? t.value.map((team) => team.id) : null;
        const visibleLists =
          l.status === "fulfilled"
            ? l.value.filter(
                (list) =>
                  !list.team_id ||
                  !visibleTeamIds ||
                  visibleTeamIds.includes(list.team_id),
              )
            : null;
        const visibleTags =
          g.status === "fulfilled"
            ? g.value.filter(
                (tag) =>
                  !tag.team_id ||
                  !visibleTeamIds ||
                  visibleTeamIds.includes(tag.team_id),
              )
            : null;
        if (visibleLists) setLists(visibleLists);
        if (visibleTags) setTags(visibleTags);
        if (p.status === "fulfilled") {
          kept.current.planned = p.value;
          setPlanned(p.value);
        }
        if (d.status === "fulfilled") {
          kept.current.today = d.value;
          setToday(d.value);
        }
        if (ask && p.status === "fulfilled" && d.status === "fulfilled")
          plannedAt.current = { at: Date.now(), items: itemsNow };
        // Never replace a complete offline snapshot with fabricated empty fields
        // after a partial companion failure.
        if (
          !cacheFailed &&
          read.status === "fulfilled" &&
          u.status === "fulfilled" &&
          n.status === "fulfilled" &&
          t.status === "fulfilled" &&
          l.status === "fulfilled" &&
          g.status === "fulfilled" &&
          p.status === "fulfilled" &&
          d.status === "fulfilled"
        ) {
          void saveCache({
            items: list,
            user: u.value,
            notices: n.value,
            teams: t.value,
            lists: visibleLists!,
            tags: visibleTags!,
            planned: p.value,
            today: d.value,
          });
        }
        if (read.status === "fulfilled") publishGlance(list);
        if (read.status === "rejected") throw read.reason;
        // Storage faults cannot block connected reads. Surface the fault only
        // after fresh authorized state is visible, without persisting a snapshot.
        if (cacheFailed) throw cacheError;
        for (const result of [u, n, t, l, g, p, d])
          if (result.status === "rejected") throw result.reason;
      } finally {
        if (current() && !options?.silent) setRefreshing(false);
      }
    },
    [token],
  );

  /** Reload only lists and tags, after one is created, edited or deleted. */
  const reloadPlanning = useCallback(async () => {
    if (!token) return;
    const [l, g] = await Promise.all([client.listLists(), client.listTags()]);
    if (tokenRef.current !== token) return;
    setLists(l);
    setTags(g);
  }, [token]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await loadSession();
      const generation = session.generation;
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
        if (
          cached &&
          alive &&
          session.token === t &&
          session.generation === generation &&
          session.userId &&
          cached.user?.id === session.userId
        ) {
          itemStore.seed(cached.items);
          if (cached.user) setUser(cached.user);
          setNotices(cached.notices);
          setTeams(cached.teams);
          knownTeams.current = cached.teams;
          setLists(cached.lists);
          setTags(cached.tags);
          // Planned time and Today too, still before the token (see above).
          // A Today list from another day is only shown on its own day.
          kept.current = {
            planned: cached.planned ?? null,
            today: cached.today ?? null,
          };
          setPlanned(cached.planned ?? null);
          setToday(cached.today ?? null);
        }
      }
      if (alive && session.token === t && session.generation === generation) {
        tokenRef.current = t;
        setToken(t);
      }
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
    const background = async (force = false) => {
      let generation = session.generation;
      const current = () =>
        alive &&
        session.token === token &&
        tokenRef.current === token &&
        session.generation === generation;
      if (!current()) return;
      void checkMaintenance();
      try {
        // Legacy opaque tokens cannot authorize queued work. Confirm identity
        // from the server before the outbox can select an account-owned queue.
        if (!session.userId) {
          const profile = await client.me();
          if (!current()) return;
          if (!(await setSessionUser(profile.id, token))) return;
          generation = session.generation;
          if (!current()) return;
          setUser(profile);
        }
        await flush();
        if (!current()) return;
        await refresh({ silent: true, force });
        // refresh may itself confirm an unidentified session.
        if (!alive || session.token !== token || tokenRef.current !== token)
          return;
        noteOnline();
      } catch (e) {
        if (e instanceof SessionStorageError) {
          if (alive && e.generation === session.generation) setError(e.message);
          return;
        }
        if (!current()) return;
        if ((e as { status?: number }).status === 401) {
          try {
            const cleared = await clearSession(token);
            if (cleared && !session.token && tokenRef.current === token)
              resetSession();
          } catch (error) {
            if (
              error instanceof SessionStorageError &&
              error.generation === session.generation
            )
              setError(error.message);
          }
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
    whenSent(() => {
      if (alive && session.token === token) void background(true);
    });
    const loop = async () => {
      if (AppState.currentState === "active") await background();
      if (alive)
        timer = setTimeout(
          loop,
          Math.max(1, Math.min(30000, itemStore.nextReconcileIn() || 30000)),
        );
    };
    void loop();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void background(true);
    });
    const notification = Notifications.addNotificationReceivedListener(() => {
      void background(true);
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
    // A response from an earlier sign-in must not replace a newer session.
    const startingGeneration = session.generation;
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
    if (session.generation !== startingGeneration) return false;
    setTwoFactorRequired(false);
    const saving = saveSession(result.token, result.user.id);
    const generation = session.generation;
    await saving;
    if (session.generation !== generation || session.token !== result.token)
      return false;
    itemStore.reset();
    tokenRef.current = result.token;
    setToken(result.token);
    setUser(result.user);
    return true;
  };

  const signOut = () =>
    act(async () => {
      const owner = session.token;
      const generation = session.generation;
      const current = () =>
        session.token === owner && session.generation === generation;
      // A previous removal failed after pausing the live identity. Retry only
      // local cleanup; the retained UI keeps this action and its error visible.
      if (!owner) {
        const cleared = await clearSession("");
        if (cleared && !session.token) resetSession();
        return;
      }
      await disablePush();
      if (!current()) return;
      // This phone leaves presence while the session can still say so.
      await client.leavePresence(deviceId()).catch(() => {});
      if (!current()) return;
      await client.logout();
      if (!current()) return;
      // Pending work stays with its account. Discard is an explicit Sync action.
      const cleared = await clearSession(owner);
      if (cleared && !session.token && tokenRef.current === owner)
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
      const owner = session.token;
      const generation = session.generation;
      if (owner) await disablePush().catch(() => {});
      if (session.token !== owner || session.generation !== generation) return;
      const cleared = await clearSession(owner);
      if (cleared && !session.token) resetSession();
    });

  /** Re-read the signed-in user, e.g. after confirming their email. */
  const refreshUser = () =>
    act(async () => {
      const owner = tokenRef.current;
      if (!owner) return;
      try {
        const profile = await client.me();
        if (tokenRef.current !== owner) return;
        if (
          (await setSessionUser(profile.id, owner)) &&
          tokenRef.current === owner
        )
          setUser(profile);
      } catch (error) {
        if (tokenRef.current === owner) throw error;
      }
    });

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
    /** Planned time by task, for this day (null until loaded). */
    planned,
    /** The Today list (null until loaded, or on a server without it). */
    today,
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
