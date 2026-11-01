import { useState } from "react";
import {
  attentionBudgetInput,
  dueDateOf,
  hoursLabel,
  type TeamDetail,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, Pill } from "../../ui/kit";
import { tasks } from "../shared-task/host-store";
import {
  ActionState,
  ReadState,
  useCommand,
  useRead,
  useTeamsExit,
} from "./state";
import type { PermissionCheck } from "./Workspace";
export function Insights({
  team,
  from,
  to,
  week,
  canManage,
  check,
}: {
  team: TeamDetail;
  from: string;
  to: string;
  week: string;
  canManage: boolean;
  check: PermissionCheck;
}) {
  const workload = useRead(
      () => client.teamWorkload(team.id, from, to),
      [team.id, from, to],
    ),
    attention = useRead(
      () => client.teamAttention(team.id, week),
      [team.id, week],
    ),
    analytics = useRead(
      () =>
        canManage ? client.teamAnalytics(team.id, 30) : Promise.resolve(null),
      [team.id, canManage],
    ),
    [budget, setBudget] = useState(""),
    [editing, setEditing] = useState(false),
    command = useCommand();
  const dirty =
    editing &&
    (budget.trim() === "" ? null : Number(budget)) !==
      attention.data?.budget_minutes;
  useTeamsExit({
    live: command.live,
    dirty,
    pending: command.pending,
    uncertain: command.unknown,
    fingerprint: JSON.stringify([budget, editing]),
    discard: () => {
      setEditing(false);
      setBudget("");
    },
  });
  const save = () => {
    const value = budget.trim() === "" ? null : Number(budget);
    if (!attention.fresh || value === attention.data?.budget_minutes) return;
    if (
      !attentionBudgetInput.safeParse({ meeting_budget_minutes: value }).success
    )
      return;
    void command.run<{ meeting_budget_minutes: number | null }>({
      label: "Save meeting budget",
      prepare: () => check("team:update", true),
      perform: () => client.setMeetingBudget(team.id, value),
      validate: (r) => r.meeting_budget_minutes === value,
      check: async () => {
        const r = await client.teamAttention(team.id, week);
        return {
          done: r.budget_minutes === value,
          value: { meeting_budget_minutes: r.budget_minutes },
        };
      },
      saved: (r) => {
        if (r && attention.data)
          attention.commit({
            ...attention.data,
            budget_minutes: r.meeting_budget_minutes,
          });
        setEditing(false);
      },
    });
  };
  const risk = (workload.data ?? [])
    .flatMap((w) => w.at_risk_items ?? [])
    .sort((a, b) => Date.parse(a.deadline_at) - Date.parse(b.deadline_at));
  return (
    <>
      <section className="teams-section">
        <h3>Workload</h3>
        <ReadState read={workload} label="workload" />
        <Button
          disabled={workload.loading}
          onClick={() => void workload.reload()}
        >
          Refresh workload
        </Button>
        {workload.data && !workload.data.length && <p>No workload returned.</p>}
        <ul className="teams-records">
          {workload.data?.map((w) => (
            <li key={w.user_id}>
              <header className="teams-heading">
                <strong dir="auto">{w.name}</strong>
                {w.overloaded && <Pill tone="amber">Overloaded</Pill>}
              </header>
              <dl className="teams-facts">
                <div>
                  <dt>Free time</dt>
                  <dd>{hoursLabel(w.capacity_minutes)}</dd>
                </div>
                <div>
                  <dt>Assigned</dt>
                  <dd>{hoursLabel(w.assigned_minutes)}</dd>
                </div>
                <div>
                  <dt>Open tasks</dt>
                  <dd>{w.open_tasks}</dd>
                </div>
                <div>
                  <dt>No estimate</dt>
                  <dd>{w.unestimated_tasks}</dd>
                </div>
                <div>
                  <dt>Load</dt>
                  <dd>
                    {Number.isFinite(w.load)
                      ? `${Math.round(w.load * 100)}%`
                      : "No capacity"}
                  </dd>
                </div>
                <div>
                  <dt>At risk</dt>
                  <dd>{w.at_risk}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        {risk.length > 0 && (
          <>
            <h4>At-risk tasks</h4>
            <ul className="teams-records">
              {risk.map((i) => (
                <li key={i.id}>
                  <Button variant="ghost" onClick={() => tasks.open(i.id)}>
                    <span dir="auto">{i.title}</span>
                  </Button>
                  <span>
                    {i.assignee_name} · due {dueDateOf(i)} ·{" "}
                    {hoursLabel(i.remaining_minutes)} remaining
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="teams-section">
        <header className="teams-heading">
          <h3>Meeting budget</h3>
          {canManage && attention.fresh && !editing && (
            <Button
              disabled={command.blocked}
              onClick={() => {
                setBudget(String(attention.data?.budget_minutes ?? ""));
                setEditing(true);
              }}
            >
              Edit budget
            </Button>
          )}
        </header>
        <ReadState read={attention} label="meeting time" />
        <Button
          disabled={attention.loading || command.blocked}
          onClick={() => void attention.reload()}
        >
          Refresh meeting time
        </Button>
        <ActionState command={command} />
        {attention.data && (
          <>
            <p>
              {attention.data.budget_minutes === null
                ? "No weekly meeting budget set."
                : `${hoursLabel(attention.data.budget_minutes)} per person each week.`}
            </p>
            <details>
              <summary>What counts</summary>
              <p>
                Team events and events with invited people count toward the
                meeting budget.
              </p>
            </details>
            <ul className="teams-records">
              {attention.data.members.map((m) => (
                <li key={m.user_id}>
                  <strong dir="auto">{m.name}</strong>
                  <span>{hoursLabel(m.meeting_minutes)} in meetings</span>
                  {m.over && <Pill tone="amber">Over budget</Pill>}
                </li>
              ))}
            </ul>
          </>
        )}
        {editing && (
          <form
            className="teams-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field
              label="Weekly budget (minutes)"
              hint="Leave empty for no budget, or enter 30–2400 minutes."
            >
              <Input
                type="number"
                min={30}
                max={2400}
                step={1}
                value={budget}
                disabled={command.blocked}
                onChange={(e) => setBudget(e.target.value)}
              />
            </Field>
            <div className="teams-actions">
              <Button
                disabled={command.blocked}
                onClick={() => {
                  setEditing(false);
                  setBudget("");
                }}
              >
                Discard budget edits
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  !attention.fresh ||
                  !dirty ||
                  command.blocked ||
                  (!!budget &&
                    (!Number.isInteger(Number(budget)) ||
                      Number(budget) < 30 ||
                      Number(budget) > 2400))
                }
              >
                Save budget
              </Button>
            </div>
          </form>
        )}
      </section>
      {canManage && (
        <section className="teams-section">
          <h3>Last 30 days</h3>
          <ReadState read={analytics} label="team analytics" />
          {analytics.data && (
            <>
              <p>
                {hoursLabel(analytics.data.total_planned_minutes)} planned ·{" "}
                {new Date(analytics.data.from).toLocaleDateString()}–
                {new Date(analytics.data.to).toLocaleDateString()}
              </p>
              <ul className="teams-records">
                {analytics.data.members.map((m) => (
                  <li key={m.user_id}>
                    <strong dir="auto">{m.name}</strong>
                    <span>
                      {hoursLabel(m.planned_minutes)} planned · {m.completed}{" "}
                      completed
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
