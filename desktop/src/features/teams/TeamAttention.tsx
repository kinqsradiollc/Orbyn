import { useEffect, useRef, useState } from "react";
import { hoursLabel, type TeamAttention as Attention } from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";
import { dayKey } from "../planner/planning";
import "./team-capacity.css";
import { useSettingsRead } from "../settings/useSettingsRead";
import { usePaneLeaveGuard } from "../../app/page-commands";
import { errorText } from "../../lib/errors";

const BUDGETS = [null, 240, 360, 480, 600, 720, 960, 1200];

/**
 * How much of each person's week meetings take, against the team's budget.
 * Owners and admins set the budget; everyone sees the bars.
 */
export function TeamAttention(props: Parameters<typeof TeamAttentionBody>[0]) {
  return (
    <TeamAttentionBody
      key={`${props.teamId}:${dayKey(props.weekStart)}`}
      {...props}
    />
  );
}

function TeamAttentionBody({
  teamId,
  weekStart,
  canManage,
  report,
  onBusyChange,
}: {
  teamId: string;
  weekStart: Date;
  canManage: boolean;
  report: (e: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mutation = useRef(false);
  const busyReporter = useRef(onBusyChange);
  busyReporter.current = onBusyChange;
  const week = dayKey(weekStart);
  const read = useSettingsRead<Attention>(
    () => client.teamAttention(teamId, week),
    report,
  );
  const { data, failed } = read;
  const load = read.reload;
  usePaneLeaveGuard(async () => !mutation.current);
  useEffect(
    () => () => {
      busyReporter.current?.(false);
    },
    [],
  );
  const changeBudget = async (budget: number | null) => {
    if (!canManage || !read.current() || mutation.current) return;
    mutation.current = true;
    busyReporter.current?.(true);
    setBusy(true);
    setError("");
    try {
      await client.setMeetingBudget(teamId, budget);
      if (read.current()) {
        read.commit((previous) =>
          previous ? { ...previous, budget_minutes: budget } : previous,
        );
        await load();
      }
    } catch (e) {
      if (read.current()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (read.current()) {
        setBusy(false);
        busyReporter.current?.(false);
      }
    }
  };
  if (!data)
    return failed ? (
      <p role="alert">
        Meeting time couldn’t be loaded.{" "}
        <button className="text-button" onClick={() => void load()}>
          Retry
        </button>
      </p>
    ) : (
      <p className="muted team-block-lead" role="status">
        Loading meeting time…
      </p>
    );
  const budget = data.budget_minutes;
  const most = Math.max(
    budget ?? 0,
    ...data.members.map((m) => m.meeting_minutes),
    60,
  );
  return (
    <>
      {busy && (
        <p role="status" className="muted">
          Saving budget…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {failed && (
        <p role="alert">
          Meeting time couldn’t be refreshed.{" "}
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      <div className="attention-head">
        <p className="muted team-block-lead">
          {budget
            ? `Budget: ${hoursLabel(budget)} per person each week.`
            : "No meeting budget set."}
        </p>
        {canManage && (
          <label className="attention-budget">
            Budget
            <Select
              value={String(budget ?? "")}
              disabled={busy || read.loading || failed}
              onChange={(event) =>
                void changeBudget(
                  event.target.value ? Number(event.target.value) : null,
                )
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
      <details className="team-budget-help">
        <summary>What counts as a meeting</summary>
        <p className="muted">
          Team events and events with invited people count toward this budget.
        </p>
      </details>
      <ul className="attention-list">
        {data.members.map((m) => (
          <li key={m.user_id}>
            <span className="attention-name">{m.name}</span>
            <span
              className={"attention-bar" + (m.over ? " is-over" : "")}
              role="meter"
              aria-label={`${m.name}'s meetings this week`}
              aria-valuemin={0}
              aria-valuemax={most}
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
