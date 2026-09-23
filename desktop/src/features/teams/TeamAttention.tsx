import { useCallback, useEffect, useState } from "react";
import { hoursLabel, type TeamAttention as Attention } from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";
import { dayKey } from "../../lib/planning";
import "./team-capacity.css";

const BUDGETS = [null, 240, 360, 480, 600, 720, 960, 1200];

/**
 * How much of each person's week meetings take, against the team's budget.
 * Owners and admins set the budget; everyone sees the bars.
 */
export function TeamAttention({
  teamId,
  weekStart,
  canManage,
  report,
}: {
  teamId: string;
  weekStart: Date;
  canManage: boolean;
  report: (e: unknown) => void;
}) {
  const [data, setData] = useState<Attention | null>(null);
  const week = dayKey(weekStart);
  const load = useCallback(() => {
    client.teamAttention(teamId, week).then(setData, report);
  }, [teamId, week, report]);
  useEffect(load, [load]);
  if (!data) return <p className="muted team-block-lead">Loading…</p>;
  const budget = data.budget_minutes;
  const most = Math.max(
    budget ?? 0,
    ...data.members.map((m) => m.meeting_minutes),
    60,
  );
  return (
    <>
      <div className="attention-head">
        <p className="muted team-block-lead">
          {budget
            ? `Meetings are kept to ${hoursLabel(budget)} a person a week. Team events and events with people invited count.`
            : "No meeting budget yet. Team events and events with people invited count as meetings."}
        </p>
        {canManage && (
          <label className="attention-budget">
            Budget
            <Select
              value={String(budget ?? "")}
              onChange={(e) =>
                void client
                  .setMeetingBudget(
                    teamId,
                    e.target.value ? Number(e.target.value) : null,
                  )
                  .then(load, report)
              }
            >
              {BUDGETS.map((b) => (
                <option key={b ?? "none"} value={b ?? ""}>
                  {b ? `${hoursLabel(b)} a week` : "No budget"}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      <ul className="attention-list">
        {data.members.map((m) => (
          <li key={m.user_id}>
            <span className="attention-name">{m.name}</span>
            <span
              className={"attention-bar" + (m.over ? " is-over" : "")}
              role="meter"
              aria-label={`${m.name}'s meetings this week`}
              aria-valuemin={0}
              aria-valuemax={budget ?? most}
              aria-valuenow={m.meeting_minutes}
              aria-valuetext={`${hoursLabel(m.meeting_minutes)}${budget ? ` of ${hoursLabel(budget)}` : ""}`}
            >
              <span
                style={{
                  width: `${Math.min(100, (m.meeting_minutes / most) * 100)}%`,
                }}
              />
              {budget && (
                <i
                  style={{ left: `${Math.min(100, (budget / most) * 100)}%` }}
                  aria-hidden="true"
                />
              )}
            </span>
            <small className={m.over ? "attention-over" : "muted"}>
              {hoursLabel(m.meeting_minutes)}
              {budget ? ` of ${hoursLabel(budget)}` : ""}
              {m.over ? " · over" : ""}
            </small>
          </li>
        ))}
      </ul>
    </>
  );
}
