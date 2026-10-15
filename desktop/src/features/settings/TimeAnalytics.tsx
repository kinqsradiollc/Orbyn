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
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailed(false);
    setData(null);
    client
      .getAnalytics(days)
      .then(
        (a) => live && setData(a),
        (e) => {
          if (live) {
            setFailed(true);
            report(e);
          }
        },
      )
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [days, report, attempt]);

  const bars = (rows: { name: string; minutes: number }[]) => {
    const max = Math.max(1, ...rows.map((r) => r.minutes));
    return (
      <ul className="analytics-bars">
        {rows.map((r, n) => (
          <li key={`${r.name}-${n}`}>
            <span className="analytics-name">{r.name}</span>
            <span className="analytics-track" aria-hidden="true">
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
      title="Time by list and tag"
    >
      <div className="settings-head">
        <div>
          <p className="muted">Planned sessions · private to you.</p>
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

      {failed ? (
        <div>
          <p role="alert">Couldn’t load time analytics.</p>
          <button
            className="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      ) : loading || !data ? (
        <p className="muted">Loading…</p>
      ) : data.planned_minutes === 0 ? (
        <p className="muted">No sessions in this range.</p>
      ) : (
        <>
          <div className="analytics-totals">
            <div>
              <strong className="mono">{hours(data.planned_minutes)}</strong>
              <small>planned</small>
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
