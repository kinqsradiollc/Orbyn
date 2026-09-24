import { Select } from "../../components/Select";
import { useState } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Pin,
  PinOff,
  Search,
} from "lucide-react";
import {
  clockMinutes,
  dayTime,
  weekdayOf,
  type ItemInput,
  type MeetingSlot,
  type MemberAvailability,
  type TeamDetail,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { useRemote } from "../../hooks/useRemote";
import { usePlanning } from "../../app/planning";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { dayKey, ESTIMATES, minutesLabel, spanLabel } from "../../lib/planning";
import { addDays, rangeTitle, startOfWeek } from "../calendar/dates";
import { AtRiskList } from "./AtRiskList";
import { TeamCapacity } from "./TeamCapacity";
import { TeamAttention } from "./TeamAttention";

type Props = {
  team: TeamDetail;
  userId?: string;
  canWrite: boolean;
  canManage: boolean;
  report: (e: unknown) => void;
  /** Opens a new team event prefilled with a meeting time. */
  onNewEvent: (draft: Partial<ItemInput>) => void;
};

const DAY_MS = 86_400_000;
const pct = (minutes: number) =>
  `${(Math.max(0, Math.min(1440, minutes)) / 1440) * 100}%`;
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A member's working window on `day`, in minutes from local midnight. */
function workWindow(m: MemberAvailability, day: Date) {
  const key = dayKey(day);
  if (!m.work_days.includes(weekdayOf(key))) return null;
  const start = dayTime(key, clockMinutes(m.work_start), m.timezone);
  const end = dayTime(key, clockMinutes(m.work_end), m.timezone);
  return {
    from: (start.getTime() - day.getTime()) / 60000,
    to: (end.getTime() - day.getTime()) / 60000,
  };
}

/**
 * Team time: who is busy this week (never what they're doing), how loaded
 * everyone is, and finding a time that works for a group.
 */
export function TeamPlanning({
  team,
  userId,
  canWrite,
  canManage,
  report,
  onNewEvent,
}: Props) {
  const { prefs, savePrefs } = usePlanning();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const days = Array.from({ length: 7 }, (_, n) => addDays(weekStart, n));
  const from = weekStart.toISOString();
  const to = addDays(weekStart, 7).toISOString();
  const availability = useRemote(
    () => client.teamAvailability(team.id, from, to),
    [team.id, from],
    report,
  );
  const workload = useRemote(
    () => client.teamWorkload(team.id, from, to),
    [team.id, from],
    report,
  );
  const analytics = useRemote(
    () =>
      canManage ? client.teamAnalytics(team.id, 30) : Promise.resolve(null),
    [team.id, canManage],
    report,
  );
  const pinned = prefs?.pinned_user_ids ?? [];
  const pin = useAction(report);

  const togglePin = (id: string) =>
    void pin.run(async () => {
      await savePrefs({
        pinned_user_ids: pinned.includes(id)
          ? pinned.filter((x) => x !== id)
          : [...pinned, id].slice(-20),
      });
    });

  const people = [...(availability ?? [])].sort(
    (a, b) =>
      Number(pinned.includes(b.user_id)) - Number(pinned.includes(a.user_id)) ||
      a.name.localeCompare(b.name),
  );

  return (
    <>
      <div className="subheading">
        <h3>Team time</h3>
        <div className="week-nav">
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ChevronLeft size={17} />
          </button>
          <span aria-live="polite">{rangeTitle(days)}</span>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      <section className="team-block" aria-labelledby="avail-title">
        <h4 id="avail-title">Availability</h4>
        <p className="muted team-block-lead">
          Shaded bars are working hours; dark marks are busy. Event details are
          never shared.
        </p>
        {!availability ? (
          <p className="muted team-block-lead">Loading availability…</p>
        ) : (
          <div className="table-wrap">
            <table className="avail-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  {days.map((d) => (
                    <th scope="col" key={d.toISOString()}>
                      {d.toLocaleDateString([], {
                        weekday: "short",
                        day: "numeric",
                      })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((m) => {
                  const isPinned = pinned.includes(m.user_id);
                  return (
                    <tr key={m.user_id}>
                      <th scope="row">
                        <span className="avail-person">
                          {m.user_id !== userId && (
                            <button
                              className="icon-button"
                              aria-pressed={isPinned}
                              aria-label={
                                isPinned ? `Unpin ${m.name}` : `Pin ${m.name}`
                              }
                              title={isPinned ? "Unpin" : "Pin to the top"}
                              disabled={pin.pending}
                              onClick={() => togglePin(m.user_id)}
                            >
                              {isPinned ? (
                                <PinOff size={13} />
                              ) : (
                                <Pin size={13} />
                              )}
                            </button>
                          )}
                          <span>
                            <strong>{m.name}</strong>
                            <small>{m.timezone.replaceAll("_", " ")}</small>
                          </span>
                        </span>
                      </th>
                      {days.map((d) => {
                        const start = d.getTime();
                        const busy = m.busy
                          .map((b) => ({
                            from: (Date.parse(b.start_at) - start) / 60000,
                            to: (Date.parse(b.end_at) - start) / 60000,
                            label: spanLabel(b.start_at, b.end_at),
                          }))
                          .filter((b) => b.to > 0 && b.from < DAY_MS / 60000);
                        const work = workWindow(m, d);
                        const label = `${m.name}, ${d.toLocaleDateString([], {
                          weekday: "long",
                        })}: ${
                          busy.length
                            ? "busy " + busy.map((b) => b.label).join(", ")
                            : work
                              ? "free"
                              : "not working"
                        }`;
                        return (
                          <td key={d.toISOString()}>
                            <span
                              className="avail-track"
                              role="img"
                              aria-label={label}
                            >
                              {work && (
                                <i
                                  className="avail-work"
                                  style={{
                                    left: pct(work.from),
                                    width: `calc(${pct(work.to)} - ${pct(work.from)})`,
                                  }}
                                />
                              )}
                              {busy.map((b, n) => (
                                <i
                                  key={n}
                                  className="avail-busy"
                                  style={{
                                    left: pct(b.from),
                                    width: `max(2px, calc(${pct(b.to)} - ${pct(b.from)}))`,
                                  }}
                                />
                              ))}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <OutcomeNote outcome={pin.outcome} />
      </section>

      <section className="team-block" aria-labelledby="capacity-title">
        <h4 id="capacity-title">Who has room</h4>
        <p className="muted team-block-lead">
          Free working time each day, after meetings, bookings and planned work.
          Nobody sees what anyone&apos;s time is for.
        </p>
        <TeamCapacity
          teamId={team.id}
          weekStart={weekStart}
          canWrite={canWrite}
          report={report}
          onNewTask={onNewEvent}
        />
      </section>

      <section className="team-block" aria-labelledby="attention-title">
        <h4 id="attention-title">Meeting budget</h4>
        <TeamAttention
          teamId={team.id}
          weekStart={weekStart}
          canManage={canManage}
          report={report}
        />
      </section>

      <section className="team-block" aria-labelledby="load-title">
        <h4 id="load-title">Workload</h4>
        {!workload ? (
          <p className="muted team-block-lead">Loading workload…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Free time</th>
                  <th>Assigned</th>
                  <th>Open tasks</th>
                  <th>No estimate</th>
                  <th>Load</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((w) => (
                  <tr key={w.user_id}>
                    <td>
                      <strong>{w.name}</strong>
                      <span className="chip-row">
                        {w.overloaded && (
                          <span className="chip is-danger">Overloaded</span>
                        )}
                        {w.at_risk > 0 && (
                          <span className="chip is-warn">
                            {w.at_risk} at risk
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label="Free time">
                      {minutesLabel(w.capacity_minutes)}
                    </td>
                    <td data-label="Assigned">
                      {minutesLabel(w.assigned_minutes)}
                    </td>
                    <td data-label="Open tasks">{w.open_tasks}</td>
                    <td data-label="No estimate">{w.unestimated_tasks}</td>
                    <td data-label="Load">
                      <span
                        className={
                          "load-bar" + (w.overloaded ? " is-over" : "")
                        }
                        role="meter"
                        aria-label={`Load for ${w.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(Math.min(w.load, 1) * 100)}
                        aria-valuetext={`${Math.round(w.load * 100)}%`}
                      >
                        <span
                          style={{ width: `${Math.min(100, w.load * 100)}%` }}
                        />
                      </span>
                      <small className="load-value">
                        {Math.round(w.load * 100)}%
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {workload && <AtRiskList workload={workload} />}
        {analytics && analytics.total_planned_minutes > 0 && (
          <div className="team-analytics">
            <h3 className="team-block-title">Set-aside time · last 30 days</h3>
            <ul className="team-analytics-list">
              {analytics.members
                .filter((m) => m.planned_minutes > 0 || m.completed > 0)
                .map((m) => (
                  <li key={m.user_id}>
                    <span className="team-analytics-name">{m.name}</span>
                    <span className="mono">
                      {Math.round(m.planned_minutes / 60)} h
                    </span>
                    <small className="muted">{m.completed} done</small>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      <FindATime
        team={team}
        canWrite={canWrite}
        report={report}
        onNewEvent={onNewEvent}
      />
    </>
  );
}

/** Find a time looks at this many hand-picked people at most. */
const MAX_PEOPLE = 50;

function FindATime({
  team,
  canWrite,
  report,
  onNewEvent,
}: Pick<Props, "team" | "canWrite" | "report" | "onNewEvent">) {
  const [picked, setPicked] = useState<string[]>(() =>
    team.members.map((m) => m.user_id),
  );
  const [duration, setDuration] = useState(30);
  const [slots, setSlots] = useState<MeetingSlot[] | null>(null);
  const action = useAction(report);
  const everyone = team.members.every((m) => picked.includes(m.user_id));
  const tooMany = !everyone && picked.length > MAX_PEOPLE;

  const find = () =>
    void action.run(async () => {
      const now = new Date();
      now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
      const found = await client.suggestMeetingTimes(team.id, {
        from: now.toISOString(),
        to: new Date(now.getTime() + 7 * DAY_MS).toISOString(),
        duration,
        // Everyone: the server takes the whole team (a long list of ids
        // wouldn't fit in the address).
        ...(everyone ? {} : { user_ids: picked }),
      });
      setSlots(found);
      if (!found.length) return "No shared free time in the next 7 days.";
    });

  return (
    <section className="team-block" aria-labelledby="find-title">
      <h4 id="find-title">Find a time</h4>
      <fieldset className="check-group">
        <legend>Who needs to be there</legend>
        <div className="check-grid">
          {team.members.map((m) => (
            <label key={m.user_id} className="check-line">
              <input
                type="checkbox"
                checked={picked.includes(m.user_id)}
                disabled={
                  !picked.includes(m.user_id) &&
                  picked.length >= MAX_PEOPLE &&
                  picked.length + 1 < team.members.length
                }
                onChange={() =>
                  setPicked((p) =>
                    p.includes(m.user_id)
                      ? p.filter((x) => x !== m.user_id)
                      : [...p, m.user_id],
                  )
                }
              />
              {m.name}
            </label>
          ))}
        </div>
        {team.members.length > MAX_PEOPLE && (
          <small className="field-hint" role={tooMany ? "alert" : undefined}>
            {tooMany
              ? `Pick up to ${MAX_PEOPLE} people, or everyone.`
              : `Everyone, or up to ${MAX_PEOPLE} people you pick.`}{" "}
            {!everyone && (
              <button
                type="button"
                className="link-button"
                onClick={() => setPicked(team.members.map((m) => m.user_id))}
              >
                Pick everyone
              </button>
            )}
          </small>
        )}
      </fieldset>
      <div className="inline-form">
        <label className="sr-only" htmlFor="find-length">
          Meeting length
        </label>
        <Select
          id="find-length"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        >
          {ESTIMATES.map((m) => (
            <option key={m} value={m}>
              {minutesLabel(m)}
            </option>
          ))}
        </Select>
        <button
          className="primary"
          disabled={action.pending || !picked.length || tooMany}
          onClick={find}
        >
          <Search size={14} /> {action.pending ? "Looking…" : "Find times"}
        </button>
      </div>
      <OutcomeNote outcome={action.outcome} />
      {slots && slots.length > 0 && (
        <ul className="slot-list">
          {slots.slice(0, 8).map((s) => (
            <li key={s.start_at}>
              <span>
                <strong>
                  {new Date(s.start_at).toLocaleDateString([], {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </strong>
                <small>
                  {timeOf(s.start_at)} – {timeOf(s.end_at)}
                  {s.disruption === 0 && " · no one's focus time is split"}
                </small>
              </span>
              {canWrite && (
                <button
                  className="secondary"
                  onClick={() =>
                    onNewEvent({
                      kind: "event",
                      title: "",
                      due_at: s.start_at,
                      end_at: s.end_at,
                    })
                  }
                >
                  <CalendarPlus size={14} /> Create event
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
