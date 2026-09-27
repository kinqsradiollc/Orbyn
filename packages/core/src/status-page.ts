import type { ServiceState, StatusComponent, StatusIncident } from "./types.js";

/**
 * The status page, told compactly on the web and on phones: components in
 * a few groups (healthy groups fold to one line), active incidents first,
 * and past ones as a short list you can open. The wording lives here so the
 * two apps say the same thing.
 */

/** Groups in display order, by component id. Unknown ids go in "Other". */
export const STATUS_GROUPS: { id: string; name: string; ids: string[] }[] = [
  {
    id: "core",
    name: "Planner and sync",
    ids: ["gateway", "api", "realtime", "database"],
  },
  { id: "ai", name: "Assistant and agents", ids: ["ai", "mcp"] },
  {
    id: "background",
    name: "Reminders and imports",
    ids: ["notifier", "converter"],
  },
];

const STATE_RANK: Record<ServiceState, number> = {
  outage: 3,
  degraded: 2,
  unknown: 1,
  operational: 0,
};

/**
 * The worst state among components that have data: an outage beats slow,
 * slow beats fine, and "no data yet" only when nothing has data.
 */
export function worstState(states: ServiceState[]): ServiceState {
  if (states.includes("outage")) return "outage";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("operational")) return "operational";
  return "unknown";
}

/** Whether a state needs attention, so its group opens by itself. */
export const isProblemState = (state: ServiceState) =>
  state === "outage" || state === "degraded";

export type StatusGroup = {
  id: string;
  name: string;
  state: ServiceState;
  components: StatusComponent[];
  /** Components that are not operational, worst first. */
  problems: StatusComponent[];
  /** The lowest 90-day uptime among its components; null with no data. */
  uptime: number | null;
};

/** Components gathered into their groups, in order; empty groups left out. */
export function groupStatusComponents(
  components: StatusComponent[],
): StatusGroup[] {
  const known = new Set(STATUS_GROUPS.flatMap((g) => g.ids));
  const groups = [
    ...STATUS_GROUPS.map((g) => ({
      id: g.id,
      name: g.name,
      list: components.filter((c) => g.ids.includes(c.id)),
    })),
    {
      id: "other",
      name: "Other",
      list: components.filter((c) => !known.has(c.id)),
    },
  ];
  return groups
    .filter((g) => g.list.length)
    .map((g) => {
      const uptimes = g.list
        .map((c) => c.uptime.quarter)
        .filter((u): u is number => u !== null);
      return {
        id: g.id,
        name: g.name,
        state: worstState(g.list.map((c) => c.state)),
        components: g.list,
        problems: g.list
          .filter((c) => isProblemState(c.state))
          .sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state]),
        uptime: uptimes.length ? Math.min(...uptimes) : null,
      };
    });
}

/** "7 of 8 operational", or "All 8 components operational" with a noun. */
export function groupSummary(components: StatusComponent[], noun = ""): string {
  const ok = components.filter((c) => c.state === "operational").length;
  const n = components.length;
  const what = noun ? ` ${noun}` : "";
  if (!components.some((c) => c.state !== "unknown")) return "No data yet";
  if (ok === n) return n === 1 ? "Operational" : `All ${n}${what} operational`;
  return `${ok} of ${n}${what} operational`;
}

export type IncidentSeverity = "major" | "minor" | "brief";

export const incidentSeverityLabels: Record<IncidentSeverity, string> = {
  major: "Major",
  minor: "Minor",
  brief: "Brief",
};

/**
 * How serious an incident was, by how long it lasted: an hour or more (or
 * still going after one) is major, five minutes or more is minor, anything
 * shorter is brief.
 */
export function incidentSeverity(
  incident: Pick<StatusIncident, "duration_s">,
): IncidentSeverity {
  if (incident.duration_s >= 3600) return "major";
  if (incident.duration_s >= 300) return "minor";
  return "brief";
}

/** Ongoing incidents first (newest first), then the rest, newest first. */
export function splitIncidents(incidents: StatusIncident[]) {
  const newest = (a: StatusIncident, b: StatusIncident) =>
    b.started_at.localeCompare(a.started_at);
  return {
    active: incidents.filter((i) => i.resolved_at === null).sort(newest),
    past: incidents.filter((i) => i.resolved_at !== null).sort(newest),
  };
}

export type IncidentUpdate = {
  /** ISO time of the update, or null for "still going" (now). */
  at: string | null;
  kind: "started" | "resolved" | "ongoing";
  text: string;
};

/**
 * An incident's updates, newest first. Incidents are found from the checks
 * themselves (two or more failed in a row), so the updates are when checks
 * started failing and when they passed again.
 */
export function incidentUpdates(incident: StatusIncident): IncidentUpdate[] {
  const started: IncidentUpdate = {
    at: incident.started_at,
    kind: "started",
    text: `${incident.name} started failing its checks.`,
  };
  const latest: IncidentUpdate = incident.resolved_at
    ? {
        at: incident.resolved_at,
        kind: "resolved",
        text: `Resolved: ${incident.name} is passing its checks again.`,
      }
    : {
        at: null,
        kind: "ongoing",
        text: "Still failing. We check again every 30 seconds.",
      };
  return [latest, started];
}

/** The page's opening line: how many parts are fine, and any incidents. */
export function statusSummary(
  components: StatusComponent[],
  incidents: StatusIncident[],
): string {
  const { active, past } = splitIncidents(incidents);
  const parts = [groupSummary(components, "components")];
  if (active.length)
    parts.push(
      `${active.length} ongoing incident${active.length === 1 ? "" : "s"}`,
    );
  parts.push(
    past.length
      ? `${past.length} past incident${past.length === 1 ? "" : "s"} in 30 days`
      : "No past incidents in 30 days",
  );
  return parts.join(" · ");
}
