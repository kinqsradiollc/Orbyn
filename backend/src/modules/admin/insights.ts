import type { FastifyInstance } from "fastify";
import {
  analyticsQuery,
  requestLogQuery,
  requestSummaryQuery,
  type AdminAnalytics,
  type RequestLogRow,
  type RequestSummary,
} from "@orbyn/core";
import { reader } from "../../db/pool.js";
import { authorize } from "../../lib/auth.js";
import { env } from "../../config/env.js";

const num = (v: unknown) => Number(v ?? 0);

/**
 * Traffic and usage for the admin console: how each service is answering,
 * the request log itself, and how Orbyn is being used over time. Reads only;
 * the data is written by lib/request-log.ts in every service.
 */
export async function adminInsightRoutes(app: FastifyInstance) {
  app.get("/admin/requests/summary", async (r): Promise<RequestSummary> => {
    await authorize(r, "requests:read");
    const { hours } = requestSummaryQuery.parse(r.query);
    const db = reader(r.headers);
    const since = `now() - make_interval(hours => $1)`;
    const [services, timeline, slowest, failing, instances] = await Promise.all(
      [
        db.query(
          `SELECT service, count(*)::int AS requests,
                  count(*) FILTER (WHERE status BETWEEN 400 AND 499)::int AS client_errors,
                  count(*) FILTER (WHERE status >= 500)::int AS server_errors,
                  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::int AS p50_ms,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms,
                  max(duration_ms)::int AS max_ms,
                  count(DISTINCT instance)::int AS instances,
                  max(at) AS last_at
             FROM request_log WHERE at > ${since}
            GROUP BY service ORDER BY service`,
          [hours],
        ),
        db.query(
          `SELECT h.hour, coalesce(count(l.id), 0)::int AS requests,
                  coalesce(count(l.id) FILTER (WHERE l.status >= 500), 0)::int AS server_errors
             FROM generate_series(date_trunc('hour', ${since}), date_trunc('hour', now()),
                  interval '1 hour') AS h(hour)
             LEFT JOIN request_log l
               ON l.at >= h.hour AND l.at < h.hour + interval '1 hour'
            GROUP BY h.hour ORDER BY h.hour`,
          [hours],
        ),
        db.query(
          `SELECT service, method, route, count(*)::int AS requests,
                  count(*) FILTER (WHERE status >= 500)::int AS server_errors,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms
             FROM request_log WHERE at > ${since}
            GROUP BY service, method, route HAVING count(*) >= 3
            ORDER BY p95_ms DESC LIMIT 8`,
          [hours],
        ),
        db.query(
          `SELECT service, method, route, count(*)::int AS requests,
                  count(*) FILTER (WHERE status >= 500)::int AS server_errors,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms
             FROM request_log WHERE at > ${since}
            GROUP BY service, method, route
           HAVING count(*) FILTER (WHERE status >= 500) > 0
            ORDER BY server_errors DESC LIMIT 8`,
          [hours],
        ),
        db.query(
          `SELECT service, instance, max(at) AS last_at FROM request_log
            WHERE at > ${since} GROUP BY service, instance
            ORDER BY service, last_at DESC`,
          [hours],
        ),
      ],
    );
    return {
      hours,
      sample: env.REQUEST_LOG_SAMPLE,
      services: services.rows,
      timeline: timeline.rows,
      slowest_routes: slowest.rows,
      failing_routes: failing.rows,
      instances: instances.rows,
    } as RequestSummary;
  });

  app.get("/admin/requests", async (r) => {
    await authorize(r, "requests:read");
    const q = requestLogQuery.parse(r.query);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replaceAll("$?", `$${values.length}`));
    };
    if (q.service) add("l.service = $?", q.service);
    if (q.status) {
      const floor = Number(q.status[0]) * 100;
      add("l.status BETWEEN $? AND $? + 99", floor);
    }
    if (q.route)
      add(
        "l.route ILIKE $?",
        `%${q.route.replace(/[\\%_]/g, (c) => "\\" + c)}%`,
      );
    if (q.user)
      add(
        "(u.email ILIKE $? OR u.name ILIKE $?)",
        `%${q.user.replace(/[\\%_]/g, (c) => "\\" + c)}%`,
      );
    if (q.request_id) add("l.request_id = $?", q.request_id);
    if (q.slow) where.push("l.duration_ms >= 1000");
    if (q.before) add("l.id < $?", q.before);
    values.push(q.limit + 1);
    const rows = (
      await reader(r.headers).query<RequestLogRow>(
        `SELECT l.id::int, l.at, l.service, l.instance, l.request_id, l.method,
                l.route, l.status, l.duration_ms, l.user_id, u.email AS user_email
           FROM request_log l LEFT JOIN users u ON u.id = l.user_id
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY l.id DESC LIMIT $${values.length}`,
        values,
      )
    ).rows;
    return {
      rows: rows.slice(0, q.limit),
      more: rows.length > q.limit,
    };
  });

  app.get("/admin/analytics", async (r): Promise<AdminAnalytics> => {
    await authorize(r, "analytics:read");
    const { days } = analyticsQuery.parse(r.query);
    const db = reader(r.headers);
    const range = `current_date - ($1::int - 1)`;
    const [totals, series, top] = await Promise.all([
      db.query(
        `SELECT
          (SELECT count(*) FROM users)::int AS users,
          (SELECT count(DISTINCT user_id) FROM daily_activity WHERE day = current_date)::int AS active_today,
          (SELECT count(DISTINCT user_id) FROM daily_activity WHERE day > current_date - 7)::int AS active_7_days,
          (SELECT count(DISTINCT user_id) FROM daily_activity WHERE day > current_date - 30)::int AS active_30_days,
          (SELECT count(*) FROM users WHERE created_at::date >= ${range})::int AS signups,
          (SELECT count(*) FROM items WHERE created_at::date >= ${range})::int AS items_created,
          (SELECT count(*) FROM item_updates WHERE status = 'done' AND created_at::date >= ${range})::int AS tasks_done,
          (SELECT count(*) FROM docs WHERE created_at::date >= ${range})::int AS docs_created,
          (SELECT count(*) FROM projects WHERE created_at::date >= ${range})::int AS projects_created,
          (SELECT coalesce(sum(ai_requests), 0) FROM daily_activity WHERE day >= ${range})::int AS ai_requests,
          (SELECT count(*) FROM bookings WHERE created_at::date >= ${range})::int AS bookings,
          (SELECT coalesce(sum(minutes), 0) FROM focus_sessions WHERE kind = 'work' AND started_at::date >= ${range})::int AS focus_minutes,
          (SELECT count(*) FROM notifications WHERE state = 'sent' AND created_at::date >= ${range})::int AS notifications_sent,
          (SELECT count(*) FROM notifications WHERE state = 'failed' AND created_at::date >= ${range})::int AS notifications_failed`,
        [days],
      ),
      db.query(
        `WITH d AS (
           SELECT generate_series(${range}, current_date, interval '1 day')::date AS day)
         SELECT d.day::text,
           (SELECT count(*) FROM daily_activity a WHERE a.day = d.day)::int AS active_users,
           (SELECT count(*) FROM users u WHERE u.created_at::date = d.day)::int AS signups,
           (SELECT count(*) FROM items i WHERE i.created_at::date = d.day)::int AS items_created,
           (SELECT count(*) FROM item_updates x WHERE x.status = 'done' AND x.created_at::date = d.day)::int AS tasks_done,
           (SELECT count(*) FROM docs x WHERE x.created_at::date = d.day)::int AS docs_created,
           (SELECT coalesce(sum(a.ai_requests), 0) FROM daily_activity a WHERE a.day = d.day)::int AS ai_requests,
           (SELECT coalesce(sum(q.requests), 0) FROM request_daily q WHERE q.day = d.day)::int AS requests,
           (SELECT coalesce(sum(q.errors), 0) FROM request_daily q WHERE q.day = d.day)::int AS server_errors,
           (SELECT count(*) FROM bookings b WHERE b.created_at::date = d.day)::int AS bookings,
           (SELECT coalesce(sum(f.minutes), 0) FROM focus_sessions f
              WHERE f.kind = 'work' AND f.started_at::date = d.day)::int AS focus_minutes
         FROM d ORDER BY d.day`,
        [days],
      ),
      db.query(
        `SELECT a.user_id, u.email, u.name, count(*)::int AS days_active,
                sum(a.requests)::int AS requests
           FROM daily_activity a JOIN users u ON u.id = a.user_id
          WHERE a.day >= ${range}
          GROUP BY a.user_id, u.email, u.name
          ORDER BY days_active DESC, requests DESC LIMIT 10`,
        [days],
      ),
    ]);
    const t = totals.rows[0];
    return {
      days,
      totals: Object.fromEntries(
        Object.entries(t).map(([k, v]) => [k, num(v)]),
      ) as AdminAnalytics["totals"],
      series: series.rows,
      most_active: top.rows,
    };
  });
}
