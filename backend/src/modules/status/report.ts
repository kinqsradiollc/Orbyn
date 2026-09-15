import type {
  StatusComponent,
  StatusIncident,
  StatusReport,
} from "@orbyn/core";
import { readPool } from "../../db/pool.js";
import { settings } from "../../lib/settings.js";
import { components } from "./components.js";
import { lastDays, overallState, ratio, stateFromRecent } from "./uptime.js";

const CACHE_MS = 15_000;
let cache: { at: number; report: StatusReport } | null = null;

/** Clears the in-process cache (tests). */
export const clearStatusCache = () => {
  cache = null;
};

/**
 * The public status report: current state, uptime over 24 hours, 7 days and
 * 90 days, a 90-day daily history, and recent incidents per component.
 * Cached briefly so the public endpoint stays cheap.
 */
export async function statusReport(): Promise<StatusReport> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.report;
  const { maintenance } = await settings();
  const list = components();
  const ids = list.map((c) => c.id);
  const [windows, recent, daily, incidents] = await Promise.all([
    readPool.query(
      `SELECT service,
         avg(ok::int) FILTER (WHERE checked_at > now() - interval '1 day') AS day,
         avg(ok::int) FILTER (WHERE checked_at > now() - interval '7 days') AS week,
         avg(ok::int) AS quarter
       FROM status_checks
       WHERE service = ANY($1) AND checked_at > now() - interval '90 days'
       GROUP BY service`,
      [ids],
    ),
    readPool.query(
      `SELECT service, ok, latency_ms, checked_at FROM (
         SELECT service, ok, latency_ms, checked_at,
           row_number() OVER (PARTITION BY service ORDER BY checked_at DESC) AS n
         FROM status_checks
         WHERE service = ANY($1) AND checked_at > now() - interval '1 day'
       ) r WHERE n <= 2 ORDER BY service, checked_at DESC`,
      [ids],
    ),
    readPool.query(
      `SELECT service,
         to_char(date_trunc('day', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
         avg(ok::int) AS uptime
       FROM status_checks
       WHERE service = ANY($1) AND checked_at > now() - interval '90 days'
       GROUP BY 1, 2`,
      [ids],
    ),
    // Incidents are runs of two or more failed checks in a row (gaps and islands).
    readPool.query(
      `SELECT g.service, min(g.checked_at) AS started_at,
         (SELECT min(c.checked_at) FROM status_checks c
           WHERE c.service = g.service AND c.ok AND c.checked_at > max(g.checked_at)) AS resolved_at
       FROM (
         SELECT service, ok, checked_at,
           row_number() OVER (PARTITION BY service ORDER BY checked_at)
           - row_number() OVER (PARTITION BY service, ok ORDER BY checked_at) AS run
         FROM status_checks
         WHERE service = ANY($1) AND checked_at > now() - interval '30 days'
       ) g
       WHERE NOT g.ok
       GROUP BY g.service, g.run
       HAVING count(*) >= 2
       ORDER BY started_at DESC
       LIMIT 20`,
      [ids],
    ),
  ]);

  const days = lastDays(90);
  const componentsOut: StatusComponent[] = list.map((c) => {
    const w = windows.rows.find((r) => r.service === c.id);
    const latest = recent.rows.filter((r) => r.service === c.id);
    const byDay = new Map<string, number>(
      daily.rows
        .filter((r) => r.service === c.id)
        .map((r) => [r.day as string, Number(r.uptime)]),
    );
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      state: stateFromRecent(latest.map((r) => r.ok as boolean)),
      latency_ms: latest[0]?.latency_ms ?? null,
      checked_at: latest[0]
        ? new Date(latest[0].checked_at).toISOString()
        : null,
      uptime: {
        day: ratio(w?.day),
        week: ratio(w?.week),
        quarter: ratio(w?.quarter),
      },
      history: days.map((date) => ({ date, uptime: byDay.get(date) ?? null })),
    };
  });

  const names = new Map(list.map((c) => [c.id, c.name]));
  const now = Date.now();
  const incidentsOut: StatusIncident[] = incidents.rows.map((r) => {
    const started = new Date(r.started_at);
    const resolved = r.resolved_at ? new Date(r.resolved_at) : null;
    return {
      component: r.service,
      name: names.get(r.service) ?? r.service,
      started_at: started.toISOString(),
      resolved_at: resolved?.toISOString() ?? null,
      duration_s: Math.round(
        ((resolved?.getTime() ?? now) - started.getTime()) / 1000,
      ),
    };
  });

  const report: StatusReport = {
    state: overallState(componentsOut.map((c) => c.state)),
    updated_at: new Date().toISOString(),
    components: componentsOut,
    incidents: incidentsOut,
    maintenance: maintenance.enabled ? maintenance : null,
  };
  cache = { at: Date.now(), report };
  return report;
}
