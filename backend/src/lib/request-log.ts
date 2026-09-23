import { hostname } from "node:os";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";

/**
 * Request tracing for the admin console. Each service keeps what it answered
 * in memory and writes it in batches every couple of seconds, so recording
 * never adds a database round trip to a request. It writes three things:
 *
 * - `request_log`: one row per request (sampled; errors and slow requests
 *   always kept), with the route pattern rather than the URL.
 * - `request_daily`: counts per service, route and day, for the long view.
 * - `daily_activity`: per person per day, for active users and assistant use.
 *
 * Health probes and live streams are left out: probes would drown the log,
 * and a stream's "duration" is how long someone kept a tab open.
 */

/** Who a request was for, set by authenticate() once it knows. */
export const requestUser = new WeakMap<FastifyRequest, string>();

const SKIP =
  /^\/(?:live|ready|version|health|metrics)$|^\/events(?:\/|$)|^\/docs\/[^/]+\/live$/;
const SLOW_MS = 1000;
const FLUSH_MS = 2000;
const FLUSH_AT = 250;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AI_ROUTE = /^\/ai\/(?:chat|project)|^\/docs\/:id\/(?:ask|assist)$/;

type Row = {
  service: string;
  request_id: string;
  method: string;
  route: string;
  status: number;
  duration_ms: number;
  user_id: string | null;
  at: Date;
};
type Daily = {
  requests: number;
  errors: number;
  total_ms: number;
  max_ms: number;
};
type Activity = { requests: number; writes: number; ai: number };

const instance = hostname().slice(0, 64);
const day = (at: Date) => at.toISOString().slice(0, 10);

class Recorder {
  rows: Row[] = [];
  daily = new Map<string, Daily>();
  activity = new Map<string, Activity>();
  timer: ReturnType<typeof setInterval> | null = null;
  flushing: Promise<void> | null = null;

  add(row: Row, sampled: boolean) {
    if (sampled) this.rows.push(row);
    const d = day(row.at);
    const key = `${d}|${row.service}|${row.route}|${row.method}`;
    const agg = this.daily.get(key) ?? {
      requests: 0,
      errors: 0,
      total_ms: 0,
      max_ms: 0,
    };
    agg.requests++;
    if (row.status >= 500) agg.errors++;
    agg.total_ms += row.duration_ms;
    agg.max_ms = Math.max(agg.max_ms, row.duration_ms);
    this.daily.set(key, agg);
    if (row.user_id) {
      const k = `${d}|${row.user_id}`;
      const a = this.activity.get(k) ?? { requests: 0, writes: 0, ai: 0 };
      a.requests++;
      if (WRITES.has(row.method)) a.writes++;
      if (AI_ROUTE.test(row.route)) a.ai++;
      this.activity.set(k, a);
    }
    if (this.rows.length >= FLUSH_AT) void this.flush();
  }

  /** Write what has gathered. A failure drops the batch: tracing never blocks serving. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const rows = this.rows;
    const daily = this.daily;
    const activity = this.activity;
    if (!rows.length && !daily.size && !activity.size) return Promise.resolve();
    this.rows = [];
    this.daily = new Map();
    this.activity = new Map();
    this.flushing = write(rows, daily, activity)
      .catch(() => {})
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }
}

async function write(
  rows: Row[],
  daily: Map<string, Daily>,
  activity: Map<string, Activity>,
) {
  if (rows.length)
    await pool.query(
      `INSERT INTO request_log
         (at, service, instance, request_id, method, route, status, duration_ms, user_id)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[],
         $5::text[], $6::text[], $7::smallint[], $8::int[], $9::uuid[])`,
      [
        rows.map((r) => r.at),
        rows.map((r) => r.service),
        rows.map(() => instance),
        rows.map((r) => r.request_id),
        rows.map((r) => r.method),
        rows.map((r) => r.route),
        rows.map((r) => r.status),
        rows.map((r) => r.duration_ms),
        rows.map((r) => r.user_id),
      ],
    );
  if (daily.size) {
    const keys = [...daily.keys()].map((k) => k.split("|"));
    const vals = [...daily.values()];
    await pool.query(
      `INSERT INTO request_daily AS d
         (day, service, route, method, requests, errors, total_ms, max_ms)
       SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[],
         $5::int[], $6::int[], $7::bigint[], $8::int[])
       ON CONFLICT (day, service, route, method) DO UPDATE SET
         requests = d.requests + EXCLUDED.requests,
         errors = d.errors + EXCLUDED.errors,
         total_ms = d.total_ms + EXCLUDED.total_ms,
         max_ms = GREATEST(d.max_ms, EXCLUDED.max_ms)`,
      [
        keys.map((k) => k[0]),
        keys.map((k) => k[1]),
        keys.map((k) => k[2]),
        keys.map((k) => k[3]),
        vals.map((v) => v.requests),
        vals.map((v) => v.errors),
        vals.map((v) => v.total_ms),
        vals.map((v) => v.max_ms),
      ],
    );
  }
  if (activity.size) {
    const keys = [...activity.keys()].map((k) => k.split("|"));
    const vals = [...activity.values()];
    // Only people who still exist: an account deleted mid-batch is skipped.
    await pool.query(
      `INSERT INTO daily_activity AS a (day, user_id, requests, writes, ai_requests)
       SELECT v.day, v.user_id, v.requests, v.writes, v.ai
         FROM unnest($1::date[], $2::uuid[], $3::int[], $4::int[], $5::int[])
           AS v(day, user_id, requests, writes, ai)
        WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v.user_id)
       ON CONFLICT (day, user_id) DO UPDATE SET
         requests = a.requests + EXCLUDED.requests,
         writes = a.writes + EXCLUDED.writes,
         ai_requests = a.ai_requests + EXCLUDED.ai_requests`,
      [
        keys.map((k) => k[0]),
        keys.map((k) => k[1]),
        vals.map((v) => v.requests),
        vals.map((v) => v.writes),
        vals.map((v) => v.ai),
      ],
    );
  }
}

/** Record every request this service answers. */
export function recordRequests(app: FastifyInstance, service: string) {
  const recorder = new Recorder();
  const sample = Math.min(1, Math.max(0, env.REQUEST_LOG_SAMPLE));
  recorder.timer = setInterval(() => void recorder.flush(), FLUSH_MS);
  recorder.timer.unref();

  // The request id travels with the answer, so an error a person reports can
  // be found in the log by the id their app shows.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", request.id);
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (SKIP.test(path) || request.method === "OPTIONS") return;
    const route = request.routeOptions.url ?? "(no route)";
    if (SKIP.test(route)) return;
    const status = reply.statusCode;
    const duration = Math.round(reply.elapsedTime);
    const kept = status >= 400 || duration >= SLOW_MS || Math.random() < sample;
    recorder.add(
      {
        service,
        request_id: String(request.id).slice(0, 64),
        method: request.method,
        route: route.slice(0, 200),
        status,
        duration_ms: duration,
        user_id: requestUser.get(request) ?? null,
        at: new Date(),
      },
      kept,
    );
  });

  app.addHook("onClose", async () => {
    if (recorder.timer) clearInterval(recorder.timer);
    await recorder.flush();
  });
}
