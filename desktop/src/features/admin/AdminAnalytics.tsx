import { useState } from "react";
import { BarChart3 } from "lucide-react";
import type { AdminAnalytics as Data, AnalyticsDay } from "@orbyn/core";
import { client } from "../../lib/api";
import { useRemote } from "../../hooks/useRemote";
import { Select } from "../../components/Select";
import { Bars } from "./Bars";
import "./database.css";
import "./insights.css";

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });

/** One series of the daily numbers as columns. */
const series = (
  data: Data,
  pick: (d: AnalyticsDay) => number,
  secondary?: (d: AnalyticsDay) => number,
) =>
  data.series.map((d) => ({
    key: d.day,
    label: dayLabel(d.day),
    value: pick(d),
    ...(secondary ? { secondary: secondary(d) } : {}),
  }));

/**
 * How Orbyn is used: who is active (a person counts once a day they do
 * anything), what they make and finish, how much they lean on the
 * assistant, and how the services held up — over the last week to year.
 */
export function AdminAnalytics({ report }: { report: (e: unknown) => void }) {
  const [days, setDays] = useState(30);
  const data = useRemote(() => client.adminAnalytics(days), [days], report);
  const t = data?.totals;
  const tiles: [string, number | undefined, string][] = [
    ["Active today", t?.active_today, `of ${t?.users ?? "–"} people`],
    ["Active this week", t?.active_7_days, "people, last 7 days"],
    ["Active this month", t?.active_30_days, "people, last 30 days"],
    ["New accounts", t?.signups, `in ${days} days`],
    ["Items created", t?.items_created, "tasks and events"],
    ["Tasks finished", t?.tasks_done, "marked done"],
    ["Pages written", t?.docs_created, "pages and notes"],
    ["Assistant requests", t?.ai_requests, "chats and page help"],
    [
      "Focus time",
      t ? Math.round(t.focus_minutes / 60) : undefined,
      "hours focused",
    ],
    ["Bookings", t?.bookings, "through booking pages"],
    [
      "Reminders sent",
      t?.notifications_sent,
      `${t?.notifications_failed ?? 0} failed`,
    ],
    ["Projects started", t?.projects_created, `in ${days} days`],
  ];
  return (
    <section className="admin-analytics">
      <div className="card admin-requests-head">
        <div>
          <span className="db-eyebrow">
            <BarChart3 size={14} /> ANALYTICS
          </span>
          <h2>How Orbyn is being used</h2>
          <p className="muted">
            Counts only — never what anyone wrote. Days are UTC.
          </p>
        </div>
        <div className="admin-requests-controls">
          <Select
            aria-label="Period"
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </Select>
        </div>
      </div>

      <div className="admin-tiles">
        {tiles.map(([label, value, note]) => (
          <div className="card admin-tile" key={label}>
            <span>{label}</span>
            <strong>
              {value === undefined ? "–" : value.toLocaleString()}
            </strong>
            <small>{note}</small>
          </div>
        ))}
      </div>

      {data && (
        <div className="admin-chart-grid">
          <Chart
            title="Active people"
            data={series(data, (d) => d.active_users)}
          />
          <Chart
            title="Requests"
            legend="Server errors"
            data={series(
              data,
              (d) => d.requests,
              (d) => d.server_errors,
            )}
          />
          <Chart
            title="Items created"
            data={series(data, (d) => d.items_created)}
          />
          <Chart
            title="Tasks finished"
            data={series(data, (d) => d.tasks_done)}
          />
          <Chart
            title="Assistant requests"
            data={series(data, (d) => d.ai_requests)}
          />
          <Chart title="New accounts" data={series(data, (d) => d.signups)} />
          <Chart
            title="Pages written"
            data={series(data, (d) => d.docs_created)}
          />
          <Chart
            title="Focus minutes"
            data={series(data, (d) => d.focus_minutes)}
          />
        </div>
      )}

      {data && (
        <div className="card">
          <div className="section-heading">
            <h2>Most active people</h2>
          </div>
          {data.most_active.length === 0 ? (
            <p className="db-empty">Nobody has been active in this period.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Email</th>
                    <th>Days active</th>
                    <th>Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {data.most_active.map((p) => (
                    <tr key={p.user_id}>
                      <td>
                        <strong>{p.name}</strong>
                      </td>
                      <td>{p.email}</td>
                      <td>
                        {p.days_active} of {days}
                      </td>
                      <td>{p.requests.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Chart({
  title,
  data,
  legend,
}: {
  title: string;
  data: { key: string; label: string; value: number; secondary?: number }[];
  legend?: string;
}) {
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <div className="card admin-chart-card">
      <div className="admin-chart-head">
        <h3>{title}</h3>
        <span className="admin-legend">
          <b>{total.toLocaleString()} in all</b>
          {legend && (
            <>
              <i className="is-danger" /> {legend}
            </>
          )}
        </span>
      </div>
      <Bars
        label={title}
        secondaryLabel={legend?.toLowerCase()}
        data={data}
        height={96}
      />
    </div>
  );
}
