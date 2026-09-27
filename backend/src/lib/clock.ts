import { clockSkewText, type ServerClock } from "@orbyn/core";
import { pool, type Queryable } from "../db/pool.js";
import { publicFetch } from "./netguard.js";

/**
 * The server's own clock, checked against outside time. Everything that
 * says "today", every reminder and every sign-in's expiry reads the clock,
 * so one set hours out (a host whose clock was set to local time and called
 * UTC, say) quietly makes all of it wrong. The worker checks every
 * `CLOCK_CHECK_MS`: a HEAD request to two well-known sites, whose Date
 * header says what time it is. Only when both say the clock is more than
 * `CLOCK_TOLERANCE_MS` out, the same way, is it recorded (server_clock):
 * the status page and Admin → System show it, and admins get a notice
 * once. When a check finds it right again, the record goes.
 *
 * Nothing here runs on a request, and nothing is sent to those sites but a
 * bare HEAD: no cookies, no credentials.
 */

/** How often the worker checks. */
export const CLOCK_CHECK_MS = 10 * 60_000;
/** How far out the clock may be before it counts. */
export const CLOCK_TOLERANCE_MS = 2 * 60_000;
/** Where outside time comes from. */
export const CLOCK_SOURCES = [
  "https://www.cloudflare.com",
  "https://www.google.com",
];
const TIMEOUT_MS = 5_000;

/** What one source said: how far out this clock is, or null (no answer). */
export type ClockReading = { source: string; skew_ms: number | null };

/** The clock and the network, so tests can stand in for both. */
export type ClockDeps = {
  /** This server's clock, in ms. */
  now: () => number;
  /** The Date header of a HEAD request to `url`, or null. */
  dateOf: (url: string) => Promise<string | null>;
};

const realDeps: ClockDeps = {
  now: () => Date.now(),
  async dateOf(url) {
    const res = await publicFetch(
      url,
      { method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) },
      "link",
    );
    return res.headers.get("date");
  },
};

/**
 * How far out this clock is against one source: this clock at the middle
 * of the request, less the time the source gave. A Date header counts
 * whole seconds, so its time is taken as the middle of its second.
 */
export async function readSource(
  source: string,
  deps: ClockDeps,
): Promise<ClockReading> {
  try {
    const before = deps.now();
    const header = await deps.dateOf(source);
    const after = deps.now();
    const outside = header ? Date.parse(header) : NaN;
    if (Number.isNaN(outside)) return { source, skew_ms: null };
    return {
      source,
      skew_ms: Math.round((before + after) / 2 - (outside + 500)),
    };
  } catch {
    return { source, skew_ms: null };
  }
}

/**
 * What the readings say together. "out" only when every source answered
 * and all of them put the clock more than `tolerance` out the same way (the
 * nearer one is taken); "right" when every source that answered puts it
 * within `tolerance`; otherwise (no answer, one answer that says it's out,
 * or answers that disagree) "unsure", and nothing changes.
 */
export function judgeClock(
  readings: ClockReading[],
  tolerance = CLOCK_TOLERANCE_MS,
):
  | { verdict: "out"; skew_ms: number }
  | { verdict: "right" }
  | { verdict: "unsure" } {
  const answered = readings
    .map((r) => r.skew_ms)
    .filter((s): s is number => s !== null);
  if (!answered.length) return { verdict: "unsure" };
  if (answered.every((s) => Math.abs(s) <= tolerance))
    return { verdict: "right" };
  const fast = answered.every((s) => s > tolerance);
  const slow = answered.every((s) => s < -tolerance);
  if (answered.length === readings.length && (fast || slow)) {
    const nearest = answered.reduce((a, b) =>
      Math.abs(b) < Math.abs(a) ? b : a,
    );
    return { verdict: "out", skew_ms: nearest };
  }
  return { verdict: "unsure" };
}

/** The clock as last found out, or null while it is right. */
export async function serverClock(
  db: Queryable = pool,
): Promise<ServerClock | null> {
  try {
    const row = (
      await db.query<{ skew_ms: string; since: Date; checked_at: Date }>(
        "SELECT skew_ms, since, checked_at FROM server_clock WHERE id",
      )
    ).rows[0];
    return row
      ? {
          skew_ms: Number(row.skew_ms),
          since: new Date(row.since).toISOString(),
          checked_at: new Date(row.checked_at).toISOString(),
        }
      : null;
  } catch {
    // A database before migration 156: nothing known.
    return null;
  }
}

/**
 * One check: ask the sources, and record the clock as out (a notice to each
 * admin the first time), clear it when right, or leave things as they are
 * when unsure. Returns the verdict and the readings.
 */
export async function checkServerClock(
  deps: ClockDeps = realDeps,
  sources = CLOCK_SOURCES,
) {
  const readings = await Promise.all(sources.map((s) => readSource(s, deps)));
  const judged = judgeClock(readings);
  if (judged.verdict === "right") {
    await pool.query("DELETE FROM server_clock WHERE id");
  } else if (judged.verdict === "out") {
    // Times in outside time: this clock is the one that's wrong.
    const outside = new Date(deps.now() - judged.skew_ms);
    const row = (
      await pool.query<{ since: Date }>(
        `INSERT INTO server_clock (id, skew_ms, since, checked_at, sources)
           VALUES (true, $1, $2, $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET skew_ms = EXCLUDED.skew_ms,
           checked_at = EXCLUDED.checked_at, sources = EXCLUDED.sources
         RETURNING since`,
        [judged.skew_ms, outside, JSON.stringify(readings)],
      )
    ).rows[0];
    await noticeAdmins(judged.skew_ms, new Date(row.since));
  }
  return { ...judged, readings };
}

/** An in-app notice to every admin, once for each time the clock goes out. */
async function noticeAdmins(skewMs: number, since: Date) {
  await pool.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel,
       destination, title, body, state, kind, ref)
     SELECT u.id, NULL, 0, 'inapp', u.id::text, $1, $2, 'sent', 'system', $3
       FROM users u WHERE u.role = 'admin' AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [
      clockSkewText(skewMs).replace(/ — .*$/, ""),
      `${clockSkewText(skewMs)} Everything that says "today", every reminder and every sign-in's expiry reads it. Set the server to keep time by itself (NTP) and on UTC. Status and Admin → System show it until it's right.`,
      `clock:${since.toISOString()}`,
    ],
  );
}
