import { learningSummary } from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { ErrorNotice, Loading, SelectBox, Field } from "../../../ui/kit";
import { SettingsSection, useSettingsRead } from "../shared";
const minutes = (value: number) =>
  value >= 60
    ? `${(value / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
    : `${value} min`;
export function PlanningInsights() {
  const learning = useSettingsRead(() => client.getLearning());
  const [days, setDays] = useState(30),
    analytics = useSettingsRead(() => client.getAnalytics(days), [days]);
  const summary = learningSummary(learning.data ?? null);
  return (
    <>
      <SettingsSection
        title="Planner learning"
        description="Evidence from your completed tasks, planned sessions and focus time."
      >
        {learning.loading && !learning.data && (
          <Loading label="Loading planner learning" />
        )}
        {learning.error && (
          <ErrorNotice
            message={learning.error}
            onRetry={() => void learning.reload()}
          />
        )}
        {learning.data && (
          <div className="settings-planning-insights">
            <h4>Estimates</h4>
            <p>{summary.estimates}</p>
            <p className="muted small">
              {learning.data.estimates.applied
                ? "Applied to planning"
                : "Not applied to planning"}
            </p>
            {(learning.data.estimates.tags.length > 0 ||
              !!learning.data.estimates.lists?.length) && (
              <details>
                <summary>Estimate evidence by tag and list</summary>
                <ul>
                  {learning.data.estimates.tags.map((row) => (
                    <li key={`tag:${row.tag_id}`}>
                      Tag: {row.name} · {row.ratio}× · {row.samples} finished
                      tasks
                    </li>
                  ))}
                  {learning.data.estimates.lists?.map((row) => (
                    <li key={`list:${row.list_id}`}>
                      List: {row.name} · {row.ratio}× · {row.samples} finished
                      tasks
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <h4>Work rhythm</h4>
            <p>{summary.rhythm}</p>
            <p className="muted small">
              {Math.round(learning.data.rhythm.confidence * 100)}% confidence ·{" "}
              {minutes(learning.data.rhythm.evidence_minutes)} of evidence ·{" "}
              {learning.data.rhythm.applied ? "Applied" : "Not applied"}
            </p>
            {learning.data.rhythm.confidence > 0 && (
              <details>
                <summary>Hourly history in your planning time zone</summary>
                <ol className="settings-planning-rhythm">
                  {learning.data.rhythm.hours.map((value, hour) => (
                    <li key={hour}>
                      <span>{String(hour).padStart(2, "0")}:00</span>
                      <span
                        className="settings-planning-meter"
                        aria-hidden="true"
                      >
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, (value + 1) * 50))}%`,
                          }}
                        />
                      </span>
                      <span>
                        {value >= 0.25
                          ? "Usually goes well"
                          : value <= -0.25
                            ? "Often slips"
                            : "About average"}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            <h4>Daily capacity</h4>
            <p>{summary.load}</p>
            <p className="muted small">
              {learning.data.load.days} observed days ·{" "}
              {learning.data.load.applied ? "Applied" : "Not applied"}
            </p>
          </div>
        )}
      </SettingsSection>
      <SettingsSection
        title="Where your time goes"
        description="Time set aside in sessions, private to you."
      >
        <Field label="Time range">
          <SelectBox
            value={days}
            onChange={(e) => {
              const next = Number(e.target.value);
              if ([7, 30, 90].includes(next)) setDays(next);
            }}
          >
            {[7, 30, 90].map((value) => (
              <option key={value} value={value}>
                {value} days
              </option>
            ))}
          </SelectBox>
        </Field>
        {analytics.loading && !analytics.data && (
          <Loading label="Loading time analytics" />
        )}
        {analytics.error && (
          <ErrorNotice
            message={analytics.error}
            onRetry={() => void analytics.reload()}
          />
        )}
        {analytics.data && (
          <>
            <dl className="settings-planning-totals">
              <div>
                <dt>Time set aside</dt>
                <dd>{minutes(analytics.data.planned_minutes)}</dd>
              </div>
              <div>
                <dt>Tasks finished</dt>
                <dd>{analytics.data.completed}</dd>
              </div>
            </dl>
            {analytics.data.planned_minutes === 0 &&
              analytics.data.completed === 0 && (
                <p className="muted">
                  No planned-time or completed-task history in this range.
                </p>
              )}
            {(
              [
                ["By list", analytics.data.by_list],
                ["By tag", analytics.data.by_tag],
              ] as const
            ).map(
              ([title, rows]) =>
                rows.length > 0 && (
                  <div key={title}>
                    <h4>{title}</h4>
                    <ul className="settings-planning-list">
                      {rows.map((row, index) => (
                        <li key={`${row.name}:${index}`}>
                          <span dir="auto">{row.name || "Unassigned"}</span>
                          <strong>{minutes(row.minutes)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
          </>
        )}
      </SettingsSection>
    </>
  );
}
