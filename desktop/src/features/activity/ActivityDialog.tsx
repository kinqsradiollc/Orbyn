import { useEffect, useState } from "react";
import type { ActivitySummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { SettingsEditor } from "../settings/SettingsEditor";
import "./activity.css";

/** Personal work history is separate from provider usage and AI allowances. */
export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<30 | 90 | 365>(90);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setSummary(null);
    setFailed(false);
    void client
      .activitySummary(period)
      .then((value) => {
        if (live) setSummary(value);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [period, retry]);
  return (
    <SettingsEditor title="Activity" onClose={onClose}>
      <div
        className="activity-period segmented"
        role="group"
        aria-label="Activity period"
      >
        {([30, 90, 365] as const).map((days) => (
          <button
            key={days}
            type="button"
            aria-pressed={period === days}
            className={period === days ? "active" : ""}
            onClick={() => setPeriod(days)}
          >
            {days} days
          </button>
        ))}
      </div>
      {failed ? (
        <div>
          <p role="alert">Couldn't load activity.</p>
          <button
            type="button"
            className="secondary"
            onClick={() => setRetry(retry + 1)}
          >
            Retry
          </button>
        </div>
      ) : !summary ? (
        <p role="status">Loading activity…</p>
      ) : (
        <>
          <dl className="activity-totals">
            <div>
              <dt>Task completions</dt>
              <dd>{summary.totals.completions}</dd>
            </div>
            <div>
              <dt>Focus time</dt>
              <dd>
                {Math.floor(summary.totals.focus_minutes / 60)}h{" "}
                {summary.totals.focus_minutes % 60}m
              </dd>
            </div>
            <div>
              <dt>Active days</dt>
              <dd>{summary.totals.active_days}</dd>
            </div>
          </dl>
          <p className="muted activity-coverage">
            Completion history since{" "}
            {new Date(summary.completion_history_since).toLocaleDateString([], {
              timeZone: summary.timezone,
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            .
          </p>
          <section aria-label="Daily activity">
            <div className="activity-grid-scroll">
              <div className="activity-grid" aria-hidden="true">
                {summary.days.map((day) => (
                  <span
                    key={day.day}
                    data-active={
                      (day.completions ?? 0) > 0 ||
                      day.focus_minutes > 0 ||
                      undefined
                    }
                  />
                ))}
              </div>
            </div>
            <p className="muted activity-coverage">
              {summary.days[0]?.day} – {summary.days.at(-1)?.day} ·{" "}
              {summary.timezone}
            </p>
            {!summary.totals.active_days && (
              <p>No recorded activity in this period.</p>
            )}
            <details className="activity-details">
              <summary>Daily details</summary>
              <p className="muted">
                Active days include a task completion or recorded focus time.
                Work from connected agents is included. Focus time uses the
                session start day; — means completion history is unavailable.
              </p>
              <div className="activity-days">
                {summary.days
                  .slice()
                  .reverse()
                  .map((day) => (
                    <div className="activity-day" key={day.day}>
                      <time dateTime={day.day}>{day.day}</time>
                      <span>
                        {day.completions ?? "—"} completed · {day.focus_minutes}{" "}
                        min focus
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          </section>
        </>
      )}
    </SettingsEditor>
  );
}
