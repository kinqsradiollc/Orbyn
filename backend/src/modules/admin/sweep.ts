import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fail } from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authorize } from "../../lib/auth.js";
import {
  SWEEP_RULES,
  lastSweep,
  retention,
  runSweep,
} from "../../lib/sweep.js";

/**
 * What the sweeper keeps and when it last ran, for Admin → System: each kind
 * of record with how long it's kept and how big its table is, a way to change
 * the retention, and a button to sweep now.
 */
export async function adminSweepRoutes(app: FastifyInstance) {
  const view = async () => {
    const [days, last, sizes] = await Promise.all([
      retention(),
      lastSweep(),
      pool.query<{ table: string; rows: number; size: string }>(
        `SELECT c.relname AS table, greatest(c.reltuples, 0)::bigint::int AS rows,
                pg_size_pretty(pg_total_relation_size(c.oid)) AS size
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1)`,
        [SWEEP_RULES.map((r) => r.table)],
      ),
    ]);
    const size = new Map(sizes.rows.map((s) => [s.table, s]));
    return {
      rules: SWEEP_RULES.map((r) => ({
        key: r.key,
        label: r.label,
        detail: r.detail,
        configurable: r.configurable,
        days: r.configurable ? days[r.key] : null,
        default_days: r.configurable ? r.days : null,
        min_days: r.min ?? null,
        rows: size.get(r.table)?.rows ?? 0,
        size: size.get(r.table)?.size ?? "—",
      })),
      last,
    };
  };

  app.get("/admin/sweep", async (r) => {
    await authorize(r, "system:manage");
    return view();
  });

  app.put("/admin/sweep/retention", async (r) => {
    const actor = await authorize(r, "system:manage");
    const body = z
      .record(z.string(), z.number().int().min(0).max(3650))
      .parse(r.body ?? {});
    const current = await retention();
    for (const [key, days] of Object.entries(body)) {
      const rule = SWEEP_RULES.find((x) => x.key === key && x.configurable);
      if (!rule)
        fail(422, `"${key}" isn't something whose retention can change.`);
      if (days !== 0 && rule.min && days < rule.min)
        fail(
          422,
          `${rule.label} must be kept at least ${rule.min} days (or 0 for forever).`,
        );
      current[key] = days;
    }
    await transaction(async (db) => {
      await db.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at)
           VALUES ('retention', $1, $2, now())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(current), actor.id],
      );
      await audit(
        {
          actorId: actor.id,
          action: "system.retention_changed",
          targetType: "system",
          targetId: "retention",
          details: body,
        },
        db,
      );
    });
    return view();
  });

  app.post("/admin/sweep/run", async (r) => {
    const actor = await authorize(r, "system:manage");
    const result = await runSweep();
    if (!result)
      fail(409, "A sweep is already running. Try again in a moment.");
    await audit({
      actorId: actor.id,
      action: "system.swept",
      targetType: "system",
      targetId: "sweep",
      details: {
        removed: Object.values(result.removed).reduce((n, v) => n + v, 0),
      },
    });
    return view();
  });
}
