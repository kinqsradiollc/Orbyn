import { useEffect, useState } from "react";
import {
  SESSION_OUTCOME_LABELS,
  checkInNote,
  shortMinutes,
  type SessionCheckIn,
  type SessionOutcome,
} from "@orbyn/core";
import { client } from "../../lib/api";

/** "Tue 9:00 – 10:00 am" for a session that has ended. */
function when(s: SessionCheckIn) {
  const start = new Date(s.start_at);
  const end = new Date(s.end_at);
  const day = start.toLocaleDateString([], { weekday: "short" });
  const time = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} ${time(start)} – ${time(end)}`;
}

/** How much more "Need more" can ask for. */
const MORE = [15, 30, 60, 120];

type Props = {
  /** Changes whenever Today is loaded again, so the list follows it. */
  version: unknown;
  /** Opens the task. */
  onOpen: (itemId: string) => void;
  /** Plans time for a task (after "Need more" or "Skip"). */
  onPlanIt: (itemId: string) => void;
  /** After an answer: Today and the planned feed load again. */
  onChanged: () => void;
  /** The ids listed, so "Not finished" doesn't list them twice. */
  onListed?: (ids: string[]) => void;
  report: (error: unknown) => void;
};

/**
 * Session check-in on the Today card: sessions that ended in the last few
 * days, and how each went. "Done for today" and "Need more" count its time
 * toward the task (once); "Skip" leaves that time still needed. Until
 * someone answers, a past session is never taken as done.
 */
export function SessionCheckIns({
  version,
  onOpen,
  onPlanIt,
  onChanged,
  onListed,
  report,
}: Props) {
  const [list, setList] = useState<SessionCheckIn[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{
    id: string;
    item_id: string;
    text: string;
    plan: boolean;
  } | null>(null);

  useEffect(() => {
    let live = true;
    client.sessionCheckIns().then(
      (rows) => {
        if (!live) return;
        setList(rows);
        onListed?.(rows.map((r) => r.id));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // onListed is a setter from the parent; the list follows Today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const answer = async (
    s: SessionCheckIn,
    outcome: SessionOutcome,
    more?: number,
  ) => {
    setBusy(s.id);
    try {
      const r = await client.checkInSession(s.id, {
        outcome,
        ...(more ? { more_minutes: more } : {}),
      });
      setList((l) => l.filter((x) => x.id !== s.id));
      setAsking(null);
      setSaid({
        id: s.id,
        item_id: s.item_id,
        text: `${s.title}: ${checkInNote(outcome, r.counted_minutes)}`,
        plan: outcome !== "done",
      });
      onChanged();
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  };

  if (!list.length && !said) return null;
  return (
    <div className="today-unfinished today-checkin">
      {list.length > 0 && (
        <h3>
          How did it go? <span>{list.length}</span>
        </h3>
      )}
      {said && (
        <p className="today-checkin-said" role="status">
          {said.text}
          {said.plan && (
            <button
              type="button"
              className="text-button"
              onClick={() => onPlanIt(said.item_id)}
            >
              Plan it
            </button>
          )}
          <button
            type="button"
            className="text-button is-quiet"
            onClick={() => setSaid(null)}
          >
            OK
          </button>
        </p>
      )}
      {list.length > 0 && (
        <ul className="today-list is-unfinished">
          {list.map((s) => (
            <li key={s.id} className="today-row is-unfinished">
              <span className="today-main">
                <button
                  type="button"
                  className="today-title"
                  onClick={() => onOpen(s.item_id)}
                  aria-label={`Open ${s.title}`}
                >
                  {s.title}
                </button>
                <span className="today-facts">
                  <small className="today-meta">
                    {when(s)} · {shortMinutes(s.minutes)}
                    {s.project_name ? ` · ${s.project_name}` : ""}
                  </small>
                </span>
              </span>
              {asking === s.id ? (
                <span
                  className="today-buttons today-more-time"
                  role="group"
                  aria-label={`How much more ${s.title} needs`}
                >
                  {MORE.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="plan-chip is-neutral today-more-chip"
                      disabled={busy === s.id}
                      onClick={() => void answer(s, "more", m)}
                    >
                      +{shortMinutes(m)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="text-button today-action is-quiet"
                    onClick={() => setAsking(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span
                  className="today-buttons"
                  role="group"
                  aria-label={`How ${s.title} went`}
                >
                  <button
                    type="button"
                    className="text-button today-action"
                    disabled={busy === s.id}
                    onClick={() => void answer(s, "done")}
                  >
                    {SESSION_OUTCOME_LABELS.done}
                  </button>
                  <button
                    type="button"
                    className="text-button today-action"
                    disabled={busy === s.id}
                    onClick={() => setAsking(s.id)}
                  >
                    {SESSION_OUTCOME_LABELS.more}
                  </button>
                  <button
                    type="button"
                    className="text-button today-action is-quiet"
                    disabled={busy === s.id}
                    onClick={() => void answer(s, "skipped")}
                  >
                    {SESSION_OUTCOME_LABELS.skipped}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
