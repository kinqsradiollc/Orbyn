import { env } from "../../config/env.js";
import { pool, transaction } from "../../db/pool.js";
import { components } from "./components.js";

type Row = {
  service: string;
  ok: boolean;
  latency_ms: number | null;
  at: Date;
};

/** Results that could not be saved (database down) wait here, capped. */
const pending: Row[] = [];
const MAX_PENDING = 10_000;
const PRUNE_EVERY_ROUNDS = 120;

/** Probe every component once and save the results with their check times. */
export async function probeOnce() {
  const at = new Date();
  const results = await Promise.all(
    components().map(async (c) => {
      const probe = await c
        .probe()
        .catch(() => ({ ok: false, latency_ms: null }));
      return { service: c.id, ...probe, at };
    }),
  );
  pending.push(...results);
  if (pending.length > MAX_PENDING)
    pending.splice(0, pending.length - MAX_PENDING);
  await transaction(async (db) => {
    // Only one status replica records a round.
    const lock = await db.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(786250) AS ok",
    );
    if (!lock.rows[0].ok) {
      pending.length = 0;
      return;
    }
    for (const row of pending)
      await db.query(
        "INSERT INTO status_checks(service,ok,latency_ms,checked_at) VALUES($1,$2,$3,$4)",
        [row.service, row.ok, row.latency_ms, row.at],
      );
    pending.length = 0;
  });
  return results;
}

/** Probe on an interval until the returned stop function is called. */
export function startProber() {
  let stopped = false;
  let rounds = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      await probeOnce();
      if (++rounds % PRUNE_EVERY_ROUNDS === 0)
        await pool.query(
          "DELETE FROM status_checks WHERE checked_at < now() - interval '90 days'",
        );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "status_probe_not_saved",
          pending: pending.length,
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
    if (!stopped) timer = setTimeout(tick, env.STATUS_INTERVAL_MS);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
