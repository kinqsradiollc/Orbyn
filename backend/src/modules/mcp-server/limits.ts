import type { AgentLimits } from "@orbyn/core";
import { pool } from "../../db/pool.js";

/**
 * Limits for outside agents, keyed on the connection (and the person across
 * their connections), never on an address. Each copy of the mcp service
 * counts per minute in memory; the gateway also caps calls in flight per
 * credential across every copy (limit_conn keyed on the token), and daily
 * quotas are read from agent_usage_daily, which every copy writes, plus
 * what this copy has counted since (small drift across copies is accepted).
 */

export type LimitKind = "call" | "search" | "write";

/** Why a call was refused, and when to try again. */
export type Limited = { reason: string; retryAfter: number };

const MINUTE = 60_000;

/** Calls in the last minute, as timestamps (trimmed as they age). */
class Window {
  private at: number[] = [];
  count(now: number) {
    while (this.at.length && this.at[0] <= now - MINUTE) this.at.shift();
    return this.at.length;
  }
  add(now: number) {
    this.at.push(now);
  }
  /** Seconds until the oldest call leaves the window. */
  wait(now: number) {
    return this.at.length
      ? Math.max(1, Math.ceil((this.at[0] + MINUTE - now) / 1000))
      : 1;
  }
}

type Daily = {
  day: string;
  base: number;
  writes: number;
  loadedAt: number;
  local: number;
  localWrites: number;
};

export class Limiter {
  private windows = new Map<string, Window>();
  private inFlight = new Map<string, number>();
  private daily = new Map<string, Daily>();

  private window(key: string) {
    let w = this.windows.get(key);
    if (!w) {
      w = new Window();
      this.windows.set(key, w);
      if (this.windows.size > 20_000) this.windows.clear();
    }
    return w;
  }

  /** Today's count for a connection: stored (re-read each minute) plus local. */
  private async dailyFor(grantId: string, now: number): Promise<Daily> {
    const day = new Date(now).toISOString().slice(0, 10);
    const hit = this.daily.get(grantId);
    if (hit && hit.day === day && now - hit.loadedAt < MINUTE) return hit;
    const row = (
      await pool
        .query<{ calls: number; writes: number }>(
          "SELECT calls, writes FROM agent_usage_daily WHERE day = $1 AND grant_id = $2",
          [day, grantId],
        )
        .catch(() => ({ rows: [] as { calls: number; writes: number }[] }))
    ).rows[0];
    const fresh: Daily = {
      day,
      base: row?.calls ?? 0,
      writes: row?.writes ?? 0,
      loadedAt: now,
      local: 0,
      localWrites: 0,
    };
    this.daily.set(grantId, fresh);
    return fresh;
  }

  /**
   * Takes one call for a connection, or says why not. `release` must be
   * called when the call ends (the in-flight count).
   */
  async take(
    grantId: string,
    userId: string,
    kind: LimitKind,
    limits: AgentLimits,
    now = Date.now(),
  ): Promise<{ ok: true; release: () => void } | ({ ok: false } & Limited)> {
    const flying = this.inFlight.get(grantId) ?? 0;
    if (flying >= limits.concurrent)
      return {
        ok: false,
        reason: `At most ${limits.concurrent} calls at once per connection.`,
        retryAfter: 1,
      };
    const checks: [string, number, string][] = [
      [`g:${grantId}`, limits.calls_per_minute, "calls a minute"],
      [
        `u:${userId}`,
        limits.user_per_minute,
        "calls a minute across your agents",
      ],
    ];
    if (kind === "search")
      checks.push([
        `s:${grantId}`,
        limits.search_per_minute,
        "searches a minute",
      ]);
    if (kind === "write")
      checks.push([
        `w:${grantId}`,
        limits.writes_per_minute,
        "changes a minute",
      ]);
    for (const [key, max, what] of checks) {
      const w = this.window(key);
      if (w.count(now) >= max)
        return {
          ok: false,
          reason: `At most ${max} ${what}.`,
          retryAfter: w.wait(now),
        };
    }
    const day = await this.dailyFor(grantId, now);
    const tomorrow = Math.ceil(
      (Date.parse(`${day.day}T00:00:00Z`) + 86_400_000 - now) / 1000,
    );
    if (day.base + day.local >= limits.calls_per_day)
      return {
        ok: false,
        reason: `At most ${limits.calls_per_day} calls a day per connection.`,
        retryAfter: tomorrow,
      };
    if (
      kind === "write" &&
      day.writes + day.localWrites >= limits.writes_per_day
    )
      return {
        ok: false,
        reason: `At most ${limits.writes_per_day} changes a day per connection.`,
        retryAfter: tomorrow,
      };
    for (const [key] of checks) this.window(key).add(now);
    day.local++;
    if (kind === "write") day.localWrites++;
    this.inFlight.set(grantId, flying + 1);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        const n = (this.inFlight.get(grantId) ?? 1) - 1;
        if (n <= 0) this.inFlight.delete(grantId);
        else this.inFlight.set(grantId, n);
      },
    };
  }

  /** Forget everything (tests). */
  reset() {
    this.windows.clear();
    this.inFlight.clear();
    this.daily.clear();
  }
}

/**
 * When Orbyn pauses a connection by itself: more than this many calls over
 * its limits, or refused (asking for what it can't reach, which looks like
 * probing), within ten minutes on one copy. Its person restores it in
 * Settings → Connected agents.
 */
export const SUSPEND_AFTER = { limited: 5, denied: 50 } as const;
const STRIKE_WINDOW = 10 * MINUTE;

/** Counts a connection's strikes over the last ten minutes. */
export class Strikes {
  private at = new Map<string, number[]>();

  /**
   * One more strike of `kind` for a connection; true exactly when it goes
   * past SUSPEND_AFTER (once, so it's acted on once).
   */
  hit(grantId: string, kind: keyof typeof SUSPEND_AFTER, now = Date.now()) {
    const key = `${kind}:${grantId}`;
    const list = (this.at.get(key) ?? []).filter(
      (t) => t > now - STRIKE_WINDOW,
    );
    list.push(now);
    this.at.set(key, list);
    if (this.at.size > 20_000) this.at.clear();
    return list.length === SUSPEND_AFTER[kind] + 1;
  }

  /** Forget everything (tests). */
  reset() {
    this.at.clear();
  }
}
