import { useEffect, useState } from "react";
import type { BusyInterval, Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { LIST_COLORS } from "../../lib/planning";

/** Up to this many teammates on the calendar at once. */
export const MAX_MATES = 5;
const MATES_KEY = "orbyn-calendar-teammates";
/** One colour per teammate shown, taken from the list palette. */
const MATE_COLORS = [
  LIST_COLORS[2],
  LIST_COLORS[3],
  LIST_COLORS[6],
  LIST_COLORS[5],
  LIST_COLORS[1],
];

/** Someone in one or more of your teams. */
export type Mate = { user_id: string; name: string; pinned: boolean };

/** A teammate's busy times (never what they are). */
export type MateBusy = {
  user_id: string;
  name: string;
  color: string;
  busy: BusyInterval[];
};

const savedMates = (): string[] => {
  try {
    const value: unknown = JSON.parse(readLocal(MATES_KEY) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((x): x is string => typeof x === "string")
          .slice(0, MAX_MATES)
      : [];
  } catch {
    return [];
  }
};

export type Teammates = ReturnType<typeof useTeammates>;

/**
 * "Show teammates": the people in your teams (pinned people first), up to
 * five chosen (remembered on this device), and their busy times in
 * [from, to) from one availability request. Members load the first time
 * they're needed; `recheck` reloads the busy times (after a calendar reload).
 */
export function useTeammates(
  teams: Team[],
  pinnedIds: string[],
  from: string,
  to: string,
  recheck: unknown,
) {
  const [mates, setMates] = useState<Mate[] | null>(null);
  const [selected, setSelectedState] = useState<string[]>(savedMates);
  const [busy, setBusy] = useState<Record<string, BusyInterval[]>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [wanted, setWanted] = useState(false);
  const [error, setError] = useState("");
  const teamKey = teams.map((t) => t.id).join(",");
  const pinnedKey = pinnedIds.join(",");
  const needed = wanted || selected.length > 0;

  useEffect(() => {
    if (!needed) return;
    let alive = true;
    Promise.all([
      client.me().catch(() => null),
      Promise.all(teams.map((t) => client.getTeam(t.id).catch(() => null))),
    ])
      .then(([me, details]) => {
        if (!alive) return;
        const byId = new Map<string, Mate>();
        for (const team of details)
          for (const m of team?.members ?? [])
            if (m.user_id !== me?.id && !byId.has(m.user_id))
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
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // Teams and pins are compared by id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, teamKey, pinnedKey]);

  const selectedKey = selected.join(",");
  useEffect(() => {
    if (!selected.length) {
      setBusy({});
      return;
    }
    let alive = true;
    client
      .availability(selected, from, to)
      .then((people) => {
        if (!alive) return;
        const next: Record<string, BusyInterval[]> = {};
        const named: Record<string, string> = {};
        for (const a of people) {
          next[a.user_id] = a.busy;
          named[a.user_id] = a.name;
        }
        setBusy(next);
        setNames(named);
        setError("");
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // Selection is compared by id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, from, to, recheck]);

  const setSelected = (next: string[]) => {
    setSelectedState(next);
    saveLocal(MATES_KEY, JSON.stringify(next));
  };
  const toggle = (id: string) =>
    setSelected(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : selected.length >= MAX_MATES
          ? selected
          : [...selected, id],
    );
  const colorOf = (id: string) =>
    MATE_COLORS[Math.max(0, selected.indexOf(id)) % MATE_COLORS.length];
  const shown: MateBusy[] = selected.map((id) => ({
    user_id: id,
    name: names[id] ?? mates?.find((m) => m.user_id === id)?.name ?? "Teammate",
    color: colorOf(id),
    busy: busy[id] ?? [],
  }));

  return {
    mates,
    selected,
    shown,
    error,
    toggle,
    colorOf,
    clear: () => setSelected([]),
    /** Load the members (when the picker opens). */
    load: () => setWanted(true),
  };
}
