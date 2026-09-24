import { useEffect, useState } from "react";
import { CalendarClock, CalendarPlus, Wand2 } from "lucide-react";
import {
  dueDate,
  isClosed,
  type HttpError,
  type Item,
  type ItemSessions,
  type TimeBlock,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { minutesLabel, spanLabel } from "../../lib/planning";
import { BlockDialog } from "../calendar/BlockDialog";

/** "Wed 23 Sep". */
const rowDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** The next quarter hour from now, where "Add session…" starts. */
function nextQuarter() {
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return d;
}

/** "before Fri 2 Oct, 5 pm", or "by the end of Fri 2 Oct" for a whole day. */
const byDeadline = (s: ItemSessions) =>
  s.deadline_at
    ? s.due_all_day
      ? `by the end of ${dueDate(s.deadline_at, true)}`
      : `before ${dueDate(s.deadline_at)}`
    : "";

/** "Planned 1 h 30 min before Fri 2 Oct, 5 pm · 3 h 30 min still needed (4 h estimated, 30 min logged)". */
function summary(s: ItemSessions, item: Item) {
  const parts = [
    `Planned ${minutesLabel(s.planned_minutes)}${
      s.deadline_at ? ` ${byDeadline(s)}` : ""
    }`,
  ];
  if (item.estimate_minutes != null && item.remaining_minutes != null) {
    const spent = item.spent_minutes ?? 0;
    parts.push(
      `${minutesLabel(item.remaining_minutes)} still needed (${minutesLabel(
        item.estimate_minutes,
      )} estimated${spent ? `, ${minutesLabel(spent)} logged` : ""})`,
    );
  }
  return parts.join(" · ");
}

/** "No sessions yet. Due Fri 2 Oct, 5 pm · about 4 h of work." */
function emptyText(s: ItemSessions | null, item: Item) {
  const facts: string[] = [];
  if (s?.deadline_at)
    facts.push(
      s.due_all_day
        ? `Due ${dueDate(s.deadline_at, true)}`
        : `Due ${dueDate(s.deadline_at)}`,
    );
  else if (s?.project_deadline)
    facts.push(`No deadline · project ends ${rowDay(s.project_deadline)}`);
  if (item.estimate_minutes)
    facts.push(
      `about ${minutesLabel(item.remaining_minutes ?? item.estimate_minutes)} of work`,
    );
  return `No sessions yet.${facts.length ? ` ${facts.join(" · ")}.` : ""}`;
}

type Props = {
  item: Item;
  /** False for viewers of a team task: nothing to plan or remove. */
  canWrite: boolean;
  /** Changes when the task changes elsewhere, to load its sessions again. */
  reloadKey: string;
  /** Plan time for this task in the calendar, up to its deadline. */
  onFindTime?: (item: Item) => void;
  /** Show a session's day on the calendar. */
  onShowOnCalendar?: (at: string) => void;
  /** A dialog opened or closed here (the drawer leaves Escape to it). */
  onDialogChange?: (open: boolean) => void;
  /** Refresh the planner after a change. */
  onChanged: () => Promise<void>;
  onError: (e: unknown) => void;
};

/**
 * A task's sessions, open as soon as the task is: a summary of the time
 * planned before its deadline, past sessions dimmed, upcoming ones to show
 * on the calendar or remove, late ones flagged, and ways to add more.
 * Reading them never makes a plan.
 */
export function SessionsSection({
  item,
  canWrite,
  reloadKey,
  onFindTime,
  onShowOnCalendar,
  onDialogChange,
  onChanged,
  onError,
}: Props) {
  const [data, setData] = useState<ItemSessions | null>(null);
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState(false);
  const [adding, setAddingState] = useState(false);
  const setAdding = (open: boolean) => {
    setAddingState(open);
    onDialogChange?.(open);
  };
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    client.itemSessions(item.id).then(
      (d) => alive && setData(d),
      (e) => {
        if (!alive) return;
        setData(null);
        setError(errorText(e));
        if ((e as HttpError).status === 401) onError(e);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, reloadKey, tick]);

  const change = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError("");
    try {
      await fn();
      setTick((n) => n + 1);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
      if ((e as HttpError).status === 401) onError(e);
    } finally {
      setPending(false);
    }
  };

  const open = !isClosed(item.status);
  const canPlan = canWrite && open;
  const now = Date.now();
  const sessions = data?.sessions ?? [];
  const findLabel = data?.deadline_at
    ? "Find time before the deadline"
    : "Find time";

  const row = (b: TimeBlock) => {
    const past = Date.parse(b.end_at) <= now;
    const late = !!b.after_deadline;
    const label = `${rowDay(b.start_at)} · ${spanLabel(b.start_at, b.end_at)}`;
    return (
      <li
        key={b.id}
        className={past ? "is-past" : late ? "is-late" : undefined}
      >
        <span className="session-when">
          {label}
          {b.part ? ` · Session ${b.part}` : ""}
          {late && <strong> · After the deadline</strong>}
        </span>
        {!past && (
          <span className="session-actions">
            {onShowOnCalendar && (
              <button
                type="button"
                className="link-button"
                onClick={() => onShowOnCalendar(b.start_at)}
              >
                Show on calendar
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                className="link-button"
                disabled={pending}
                aria-label={`Remove the session on ${label}`}
                onClick={() => void change(() => client.deleteBlock(b.id))}
              >
                Remove
              </button>
            )}
          </span>
        )}
      </li>
    );
  };

  return (
    <section className="drawer-section" aria-labelledby="sessions-title">
      <div className="drawer-section-head sessions-head">
        <h3 id="sessions-title">
          <CalendarClock size={16} aria-hidden="true" /> Sessions
        </h3>
        {canPlan && (
          <span className="sessions-tools">
            {onFindTime && sessions.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => onFindTime(item)}
              >
                <Wand2 size={14} aria-hidden="true" /> {findLabel}
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => setAdding(true)}
            >
              <CalendarPlus size={14} aria-hidden="true" /> Add session…
            </button>
          </span>
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {data === null && !error ? (
        <p className="drawer-hint">Loading sessions…</p>
      ) : sessions.length ? (
        <>
          <p className="drawer-hint sessions-summary">
            {data && summary(data, item)}
            {!!data?.late_minutes && (
              <span className="chip chip-warn">
                {minutesLabel(data.late_minutes)} after the deadline
              </span>
            )}
          </p>
          <ul className="booked-list sessions-list">{sessions.map(row)}</ul>
        </>
      ) : (
        <div className="sessions-empty">
          <p className="drawer-hint">{emptyText(data, item)}</p>
          {canPlan && onFindTime && (
            <button
              type="button"
              className="primary"
              onClick={() => onFindTime(item)}
            >
              <Wand2 size={15} aria-hidden="true" /> {findLabel}
            </button>
          )}
        </div>
      )}
      {adding && (
        <BlockDialog
          heading="Add a session"
          subject={item.title}
          start={nextQuarter()}
          minutes={Math.min(item.estimate_minutes ?? 30, 1440)}
          onClose={() => setAdding(false)}
          onSave={(start, end) => {
            setAdding(false);
            void change(() =>
              client.createBlock({
                item_id: item.id,
                start_at: start.toISOString(),
                end_at: end.toISOString(),
              }),
            );
          }}
        />
      )}
    </section>
  );
}
