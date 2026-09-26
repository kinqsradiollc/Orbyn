import type { AgentOutcome } from "@orbyn/core";
import { pool } from "../../db/pool.js";

/**
 * What agents did, written in batches every couple of seconds (like the
 * request log), so recording never adds a database write to a read:
 *
 * - agent_activity: one row per change; reads are counted per connection,
 *   tool, outcome and minute, with the first few things they touched;
 * - agent_usage_daily: calls, changes, refusals and limit hits per
 *   connection per day (the daily quotas read this);
 * - agent_grants.last_used_at, for the Connected agents list.
 *
 * A failed write drops that batch: recording never blocks serving.
 */

export type ActivityEntry = {
  userId: string;
  grantId: string;
  clientName: string;
  tool: string;
  tier: string;
  outcome: AgentOutcome;
  targets: string[];
  argsDigest: string | null;
  summary: string;
  requestId: string;
  latencyMs: number;
  /** A change: always its own row. */
  write: boolean;
  /**
   * A change whose row was already written in its own transaction (with
   * its undo and proposal): only counted here.
   */
  recorded?: boolean;
  at?: Date;
};

type Aggregate = ActivityEntry & { calls: number; at: Date };
type Usage = { calls: number; writes: number; denied: number; limited: number };

const FLUSH_MS = 2000;
const TARGETS_KEPT = 20;
const minuteOf = (at: Date) => Math.floor(at.getTime() / 60_000);

export class ActivityRecorder {
  private rows: Aggregate[] = [];
  private reads = new Map<string, Aggregate>();
  private usage = new Map<string, Usage>();
  private used = new Map<string, Date>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;

  start() {
    this.timer ??= setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Counts a call that was refused before any tool ran (a limit, a denial). */
  count(grantId: string, outcome: "limited" | "denied", at = new Date()) {
    const u = this.usageFor(grantId, at);
    if (outcome === "limited") u.limited++;
    else u.denied++;
  }

  private usageFor(grantId: string, at: Date) {
    const key = `${at.toISOString().slice(0, 10)}|${grantId}`;
    let u = this.usage.get(key);
    if (!u) {
      u = { calls: 0, writes: 0, denied: 0, limited: 0 };
      this.usage.set(key, u);
    }
    return u;
  }

  add(entry: ActivityEntry) {
    const at = entry.at ?? new Date();
    const u = this.usageFor(entry.grantId, at);
    u.calls++;
    if (entry.write) u.writes++;
    if (entry.outcome === "denied") u.denied++;
    this.used.set(entry.grantId, at);
    if (entry.recorded) {
      // Counted above; its row is already in agent_activity.
    } else if (entry.write) {
      this.rows.push({
        ...entry,
        at,
        calls: 1,
        targets: entry.targets.slice(0, TARGETS_KEPT),
      });
    } else {
      const key = `${entry.grantId}|${entry.tool}|${entry.outcome}|${minuteOf(at)}`;
      const hit = this.reads.get(key);
      if (hit) {
        hit.calls++;
        hit.latencyMs = Math.max(hit.latencyMs, entry.latencyMs);
        for (const t of entry.targets)
          if (hit.targets.length < TARGETS_KEPT && !hit.targets.includes(t))
            hit.targets.push(t);
      } else
        this.reads.set(key, {
          ...entry,
          at,
          calls: 1,
          targets: entry.targets.slice(0, TARGETS_KEPT),
        });
    }
    if (this.rows.length + this.reads.size >= 250) void this.flush();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const rows = [
      ...this.rows,
      ...[...this.reads.values()].map((r) => ({
        ...r,
        summary: r.calls > 1 ? `${r.summary} (${r.calls} calls)` : r.summary,
      })),
    ];
    const usage = this.usage;
    const used = this.used;
    if (!rows.length && !usage.size && !used.size) return Promise.resolve();
    this.rows = [];
    this.reads = new Map();
    this.usage = new Map();
    this.used = new Map();
    this.flushing = write(rows, usage, used)
      .catch(() => {})
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }
}

async function write(
  rows: Aggregate[],
  usage: Map<string, Usage>,
  used: Map<string, Date>,
) {
  // Only connections that still exist: one revoked and deleted mid-batch is skipped.
  if (rows.length)
    await pool.query(
      `INSERT INTO agent_activity
         (at, user_id, grant_id, client_name, tool, tier, target_ids, args_digest,
          summary, outcome, calls, request_id, latency_ms)
       SELECT v.at, v.user_id, v.grant_id, v.client_name, v.tool, v.tier,
              CASE WHEN v.targets = '' THEN '{}'::text[] ELSE string_to_array(v.targets, ' ') END,
              v.args_digest, v.summary, v.outcome, v.calls, v.request_id, v.latency_ms
         FROM unnest($1::timestamptz[], $2::uuid[], $3::uuid[], $4::text[], $5::text[],
                     $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                     $11::int[], $12::text[], $13::int[])
           AS v(at, user_id, grant_id, client_name, tool, tier, targets, args_digest,
                summary, outcome, calls, request_id, latency_ms)
        WHERE EXISTS (SELECT 1 FROM agent_grants g WHERE g.id = v.grant_id)`,
      [
        rows.map((r) => r.at),
        rows.map((r) => r.userId),
        rows.map((r) => r.grantId),
        rows.map((r) => r.clientName.slice(0, 200)),
        rows.map((r) => r.tool.slice(0, 80)),
        rows.map((r) => r.tier),
        rows.map((r) => r.targets.join(" ")),
        rows.map((r) => r.argsDigest),
        rows.map((r) => r.summary.slice(0, 300)),
        rows.map((r) => r.outcome),
        rows.map((r) => r.calls),
        rows.map((r) => r.requestId.slice(0, 64)),
        rows.map((r) => Math.round(r.latencyMs)),
      ],
    );
  if (usage.size) {
    const keys = [...usage.keys()].map((k) => k.split("|"));
    const vals = [...usage.values()];
    await pool.query(
      `INSERT INTO agent_usage_daily AS d (day, grant_id, calls, writes, denied, limited)
       SELECT v.day, v.grant_id, v.calls, v.writes, v.denied, v.limited
         FROM unnest($1::date[], $2::uuid[], $3::int[], $4::int[], $5::int[], $6::int[])
           AS v(day, grant_id, calls, writes, denied, limited)
        WHERE EXISTS (SELECT 1 FROM agent_grants g WHERE g.id = v.grant_id)
       ON CONFLICT (day, grant_id) DO UPDATE SET
         calls = d.calls + EXCLUDED.calls,
         writes = d.writes + EXCLUDED.writes,
         denied = d.denied + EXCLUDED.denied,
         limited = d.limited + EXCLUDED.limited`,
      [
        keys.map((k) => k[0]),
        keys.map((k) => k[1]),
        vals.map((v) => v.calls),
        vals.map((v) => v.writes),
        vals.map((v) => v.denied),
        vals.map((v) => v.limited),
      ],
    );
  }
  if (used.size)
    await pool.query(
      `UPDATE agent_grants g SET last_used_at = greatest(g.last_used_at, v.at)
         FROM unnest($1::uuid[], $2::timestamptz[]) AS v(id, at)
        WHERE g.id = v.id`,
      [[...used.keys()], [...used.values()]],
    );
}
