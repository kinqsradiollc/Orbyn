import { useEffect, useState, type CSSProperties } from "react";
import { Pin } from "lucide-react";
import type { BusyInterval, Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { Popover } from "../../components/Popover";

/** Up to this many teammates on the calendar at once. */
export const MAX_MATES = 5;
const MATES_KEY = "orbyn-calendar-teammates";
/** One colour per teammate shown (readable in both themes). */
const MATE_COLORS = ["#4f7aa8", "#8a6bb0", "#c28c30", "#3f8f8a", "#b0573b"];

/** Someone in one or more of your teams. */
type Mate = {
  user_id: string;
  name: string;
  teamIds: string[];
  pinned: boolean;
};

/** A teammate's busy times (never what they are). */
export type MateBusy = {
  user_id: string;
  name: string;
  color: string;
  busy: BusyInterval[];
};

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

export type Teammates = ReturnType<typeof useTeammates>;

/**
 * "Show teammates": the people in your teams (pinned people first), up to
 * five chosen (remembered on this device), and their busy times in
 * [from, to), merged across the teams you share with each. Members load
 * the first time they're needed; busy times load while `active`.
 */
export function useTeammates(
  teams: Team[],
  userId: string | undefined,
  pinnedIds: string[],
  from: Date,
  to: Date,
  active: boolean,
  report: (e: unknown) => void,
) {
  const [mates, setMates] = useState<Mate[] | null>(null);
  const [selected, setSelectedState] = useState<string[]>(savedMates);
  const [busy, setBusy] = useState<Record<string, BusyInterval[]>>({});
  const [wanted, setWanted] = useState(false);
  const teamKey = teams.map((t) => t.id).join(",");
  const pinnedKey = pinnedIds.join(",");
  const needed = wanted || selected.length > 0;

  useEffect(() => {
    if (!needed || !teams.length) return;
    let alive = true;
    Promise.all(teams.map((t) => client.getTeam(t.id))).then(
      (details) => {
        if (!alive) return;
        const byId = new Map<string, Mate>();
        for (const team of details)
          for (const m of team.members) {
            if (m.user_id === userId) continue;
            const known = byId.get(m.user_id);
            if (known) known.teamIds.push(team.id);
            else
              byId.set(m.user_id, {
                user_id: m.user_id,
                name: m.name,
                teamIds: [team.id],
                pinned: pinnedIds.includes(m.user_id),
              });
          }
        setMates(
          [...byId.values()].sort(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) ||
              a.name.localeCompare(b.name),
          ),
        );
      },
      (e) => alive && report(e),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, teamKey, userId, pinnedKey]);

  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const selectedKey = selected.join(",");
  useEffect(() => {
    if (!active || !selected.length || !mates) {
      setBusy({});
      return;
    }
    const teamIds = [
      ...new Set(
        mates
          .filter((m) => selected.includes(m.user_id))
          .flatMap((m) => m.teamIds),
      ),
    ];
    let alive = true;
    Promise.all(
      teamIds.map((id) => client.teamAvailability(id, fromIso, toIso)),
    ).then(
      (lists) => {
        if (!alive) return;
        const next: Record<string, BusyInterval[]> = {};
        for (const list of lists)
          for (const a of list)
            if (selected.includes(a.user_id))
              (next[a.user_id] ??= []).push(...a.busy);
        setBusy(next);
      },
      (e) => alive && report(e),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selectedKey, mates, fromIso, toIso]);

  const setSelected = (next: string[]) => {
    setSelectedState(next);
    try {
      localStorage.setItem(MATES_KEY, JSON.stringify(next));
    } catch {
      // The choice lasts this visit.
    }
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
  const shown: MateBusy[] = !active
    ? []
    : selected
        .filter((id) => !mates || mates.some((m) => m.user_id === id))
        .map((id) => ({
          user_id: id,
          name: mates?.find((m) => m.user_id === id)?.name ?? "…",
          color: colorOf(id),
          busy: busy[id] ?? [],
        }));

  return {
    mates,
    selected,
    shown,
    toggle,
    colorOf,
    clear: () => setSelected([]),
    /** Load the members (when the menu opens). */
    load: () => setWanted(true),
  };
}

const swatch = (color: string) => ({ "--mate": color }) as CSSProperties;

/** Choosing teammates to show, from the calendar toolbar. */
export function TeammatesMenu({
  anchor,
  teammates: t,
  onClose,
}: {
  anchor: DOMRect;
  teammates: Teammates;
  onClose: () => void;
}) {
  return (
    <Popover anchor={anchor} label="Show teammates" onClose={onClose}>
      <div className="popover-head">
        <small className="eyebrow">SHOW TEAMMATES</small>
        <small>
          Their busy times show beside each day, never what they are. Up to{" "}
          {MAX_MATES} people.
        </small>
      </div>
      {t.mates === null ? (
        <p className="popover-note">Loading your teams…</p>
      ) : !t.mates.length ? (
        <p className="popover-note">No one else is in your teams yet.</p>
      ) : (
        <div className="popover-actions mates-list">
          {t.mates.map((m) => {
            const on = t.selected.includes(m.user_id);
            return (
              <label key={m.user_id} className="popover-check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && t.selected.length >= MAX_MATES}
                  onChange={() => t.toggle(m.user_id)}
                />
                <span>
                  {m.name}
                  {m.pinned && <Pin size={11} aria-label="Pinned" />}
                </span>
                {on && (
                  <i
                    className="mate-swatch"
                    style={swatch(t.colorOf(m.user_id))}
                    aria-hidden="true"
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      {t.selected.length > 0 && (
        <button className="text-button" onClick={t.clear}>
          Hide everyone
        </button>
      )}
    </Popover>
  );
}

/** Who's shown and their colours, under the toolbar. */
export function TeammatesLegend({
  shown,
  onClear,
}: {
  shown: MateBusy[];
  onClear: () => void;
}) {
  if (!shown.length) return null;
  return (
    <div className="mates-legend" role="group" aria-label="Teammates shown">
      <span className="mates-legend-label">Busy:</span>
      {shown.map((m) => (
        <span key={m.user_id} className="mates-legend-item">
          <i style={swatch(m.color)} aria-hidden="true" />
          {m.name}
        </span>
      ))}
      <button className="text-button" onClick={onClear}>
        Hide
      </button>
    </div>
  );
}
