import {
  addDays,
  dayTime,
  type BusyInterval,
  type CalendarView,
  type PlannerPrefsInput,
  type Team,
} from "@orbyn/core";
import type { LiveNews } from "@orbyn/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import { refreshPlanner, useItems, usePlanning } from "../shared-task";
import { fieldEntry } from "./model";

/** Everything around the calendar: the shared planner's picture of it. */
export function useWorkspace() {
  const planning = usePlanning();
  const items = useItems();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const refreshTasks = useCallback(() => refreshPlanner(true), []);
  const savePrefs = useCallback(async (input: PlannerPrefsInput) => {
    await client.updatePlannerPrefs(input);
    await refreshPlanner(true).catch(() => undefined);
  }, []);
  return {
    ...planning,
    items,
    itemById,
    itemsLoading: planning.phase === "loading",
    refreshTasks,
    savePrefs,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;

/** One calendar read per range and account; a read for old dates never shows. */
export function useRange(
  account: string,
  first: string,
  count: number,
  tz: string | undefined,
) {
  const from = tz ? dayTime(first, 0, tz).toISOString() : "";
  const to = tz ? dayTime(addDays(first, count), 0, tz).toISOString() : "";
  const key = `${account}:${from}:${to}`;
  const view = useResource(async () => {
    if (!from) return undefined;
    return { key, view: await client.calendar(from, to) };
  }, [key]);
  const fieldKey = `${key}:${first}:${count}`;
  const fields = useResource(async () => {
    if (!tz) return undefined;
    return {
      key: fieldKey,
      dates: await client.fieldDates(first, addDays(first, count)),
    };
  }, [fieldKey]);

  const { set } = view;
  const patch = useCallback(
    (update: (view: CalendarView) => CalendarView) =>
      set((current) => current && { ...current, view: update(current.view) }),
    [set],
  );
  const current = view.data?.key === key ? view.data.view : undefined;
  const fieldDates =
    fields.data?.key === fieldKey && tz
      ? fields.data.dates.map((d) => fieldEntry(d, tz))
      : [];
  return {
    from,
    to,
    view: current,
    loading: view.loading,
    error: view.error,
    reload: view.reload,
    patch,
    fieldDates,
    fieldsError: fields.error,
    reloadFields: fields.reload,
  };
}

const MATES_KEY = "orbyn-calendar-teammates";
export const MAX_MATES = 5;
/** One colour per teammate shown, from the tokens so both themes read. */
const MATE_COLORS = [
  "var(--accent)",
  "var(--warn)",
  "var(--ok)",
  "var(--danger)",
  "var(--text-soft)",
];

type Mate = { user_id: string; name: string; pinned: boolean };

const savedMates = (): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MATES_KEY) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((x): x is string => typeof x === "string")
          .slice(0, MAX_MATES)
      : [];
  } catch {
    return [];
  }
};

export type MateBusy = {
  user_id: string;
  name: string;
  color: string;
  busy: BusyInterval[];
};

/**
 * Up to five teammates' busy times, never what they are. The people load the
 * first time they're needed; the choice is kept on this device.
 */
export function useTeammates(
  teams: Team[],
  userId: string | undefined,
  pinnedIds: string[],
  from: string,
  to: string,
  active: boolean,
) {
  const [mates, setMates] = useState<Mate[] | null>(null);
  const [selected, setSelectedState] = useState<string[]>(savedMates);
  const [busy, setBusy] = useState<Record<string, BusyInterval[]>>({});
  const [wanted, setWanted] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const needed = wanted || selected.length > 0;
  const teamKey = teams.map((t) => t.id).join(",");
  const pinnedKey = pinnedIds.join(",");
  const selectedKey = selected.join(",");

  useEffect(() => {
    if (!needed || !teams.length) return;
    let alive = true;
    setError("");
    Promise.all(teams.map((t) => client.getTeam(t.id))).then(
      (details) => {
        if (!alive) return;
        const byId = new Map<string, Mate>();
        for (const team of details)
          for (const m of team.members)
            if (m.user_id !== userId && !byId.has(m.user_id))
              byId.set(m.user_id, {
                user_id: m.user_id,
                name: m.name,
                pinned: pinnedIds.includes(m.user_id),
              });
        setMates(
          [...byId.values()].sort(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) ||
              a.name.localeCompare(b.name),
          ),
        );
      },
      () => alive && setError("Couldn't load your teams."),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, teamKey, userId, pinnedKey, attempt]);

  useEffect(() => {
    if (!active || !selected.length || !mates || !from) {
      setBusy({});
      return;
    }
    let alive = true;
    client.availability(selected, from, to).then(
      (people) => {
        if (!alive) return;
        const next: Record<string, BusyInterval[]> = {};
        for (const a of people) next[a.user_id] = a.busy;
        setBusy(next);
      },
      () => alive && setError("Couldn't load busy times."),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selectedKey, mates, from, to, attempt]);

  const setSelected = (next: string[]) => {
    setSelectedState(next);
    try {
      localStorage.setItem(MATES_KEY, JSON.stringify(next));
    } catch {
      // The choice lasts this visit.
    }
  };
  const colorOf = (id: string) =>
    MATE_COLORS[Math.max(0, selected.indexOf(id)) % MATE_COLORS.length];
  const shown: MateBusy[] = !active
    ? []
    : selected
        .filter((id) => !mates || mates.some((m) => m.user_id === id))
        .map((id) => ({
          user_id: id,
          name: mates?.find((m) => m.user_id === id)?.name ?? "Teammate",
          color: colorOf(id),
          busy: busy[id] ?? [],
        }));
  return {
    mates,
    selected,
    shown,
    error,
    retry: () => setAttempt((n) => n + 1),
    colorOf,
    load: () => setWanted(true),
    clear: () => setSelected([]),
    toggle: (id: string) =>
      setSelected(
        selected.includes(id)
          ? selected.filter((x) => x !== id)
          : selected.length >= MAX_MATES
            ? selected
            : [...selected, id],
      ),
  };
}

export type Teammates = ReturnType<typeof useTeammates>;

const newsListeners = new Set<(news: LiveNews) => void>();
let stopNews: (() => void) | null = null;

/** One news stream however many things listen: the gateway limits them. */
export function onNews(listener: (news: LiveNews) => void) {
  newsListeners.add(listener);
  stopNews ??= client.watchEvents((news) =>
    newsListeners.forEach((each) => each(news)),
  );
  return () => {
    newsListeners.delete(listener);
    if (newsListeners.size) return;
    stopNews?.();
    stopNews = null;
  };
}

const LIVE_GAP_MS = 5_000;

/**
 * Calls back after changes to items, at most once per gap however busy the
 * account is, and at once on focus news.
 */
export function useLive(onChanged: () => void, onFocus?: () => void) {
  const latest = useRef({ onChanged, onFocus });
  latest.current = { onChanged, onFocus };
  useEffect(() => {
    let timer = 0;
    let last = 0;
    const stop = onNews((news) => {
      if (news.kind === "focus") latest.current.onFocus?.();
      if (news.kind !== "changed" || timer) return;
      if (news.area && news.area !== "items") return;
      timer = window.setTimeout(
        () => {
          timer = 0;
          last = Date.now();
          latest.current.onChanged();
        },
        Math.max(400, last + LIVE_GAP_MS - Date.now()),
      );
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);
}
