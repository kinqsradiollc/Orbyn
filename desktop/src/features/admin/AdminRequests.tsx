import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { RequestLogRow, RequestSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { Select } from "../../components/Select";
import { Bars } from "./Bars";
import "./database.css";
import "./insights.css";

const SERVICE_NAMES: Record<string, string> = {
  all: "All-in-one (dev)",
  api: "API",
  ai: "Assistant",
  realtime: "Realtime",
  status: "Status",
};
const name = (s: string) => SERVICE_NAMES[s] ?? s;
const ms = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const statusTone = (s: number) =>
  s >= 500 ? "is-bad" : s >= 400 ? "is-warn" : "is-ok";

type Filters = {
  service: string;
  status: "" | "2xx" | "3xx" | "4xx" | "5xx";
  route: string;
  user: string;
  request_id: string;
  slow: boolean;
};
const NO_FILTERS: Filters = {
  service: "",
  status: "",
  route: "",
  user: "",
  request_id: "",
  slow: false,
};

/**
 * Every request the services answered: how each service is doing (volume,
 * errors, p50/p95 latency, copies running), which routes are slow or
 * failing, and the log itself, searchable by service, status, route, person
 * or request id — the id people's apps show beside an error.
 */
export function AdminRequests({ report }: { report: (e: unknown) => void }) {
  const [hours, setHours] = useState(24);
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [rows, setRows] = useState<RequestLogRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const seq = useRef(0);
  const summarySeq = useRef(0);
  const alive = useRef(true);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [rowsFailed, setRowsFailed] = useState(false);
  const [rowsBusy, setRowsBusy] = useState(false);
  const rowsBusyRef = useRef(false);
  const retryBefore = useRef<number | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current++;
      summarySeq.current++;
    };
  }, []);
  const reportRef = useRef(report);
  reportRef.current = report;

  const loadSummary = useCallback(async () => {
    const mine = ++summarySeq.current;
    const account = session.get();
    const current = () =>
      alive.current && mine === summarySeq.current && account === session.get();
    setSummaryFailed(false);
    try {
      const next = await client.adminRequestSummary(hours);
      if (current()) setSummary(next);
    } catch (error) {
      if (current()) {
        setSummaryFailed(true);
        reportRef.current(error);
      }
    }
  }, [hours]);
  const loadRows = useCallback(
    async (before?: number) => {
      if (before !== undefined && rowsBusyRef.current) return;
      retryBefore.current = before;
      const mine = ++seq.current;
      const account = session.get();
      const current = () =>
        alive.current && mine === seq.current && account === session.get();
      rowsBusyRef.current = true;
      setRowsBusy(true);
      setRowsFailed(false);
      try {
        const page = await client.adminRequests({
          service: filters.service || undefined,
          status: filters.status || undefined,
          route: filters.route.trim() || undefined,
          user: filters.user.trim() || undefined,
          request_id: filters.request_id.trim() || undefined,
          slow: filters.slow || undefined,
          before,
        });
        if (!current()) return;
        setRowsFailed(false);
        setRows((was) => (before && was ? [...was, ...page.rows] : page.rows));
        setMore(page.more);
      } catch (e) {
        if (current()) {
          setRowsFailed(true);
          reportRef.current(e);
        }
      } finally {
        if (current()) {
          rowsBusyRef.current = false;
          setRowsBusy(false);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    setSummary(null);
    void loadSummary();
    return () => {
      summarySeq.current++;
    };
  }, [loadSummary]);
  useEffect(() => {
    seq.current++;
    setRows(null);
    setOpen(null);
    setMore(false);
    setRowsFailed(false);
    const t = setTimeout(() => void loadRows(), 250);
    return () => {
      clearTimeout(t);
      seq.current++;
    };
  }, [loadRows]);
  // Live: the newest requests every ten seconds while the tab is open.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadSummary();
      void loadRows();
    }, 10_000);
    return () => clearInterval(id);
  }, [live, loadSummary, loadRows]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const services = summary?.services ?? [];

  return (
    <section className="admin-requests">
      <div className="card admin-requests-head">
        <div>
          <h2>Requests</h2>
          <p className="muted">
            Logs kept for seven days.
            {summary && summary.sample < 1
              ? ` ${Math.round(summary.sample * 100)}% of ordinary requests are kept; errors and slow ones always are.`
              : ""}
          </p>
        </div>
        <div className="admin-requests-controls">
          <Select
            aria-label="Period"
            value={String(hours)}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value="1">Last hour</option>
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
          </Select>
          <button
            className={live ? "primary" : "secondary"}
            aria-pressed={live}
            onClick={() => setLive(!live)}
          >
            <RefreshCw size={14} /> {live ? "Live" : "Go live"}
          </button>
        </div>
      </div>

      <div className="admin-service-grid">
        {summaryFailed ? (
          <div role="alert">
            <p>Couldn't load request totals.</p>
            <button className="text-button" onClick={() => void loadSummary()}>
              Retry
            </button>
          </div>
        ) : summary === null ? (
          <p className="muted">Loading…</p>
        ) : services.length === 0 ? (
          <p className="muted card admin-empty">No requests in this period.</p>
        ) : (
          services.map((s) => {
            const errorRate = s.requests ? s.server_errors / s.requests : 0;
            return (
              <div className="card admin-service" key={s.service}>
                <div className="admin-service-top">
                  <strong>{name(s.service)}</strong>
                  <span
                    className={
                      "admin-health " +
                      (errorRate > 0.05
                        ? "is-bad"
                        : errorRate > 0
                          ? "is-warn"
                          : "is-ok")
                    }
                  >
                    {errorRate > 0.05
                      ? "High error rate"
                      : errorRate > 0
                        ? "Some errors"
                        : "No errors"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Requests</dt>
                    <dd>{s.requests.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Server errors</dt>
                    <dd>
                      {s.server_errors}{" "}
                      <small>({(errorRate * 100).toFixed(1)}%)</small>
                    </dd>
                  </div>
                  <div>
                    <dt>p50 · p95</dt>
                    <dd>
                      {ms(s.p50_ms)} · {ms(s.p95_ms)}
                    </dd>
                  </div>
                  <div>
                    <dt>Copies</dt>
                    <dd>{s.instances}</dd>
                  </div>
                </dl>
              </div>
            );
          })
        )}
      </div>

      {summary && summary.timeline.length > 1 && (
        <div className="card admin-chart-card">
          <div className="admin-chart-head">
            <h3>Requests per hour</h3>
            <span className="admin-legend">
              <i className="is-primary" /> Requests
              <i className="is-danger" /> Server errors
            </span>
          </div>
          <Bars
            label="Requests"
            secondaryLabel="server errors"
            data={summary.timeline.map((t) => ({
              key: t.hour,
              label: new Date(t.hour).toLocaleTimeString([], {
                hour: "numeric",
              }),
              value: t.requests,
              secondary: t.server_errors,
            }))}
          />
        </div>
      )}

      {summary &&
        (summary.slowest_routes.length > 0 ||
          summary.failing_routes.length > 0) && (
          <div className="admin-route-grid">
            <RouteTable
              title="Slowest routes (p95)"
              rows={summary.slowest_routes}
            />
            <RouteTable
              title="Routes with server errors"
              rows={summary.failing_routes}
              empty="No server errors in this period."
            />
          </div>
        )}

      <div className="card admin-log">
        <div className="section-heading">
          <h2>Request log</h2>
          {JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) && (
            <button
              className="text-button"
              onClick={() => setFilters(NO_FILTERS)}
            >
              Clear filters
            </button>
          )}
        </div>
        <details className="admin-request-filters">
          <summary>
            Filters
            {JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)
              ? " · active"
              : ""}
          </summary>
          <div className="admin-log-filters">
            <Select
              aria-label="Service"
              value={filters.service}
              onChange={(e) => set("service", e.target.value)}
            >
              <option value="">All services</option>
              {services.map((s) => (
                <option key={s.service} value={s.service}>
                  {name(s.service)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Status"
              value={filters.status}
              onChange={(e) =>
                set("status", e.target.value as Filters["status"])
              }
            >
              <option value="">Any status</option>
              <option value="2xx">2xx · worked</option>
              <option value="3xx">3xx</option>
              <option value="4xx">4xx · refused</option>
              <option value="5xx">5xx · failed</option>
            </Select>
            <div className="db-search">
              <Search size={14} />
              <input
                aria-label="Route"
                placeholder="Route, e.g. /items"
                value={filters.route}
                onChange={(e) => set("route", e.target.value)}
              />
            </div>
            <div className="db-search">
              <Search size={14} />
              <input
                aria-label="Person"
                placeholder="Email or name"
                value={filters.user}
                onChange={(e) => set("user", e.target.value)}
              />
            </div>
            <div className="db-search">
              <Search size={14} />
              <input
                aria-label="Request id"
                placeholder="Request id"
                value={filters.request_id}
                onChange={(e) => set("request_id", e.target.value)}
              />
            </div>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={filters.slow}
                onChange={(e) => set("slow", e.target.checked)}
              />
              Slow only (1 s+)
            </label>
          </div>
        </details>
        {rowsFailed && (
          <div role="alert" className="admin-log-feedback">
            <p>Couldn't load requests.</p>
            <button
              className="text-button"
              disabled={rowsBusy}
              onClick={() => void loadRows(retryBefore.current)}
            >
              Retry
            </button>
          </div>
        )}
        {rows === null && !rowsFailed && (
          <p role="status" className="db-empty">
            Loading requests…
          </p>
        )}
        <div className="db-grid-scroll" aria-busy={rowsBusy}>
          <table className="data-table db-grid admin-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Service</th>
                <th>Request</th>
                <th>Status</th>
                <th>Took</th>
                <th>Person</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className={
                      "admin-log-row" + (open === r.id ? " is-open" : "")
                    }
                    tabIndex={0}
                    aria-expanded={open === r.id}
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen(open === r.id ? null : r.id);
                      }
                    }}
                  >
                    <td>{time(r.at)}</td>
                    <td>{name(r.service)}</td>
                    <td>
                      <code>
                        {r.method} {r.route}
                      </code>
                    </td>
                    <td>
                      <span className={"admin-status " + statusTone(r.status)}>
                        {r.status}
                      </span>
                    </td>
                    <td className={r.duration_ms >= 1000 ? "is-slow" : ""}>
                      {ms(r.duration_ms)}
                    </td>
                    <td>{r.user_email ?? "—"}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="admin-log-detail">
                      <td colSpan={6}>
                        <dl>
                          <div>
                            <dt>Request id</dt>
                            <dd>
                              <code>{r.request_id || "—"}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>When</dt>
                            <dd>{new Date(r.at).toLocaleString()}</dd>
                          </div>
                          <div>
                            <dt>Copy</dt>
                            <dd>
                              <code>{r.instance || "—"}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Person</dt>
                            <dd>{r.user_email ?? "Signed out"}</dd>
                          </div>
                        </dl>
                        {r.request_id && (
                          <button
                            className="text-button"
                            onClick={() =>
                              setFilters({
                                ...NO_FILTERS,
                                request_id: r.request_id,
                              })
                            }
                          >
                            Filter by this request ID
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {rows?.length === 0 && (
            <p className="db-empty">No requests match these filters.</p>
          )}
        </div>
        {more && rows && rows.length > 0 && (
          <div className="db-pager">
            <span>{rows.length} shown</span>
            <button
              className="secondary"
              disabled={rowsBusy}
              onClick={() => void loadRows(rows[rows.length - 1].id)}
            >
              Show older
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function RouteTable({
  title,
  rows,
  empty = "Not enough traffic yet.",
}: {
  title: string;
  rows: RequestSummary["slowest_routes"];
  empty?: string;
}) {
  return (
    <div className="card admin-routes">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={`${r.service}${r.method}${r.route}`}>
              <code>
                {r.method} {r.route}
              </code>
              <span className="muted">
                {name(r.service)} · {r.requests} req
                {r.server_errors ? ` · ${r.server_errors} failed` : ""} · p95{" "}
                {ms(r.p95_ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
