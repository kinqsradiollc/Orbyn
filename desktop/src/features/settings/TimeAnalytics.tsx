import { SettingsSection } from "./SettingsSection";
import { useEffect, useState } from "react";
import type { PlannerAnalytics } from "@orbyn/core";
import { client } from "../../lib/api";

const RANGES = [7, 30, 90];
const hours = (m: number) =>
  m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)} h` : `${m} min`;

/** Where set-aside time went, by list and tag, over a chosen window. */
export function TimeAnalytics({ report }: { report: (e: unknown) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<PlannerAnalytics | null>(null);

  useEffect(() => {
    let live = true;
    client.getAnalytics(days).then(
      (a) => live && setData(a),
      (e) => {
        if (live) report(e);
      },
    );
    return () => {
      live = false;
    };
  }, [days, report]);

  const bars = (rows: { name: string; minutes: number }[]) => {
    const max = Math.max(1, ...rows.map((r) => r.minutes));
    return (
      <ul className="analytics-bars">
        {rows.map((r) => (
          <li key={r.name}>
            <span className="analytics-name">{r.name}</span>
            <span className="analytics-track">
              <span
                className="analytics-fill"
                style={{ width: `${(r.minutes / max) * 100}%` }}
              />
            </span>
            <span className="analytics-value mono">{hours(r.minutes)}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <SettingsSection
      className="card settings-card"
      title="Where your time goes"
    >
      <div className="settings-head">
        <div>
          <p className="muted">
            Time you set aside on the calendar, by list and tag. Private to you.
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Range">
          {RANGES.map((d) => (
            <button
              key={d}
              aria-pressed={days === d}
              className={days === d ? "active" : ""}
              onClick={() => setDays(d)}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.planned_minutes === 0 ? (
        <p className="muted">
          No time set aside in this range yet. Plan your day, or add time to a
          task, and it’ll show here.
        </p>
      ) : (
        <>
          <div className="analytics-totals">
            <div>
              <strong className="mono">{hours(data.planned_minutes)}</strong>
              <small>set aside</small>
            </div>
            <div>
              <strong className="mono">{data.completed}</strong>
              <small>tasks finished</small>
            </div>
          </div>
          {data.by_list.length > 0 && (
            <>
              <h3 className="settings-subtitle">By list</h3>
              {bars(data.by_list)}
            </>
          )}
          {data.by_tag.length > 0 && (
            <>
              <h3 className="settings-subtitle">By tag</h3>
              {bars(data.by_tag.map((t) => ({ ...t, name: `#${t.name}` })))}
            </>
          )}
        </>
      )}
    </SettingsSection>
  );
}
