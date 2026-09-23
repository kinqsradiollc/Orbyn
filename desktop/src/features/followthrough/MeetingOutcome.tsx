import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { hoursLabel, type Item, type WorkRecord } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";

/** The people in a meeting: those invited, and whoever holds it. */
export const meetingPeople = (i: Item) =>
  Math.min(100, Math.max(1, (i.attendees?.length ?? 0) + 1));
export const meetingMinutes = (i: Item) =>
  i.due_at && i.end_at
    ? Math.min(
        1440,
        Math.round((Date.parse(i.end_at) - Date.parse(i.due_at)) / 60_000),
      )
    : 0;

/**
 * A meeting's cost and what came out of it. The cost is its length times
 * the people in it — time, never money. The outcome is a line or two, kept
 * as a record beside the meeting (and its project, when it has one).
 */
export function MeetingOutcome({
  item,
  canWrite,
}: {
  item: Item;
  canWrite: boolean;
}) {
  const [records, setRecords] = useState<WorkRecord[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    client
      .listWorkRecords({
        kind: "meeting_outcome",
        source_item_id: item.id,
        limit: 20,
      })
      .then(setRecords, () => setRecords([]));
  }, [item.id]);
  useEffect(load, [load]);
  const minutes = meetingMinutes(item);
  const people = meetingPeople(item);
  if (!minutes || item.all_day) return null;
  const ended = Date.parse(item.end_at!) <= Date.now();
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await client.createWorkRecord({
        kind: "meeting_outcome",
        title: item.title.slice(0, 200),
        details: text.trim(),
        team_id: item.team_id ?? null,
        project_id: item.project_id ?? null,
        source_item_id: item.id,
        meeting_minutes: minutes,
        participant_count: people,
      });
      setText("");
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="drawer-section" aria-labelledby={`meeting-${item.id}`}>
      <div className="drawer-section-head">
        <h3 id={`meeting-${item.id}`}>
          <Users size={16} aria-hidden="true" /> Meeting
        </h3>
        <span className="drawer-count">
          {hoursLabel(minutes * people)} of people&apos;s time
        </span>
      </div>
      <p className="drawer-hint">
        {hoursLabel(minutes)} × {people} {people === 1 ? "person" : "people"}.
      </p>
      {records?.map((r) => (
        <p key={r.id} className="meeting-outcome">
          <strong>Came out of it:</strong> {r.details || r.outcome}
        </p>
      ))}
      {canWrite && ended && records?.length === 0 && (
        <form
          className="proof-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            value={text}
            maxLength={4000}
            placeholder="What came out of it? A decision, a next step…"
            aria-label="What came out of it"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="proof-actions">
            <button className="secondary" disabled={busy || !text.trim()}>
              Keep it
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
