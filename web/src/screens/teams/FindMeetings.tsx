import { useRef, useState } from "react";
import {
  addDays,
  dayTime,
  hasTeamPermission,
  localDateKey,
  suggestQuery,
  type MeetingSlot,
  type TeamDetail,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Field, Input } from "../../ui/kit";
import { tasks } from "../shared-task/host-store";
import { span } from "./Availability";
import { readTeam, useOwned } from "./state";
export function FindMeetings({
  team,
  canWrite,
  zone,
}: {
  team: TeamDetail;
  canWrite: boolean;
  zone: string;
}) {
  const today = localDateKey(new Date(), zone),
    [from, setFrom] = useState(today),
    [to, setTo] = useState(addDays(today, 7)),
    [duration, setDuration] = useState("30"),
    [picked, setPicked] = useState(() => team.members.map((m) => m.user_id)),
    [result, setResult] = useState<{
      key: string;
      slots: MeetingSlot[];
    } | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    lock = useRef(false),
    seq = useRef(0),
    owned = useOwned();
  const key = JSON.stringify([
      team.id,
      from,
      to,
      duration,
      picked,
      zone,
      team.members.map((m) => m.user_id),
    ]),
    latest = useRef(key);
  latest.current = key;
  const participants = picked.filter((id) =>
    team.members.some((m) => m.user_id === id),
  );
  const everyone = team.members.every((m) => participants.includes(m.user_id)),
    tooMany = !everyone && participants.length > 50,
    slots = result?.key === key ? result.slots : null;
  const changed = (update: () => void) => {
    update();
    seq.current++;
    setResult(null);
    setError("");
  };
  const find = async () => {
    if (!owned() || lock.current || !participants.length || tooMany) return;
    if (from < localDateKey(new Date(), zone)) {
      setError("Choose today or a later start date.");
      return;
    }
    let parsed;
    try {
      parsed = suggestQuery.safeParse({
        from: (from === localDateKey(new Date(), zone)
          ? new Date(Math.ceil(Date.now() / 900000) * 900000)
          : dayTime(from, 0, zone)
        ).toISOString(),
        to: dayTime(to, 0, zone).toISOString(),
        duration: Number(duration),
        ...(!everyone ? { user_ids: participants.join(",") } : {}),
      });
    } catch {
      setError("Choose valid start and end dates.");
      return;
    }
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the date range and duration.",
      );
      return;
    }
    lock.current = true;
    setPending(true);
    setError("");
    const opening = key,
      mine = ++seq.current;
    try {
      const rows = await client.suggestMeetingTimes(team.id, {
        from: parsed.data.from,
        to: parsed.data.to,
        duration: parsed.data.duration,
        ...(!everyone ? { user_ids: [...participants] } : {}),
      });
      if (owned() && latest.current === opening && mine === seq.current)
        setResult({ key: opening, slots: rows });
    } catch (e) {
      if (owned() && latest.current === opening && mine === seq.current)
        setError(
          e instanceof Error ? e.message : "Could not find meeting times.",
        );
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  };
  const event = async (slot: MeetingSlot) => {
    if (!owned() || lock.current || !canWrite || result?.key !== key) return;
    lock.current = true;
    setPending(true);
    setError("");
    const opening = key;
    try {
      const fresh = await readTeam(team.id);
      if (!owned() || latest.current !== opening) return;
      if (!hasTeamPermission(fresh.role, "items:write"))
        throw Error("Your team role no longer allows event creation.");
      if (Date.parse(slot.start_at) <= Date.now())
        throw Error("This time has passed. Find fresh meeting times.");
      tasks.create({
        prefill: {
          team_id: team.id,
          kind: "event",
          due_at: slot.start_at,
          end_at: slot.end_at,
        },
      });
    } catch (e) {
      if (owned())
        setError(
          e instanceof Error ? e.message : "Could not open the event draft.",
        );
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  };
  return (
    <section className="teams-section">
      <h3>Find meeting times</h3>
      <p className="small">
        Searching does not create a meeting. Choose a result to open an event
        draft. Dates and results use {zone}. A search starting today begins at
        the next quarter hour.
      </p>
      <fieldset disabled={pending}>
        <legend>People</legend>
        <div className="teams-actions">
          <Button
            onClick={() =>
              changed(() => setPicked(team.members.map((m) => m.user_id)))
            }
          >
            Everyone
          </Button>
          <Button onClick={() => changed(() => setPicked([]))}>
            Clear people
          </Button>
        </div>
        <div className="teams-person-picks">
          {team.members.map((m) => (
            <label className="teams-check" key={m.user_id}>
              <input
                type="checkbox"
                checked={picked.includes(m.user_id)}
                onChange={(e) =>
                  changed(() =>
                    setPicked((old) =>
                      e.target.checked
                        ? [...old, m.user_id]
                        : old.filter((id) => id !== m.user_id),
                    ),
                  )
                }
              />
              <span dir="auto">{m.name}</span>
            </label>
          ))}
        </div>
        <div className="teams-form-row">
          <Field label="From">
            <Input
              type="date"
              value={from}
              onChange={(e) => changed(() => setFrom(e.target.value))}
            />
          </Field>
          <Field label="Until (exclusive)">
            <Input
              type="date"
              value={to}
              onChange={(e) => changed(() => setTo(e.target.value))}
            />
          </Field>
          <Field label="Duration (minutes)">
            <Input
              type="number"
              min={15}
              max={480}
              step={1}
              value={duration}
              onChange={(e) => changed(() => setDuration(e.target.value))}
            />
          </Field>
        </div>
      </fieldset>
      {tooMany && <p role="alert">Choose up to 50 people, or everyone.</p>}
      {error && <ErrorNotice message={error} onRetry={() => void find()} />}
      <Button
        variant="primary"
        busy={pending}
        disabled={!participants.length || tooMany}
        onClick={() => void find()}
      >
        Find times
      </Button>
      {slots && !slots.length && (
        <p>No common free times were found in this range.</p>
      )}
      <ul className="teams-records">
        {slots?.map((s) => (
          <li key={`${s.start_at}:${s.end_at}`}>
            <strong>{span(s.start_at, s.end_at, zone)}</strong>
            <span className="small">
              {s.disruption === 0
                ? "No focus time split"
                : `${s.disruption} ${s.disruption === 1 ? "person’s" : "people’s"} focus time split`}
            </span>
            {canWrite && (
              <Button disabled={pending} onClick={() => void event(s)}>
                Create event draft
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
