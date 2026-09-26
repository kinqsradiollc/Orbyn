import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  dayTime,
  hoursLabel,
  type CapacityDay,
  type ItemInput,
  type MemberCapacity,
  type MemberPresence,
  type TeamCapacity as Capacity,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { useRemote } from "../../hooks/useRemote";
import { addDays } from "../calendar/dates";
import "./team-capacity.css";

const LEVEL_WORDS = ["None", "Under 2h", "2–5h", "5h+"] as const;

/** What a cell says: the hours when the viewer may see them, else a range. */
function cellText(d: CapacityDay) {
  if (d.off) return "Off";
  if (d.free_minutes === null) return d.over ? "Over" : LEVEL_WORDS[d.level];
  if (d.over && d.over_minutes) return `−${hoursLabel(d.over_minutes)}`;
  return hoursLabel(d.free_minutes);
}

const dayName = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: "short" });
const longDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Who has room this week: a person by day grid, shaded by free working
 * time. Everyone sees the shades; owners and admins see the hours. Picking a
 * cell shows that day and offers a task for that person.
 */
export function TeamCapacity({
  teamId,
  weekStart,
  canWrite,
  report,
  onNewTask,
}: {
  teamId: string;
  weekStart: Date;
  canWrite: boolean;
  report: (e: unknown) => void;
  onNewTask: (draft: Partial<ItemInput>) => void;
}) {
  const from = weekStart;
  const to = addDays(weekStart, 7);
  const capacity = useRemote<Capacity>(
    () => client.teamCapacity(teamId, from, to),
    [teamId, from.toISOString()],
    report,
  );
  const [presence, setPresence] = useState<Map<string, MemberPresence>>(
    new Map(),
  );
  const loadPresence = useCallback(() => {
    client.teamPresence(teamId).then(
      (rows) => setPresence(new Map(rows.map((r) => [r.user_id, r]))),
      () => {},
    );
  }, [teamId]);
  useEffect(() => {
    loadPresence();
    return onLive(
      (news) =>
        news.kind === "presence" &&
        (!news.team || news.team === teamId) &&
        loadPresence(),
    );
  }, [teamId, loadPresence]);
  const [picked, setPicked] = useState<{
    member: MemberCapacity;
    day: CapacityDay;
  } | null>(null);

  if (!capacity) return <p className="muted team-block-lead">Loading…</p>;
  // Leave out days nobody works, such as the weekend.
  const shown = capacity.days
    .map((day, n) => ({ day, n }))
    .filter(({ n }) => capacity.members.some((m) => !m.days[n].off));

  return (
    <>
      <div className="table-wrap">
        <table className="capacity-grid">
          <caption className="sr-only">
            Free working time for each person, each day
          </caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              {shown.map(({ day }) => (
                <th scope="col" key={day}>
                  <abbr title={longDay(day)}>{dayName(day)}</abbr>
                </th>
              ))}
              {capacity.show_hours && (
                <th
                  scope="col"
                  title="Assigned team work not planned on any day yet"
                >
                  Unplaced
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {capacity.members.map((m) => {
              const status = presence.get(m.user_id)?.status;
              return (
                <tr key={m.user_id}>
                  <th scope="row">
                    <span className="capacity-person">
                      <span className="capacity-avatar" aria-hidden="true">
                        {initials(m.name)}
                        {(status === "active" || status === "away") && (
                          <i className={"presence-dot is-" + status} />
                        )}
                      </span>
                      <span>
                        {m.name}
                        {(status === "active" || status === "away") && (
                          <small className="sr-only">
                            {" "}
                            ({status === "active" ? "active now" : "away"})
                          </small>
                        )}
                      </span>
                    </span>
                  </th>
                  {shown.map(({ day, n }) => {
                    const d = m.days[n];
                    const on =
                      picked?.member.user_id === m.user_id &&
                      picked.day.day === day;
                    return (
                      <td key={day}>
                        <button
                          type="button"
                          className={
                            "capacity-cell" +
                            (d.off
                              ? " is-off"
                              : d.over
                                ? " is-over"
                                : ` is-l${d.level}`) +
                            (on ? " is-picked" : "")
                          }
                          aria-pressed={on}
                          aria-label={`${m.name}, ${longDay(day)}: ${
                            d.off
                              ? "not working"
                              : d.free_minutes === null
                                ? d.over
                                  ? "planned over working hours"
                                  : `${LEVEL_WORDS[d.level]} free`
                                : d.over
                                  ? `over by ${hoursLabel(d.over_minutes ?? 0)}`
                                  : `${hoursLabel(d.free_minutes)} free`
                          }`}
                          onClick={() =>
                            setPicked(on ? null : { member: m, day: d })
                          }
                        >
                          {cellText(d)}
                        </button>
                      </td>
                    );
                  })}
                  {capacity.show_hours && (
                    <td className="capacity-unplaced">
                      {m.unplaced_minutes
                        ? hoursLabel(m.unplaced_minutes)
                        : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="capacity-legend" aria-hidden="true">
        <span>
          <i className="capacity-swatch is-l0" /> none
        </span>
        <span>
          <i className="capacity-swatch is-l1" /> under 2h
        </span>
        <span>
          <i className="capacity-swatch is-l2" /> 2–5h
        </span>
        <span>
          <i className="capacity-swatch is-l3" /> 5h+
        </span>
        <span>
          <i className="capacity-swatch is-over" /> planned over hours
        </span>
      </p>
      {picked && (
        <div className="capacity-detail" role="region" aria-live="polite">
          <p>
            <strong>
              {picked.member.name} · {longDay(picked.day.day)}
            </strong>
            <span className="muted">
              {picked.day.off
                ? "Not a working day."
                : picked.day.free_minutes === null
                  ? `${LEVEL_WORDS[picked.day.level]} free${picked.day.over ? ", planned past working hours" : ""}.`
                  : `${hoursLabel(picked.day.free_minutes)} free of ${hoursLabel(
                      picked.day.working_minutes ?? 0,
                    )}${
                      picked.day.team_minutes
                        ? `, ${hoursLabel(picked.day.team_minutes)} already planned for this team`
                        : ""
                    }${
                      picked.day.over
                        ? `, planned ${hoursLabel(picked.day.over_minutes ?? 0)} past working hours`
                        : ""
                    }.`}
            </span>
          </p>
          {canWrite && !picked.day.off && (
            <button
              className="secondary"
              onClick={() =>
                onNewTask({
                  kind: "task",
                  team_id: teamId,
                  assignee_id: picked.member.user_id,
                  due_at: dayTime(
                    picked.day.day,
                    17 * 60,
                    capacity.timezone,
                  ).toISOString(),
                })
              }
            >
              <Plus size={14} /> Task for {picked.member.name.split(" ")[0]}
            </button>
          )}
        </div>
      )}
    </>
  );
}
