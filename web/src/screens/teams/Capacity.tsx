import { useRef, useState } from "react";
import {
  dayTime,
  hasTeamPermission,
  hoursLabel,
  type CapacityDay,
  type MemberCapacity,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Pill } from "../../ui/kit";
import { useTasks } from "../shared-task/host-store";
import { ReadState, readTeam, useOwned, useRead } from "./state";
const level = [
  "No free time",
  "Under 2 hours free",
  "2–5 hours free",
  "5 or more hours free",
] as const;
export function Capacity({
  teamId,
  from,
  to,
  canWrite,
}: {
  teamId: string;
  from: Date;
  to: Date;
  canWrite: boolean;
}) {
  const tasks = useTasks();
  const owned = useOwned(),
    lock = useRef(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const read = useRead(
      () => client.teamCapacity(teamId, from, to),
      [teamId, from.toISOString(), to.toISOString()],
    ),
    [picked, setPicked] = useState<{
      member: MemberCapacity;
      day: CapacityDay;
    } | null>(null),
    capacity = read.data;
  const createTask = async () => {
    if (!picked || !capacity || !owned() || lock.current) return;
    const selection = picked;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const fresh = await readTeam(teamId);
      if (!owned()) return;
      if (!fresh.members.some((m) => m.user_id === selection.member.user_id))
        throw Error("This teammate is no longer in the team.");
      if (!hasTeamPermission(fresh.role, "items:write"))
        throw Error("Your team role no longer permits task creation.");
      tasks.create({
        prefill: {
          kind: "task",
          team_id: teamId,
          assignee_id: selection.member.user_id,
          due_at: dayTime(
            selection.day.day,
            17 * 60,
            capacity.timezone,
          ).toISOString(),
        },
      });
    } catch (e) {
      if (owned())
        setError(
          e instanceof Error ? e.message : "Could not open a task draft.",
        );
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  };
  return (
    <section className="teams-section">
      <h3>Capacity</h3>
      <p className="small">
        Free working time after events, sessions and busy frames.{" "}
        {capacity?.show_hours
          ? "Owners and admins can see hour totals."
          : "Availability bands do not reveal exact private hours."}
      </p>
      <ReadState read={read} label="capacity" />
      <Button
        disabled={read.loading || pending}
        onClick={() => {
          setPicked(null);
          void read.reload();
        }}
      >
        Refresh capacity
      </Button>
      {error && <ErrorNotice message={error} />}
      {capacity && (
        <>
          <p className="small">
            Dates use {capacity.timezone}.{" "}
            {capacity.members.length === 50 &&
              "The server projects at most 50 members."}
          </p>
          {!capacity.members.length && <p>No capacity data returned.</p>}
          <div className="teams-capacity">
            {capacity.members.map((m) => (
              <details key={m.user_id}>
                <summary>
                  <strong dir="auto">{m.name}</strong>
                  {capacity.show_hours && m.unplaced_minutes !== null && (
                    <span>{hoursLabel(m.unplaced_minutes)} unplaced</span>
                  )}
                </summary>
                <ul className="teams-capacity-days">
                  {m.days.map((d) => (
                    <li key={d.day}>
                      <Button
                        aria-pressed={
                          picked?.member.user_id === m.user_id &&
                          picked.day.day === d.day
                        }
                        disabled={pending}
                        onClick={() => setPicked({ member: m, day: d })}
                      >
                        <span>{d.day}</span>
                        <span>
                          {d.off
                            ? "Not working"
                            : capacity.show_hours && d.free_minutes !== null
                              ? `${hoursLabel(d.free_minutes)} free`
                              : level[d.level]}
                        </span>
                        {d.over && <Pill tone="amber">Over hours</Pill>}
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          {picked && (
            <div
              className="teams-selection"
              role="region"
              aria-label="Selected capacity day"
            >
              <h4 dir="auto">
                {picked.member.name} · {picked.day.day}
              </h4>
              <p>
                {picked.day.off
                  ? "Not a working day."
                  : level[picked.day.level]}
                {picked.day.over ? " Planned beyond working hours." : ""}
              </p>
              {capacity.show_hours && (
                <dl className="teams-facts">
                  {(
                    [
                      ["Working", picked.day.working_minutes],
                      ["Free", picked.day.free_minutes],
                      ["This team", picked.day.team_minutes],
                      ["Over hours", picked.day.over_minutes],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        {value === null ? "Not shared" : hoursLabel(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {canWrite && (
                <Button disabled={pending} onClick={() => void createTask()}>
                  Task for {picked.member.name}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
