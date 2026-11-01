import { Button, Pill } from "../../ui/kit";
import { client } from "../../lib/session";
import { ReadState, useRead } from "./state";
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const span = (start: string, end: string, zone: string) =>
  `${new Date(start).toLocaleString([], { timeZone: zone, dateStyle: "medium", timeStyle: "short" })} – ${new Date(end).toLocaleString([], { timeZone: zone, dateStyle: "medium", timeStyle: "short" })}`;
export function Availability({
  teamId,
  from,
  to,
  zone,
  pinned,
  onPin,
  pinBlocked,
}: {
  teamId: string;
  from: string;
  to: string;
  zone: string;
  pinned: string[];
  onPin: (id: string) => void;
  pinBlocked: boolean;
}) {
  const read = useRead(
      () => client.teamAvailability(teamId, from, to),
      [teamId, from, to],
    ),
    presence = useRead(() => client.teamPresence(teamId), [teamId]),
    people = [...(read.data ?? [])].sort(
      (a, b) =>
        Number(pinned.includes(b.user_id)) -
          Number(pinned.includes(a.user_id)) || a.name.localeCompare(b.name),
    );
  return (
    <section className="teams-section">
      <h3>Availability</h3>
      <p className="small">
        Working hours and busy intervals only. Event details remain private.
        Times below use {zone}.
      </p>
      <ReadState read={read} label="availability" />
      <ReadState read={presence} label="shared presence" />
      <Button
        disabled={read.loading || presence.loading}
        onClick={() => {
          void read.reload();
          void presence.reload();
        }}
      >
        Refresh availability
      </Button>
      {read.data && !people.length && (
        <p>No availability returned for this team.</p>
      )}
      <div className="teams-availability">
        {people.map((m) => {
          const status = presence.data?.find(
            (p) => p.user_id === m.user_id,
          )?.status;
          return (
            <details key={m.user_id}>
              <summary>
                <strong dir="auto">{m.name}</strong>
                {status && status !== "hidden" && (
                  <Pill>
                    {status === "active"
                      ? "Active"
                      : status === "away"
                        ? "Away"
                        : "Offline"}
                  </Pill>
                )}
                {pinned.includes(m.user_id) && (
                  <span className="small">Pinned</span>
                )}
              </summary>
              <div className="teams-detail-body">
                <p>
                  Works {m.work_days.map((d) => weekdays[d]).join(", ")} ·{" "}
                  {m.work_start}–{m.work_end} · {m.timezone}
                </p>
                <Button disabled={pinBlocked} onClick={() => onPin(m.user_id)}>
                  {pinned.includes(m.user_id)
                    ? "Unpin teammate"
                    : "Pin teammate"}
                </Button>
                {m.busy.length ? (
                  <ul>
                    {m.busy.map((b, i) => (
                      <li key={`${b.start_at}-${i}`}>
                        {span(b.start_at, b.end_at, zone)} · busy
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No busy commitments returned in this range.</p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
