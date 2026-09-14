import type { ServiceState } from "@orbyn/core";

/**
 * A component's state from its most recent checks, newest first. The latest
 * check passing means operational; one failure is degraded; two in a row is
 * an outage.
 */
export function stateFromRecent(recent: boolean[]): ServiceState {
  if (!recent.length) return "unknown";
  if (recent[0]) return "operational";
  return recent[1] === false ? "outage" : "degraded";
}

/** The page headline: the worst state among components that have data. */
export function overallState(states: ServiceState[]): ServiceState {
  if (states.includes("outage")) return "outage";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("operational")) return "operational";
  return "unknown";
}

/** The last `days` UTC dates, oldest first, as YYYY-MM-DD. */
export function lastDays(days: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--)
    out.push(
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
      )
        .toISOString()
        .slice(0, 10),
    );
  return out;
}

/** Postgres numeric averages arrive as strings; missing means no data. */
export const ratio = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
