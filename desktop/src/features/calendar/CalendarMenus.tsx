import {
  CalendarClock,
  CircleCheck,
  Copy,
  Crosshair,
  ExternalLink,
  FastForward,
  Flag,
  Lock,
  MapPin,
  Pencil,
  RotateCcw,
  SkipForward,
  Trash2,
  Video,
  Wand2,
} from "lucide-react";
import {
  dateLabel,
  deadlineLine,
  describeRrule,
  isClosed,
  sessionCount,
  type CalendarEntry,
  type ExternalEntry,
  type FrameOccurrence,
  type TimeBlock,
} from "@orbyn/core";
import { Popover } from "../../components/Popover";
import { joinable, spanLabel } from "../../lib/planning";

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

type EntryProps = {
  entry: CalendarEntry;
  anchor: DOMRect;
  /** False for team items you can only view. */
  canWrite: boolean;
  /**
   * An open task you can change. For a repeating task, only its current
   * occurrence (finishing it moves the task to the next one).
   */
  canComplete: boolean;
  onClose: () => void;
  onOpen: () => void;
  onEditSeries: () => void;
  onSkip: () => void;
  onFocus: () => void;
  /** Marks the task done. */
  onComplete: () => void;
  /** Brings a cancelled task back. */
  onReopen: () => void;
};

/** What you can do with an event or dated task on the calendar. */
export function EntryMenu({
  entry: e,
  anchor,
  canWrite,
  canComplete,
  onClose,
  onOpen,
  onEditSeries,
  onSkip,
  onFocus,
  onComplete,
  onReopen,
}: EntryProps) {
  const when = e.end_at
    ? `${shortDay(e.start_at)}, ${spanLabel(e.start_at, e.end_at)}`
    : dateLabel(e.start_at);
  const canJoin = joinable(e);
  const later =
    !!e.meeting_url && !canJoin && Date.parse(e.start_at) > Date.now();
  const open = e.kind === "task" && !isClosed(e.status);
  const cancelled = e.kind === "task" && e.status === "cancelled";
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Popover anchor={anchor} label={e.title} onClose={onClose}>
      <div className="popover-head">
        <strong>{e.title}</strong>
        <small>
          <CalendarClock size={12} aria-hidden="true" /> {when}
        </small>
        {e.location && (
          <small>
            <MapPin size={12} aria-hidden="true" /> {e.location}
          </small>
        )}
        {e.rrule && <small>{describeRrule(e.rrule)}</small>}
        {e.team_name && <small>Shared with {e.team_name}</small>}
        {cancelled && <small className="eyebrow">CANCELLED</small>}
      </div>
      <div className="popover-actions">
        {canJoin && (
          <a
            className="primary"
            href={e.meeting_url}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            <Video size={14} /> Join
          </a>
        )}
        {later && (
          <small className="popover-note">
            Join opens 5 minutes before it starts.
          </small>
        )}
        <button onClick={act(onOpen)}>
          <ExternalLink size={14} /> Open details
        </button>
        {cancelled && canWrite && (
          <button onClick={act(onReopen)}>
            <RotateCcw size={14} /> Reopen
          </button>
        )}
        {canComplete && (
          <button onClick={act(onComplete)}>
            <CircleCheck size={14} />{" "}
            {e.occurrence ? "Mark this one done" : "Mark done"}
          </button>
        )}
        {open && (
          <button onClick={act(onFocus)}>
            <Crosshair size={14} /> Start focus
          </button>
        )}
        {e.occurrence && canWrite && (
          <>
            <button onClick={act(onEditSeries)}>
              <Pencil size={14} /> Edit…
            </button>
            <button onClick={act(onSkip)}>
              <SkipForward size={14} /> Skip this occurrence
            </button>
          </>
        )}
      </div>
    </Popover>
  );
}

type BlockProps = {
  block: TimeBlock;
  anchor: DOMRect;
  /** False when the block's task is a team item you can only view. */
  canWrite: boolean;
  onClose: () => void;
  onOpen: () => void;
  onFocus: () => void;
  /** Marks the block's task done. */
  onComplete: () => void;
  /** Another block for the same task at the next free time. */
  onDuplicate: () => void;
  /** Move it to the next free working time of the same length. */
  onReschedule: () => void;
  onChangeTime: () => void;
  onDelete: () => void;
  /** Move it to free time before its deadline (offered on late sessions). */
  onFindTime?: () => void;
};

/**
 * A session's menu: what it is (its number, its task's deadline), then open
 * its task, find time before the deadline when it's late, focus, finish,
 * move, copy or delete it.
 */
export function BlockMenu({
  block: b,
  anchor,
  canWrite,
  onClose,
  onOpen,
  onFocus,
  onComplete,
  onDuplicate,
  onReschedule,
  onChangeTime,
  onDelete,
  onFindTime,
}: BlockProps) {
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const open = !isClosed(b.status);
  const count = sessionCount(b);
  const deadline = deadlineLine(b);
  const late = open && !!b.after_deadline;
  return (
    <Popover anchor={anchor} label={`Session for ${b.title}`} onClose={onClose}>
      <div className="popover-head">
        <small className="eyebrow">SESSION</small>
        <strong>{b.title}</strong>
        <small>
          <CalendarClock size={12} aria-hidden="true" /> {shortDay(b.start_at)},{" "}
          {spanLabel(b.start_at, b.end_at)}
          {count && ` · ${count}`}
          {b.source === "planner" && " · from a plan"}
        </small>
        {deadline && (
          <small className={late ? "popover-warn" : undefined}>
            <Flag size={12} aria-hidden="true" /> {deadline}
            {late && " · This session ends after it"}
          </small>
        )}
      </div>
      <div className="popover-actions">
        <button onClick={act(onOpen)}>
          <ExternalLink size={14} /> Open task
        </button>
        {late && canWrite && onFindTime && (
          <button onClick={act(onFindTime)}>
            <Wand2 size={14} /> Find time before the deadline
          </button>
        )}
        {open && (
          <button onClick={act(onFocus)}>
            <Crosshair size={14} /> Start focus
          </button>
        )}
        {open && canWrite && (
          <button onClick={act(onComplete)}>
            <CircleCheck size={14} /> Mark task done
          </button>
        )}
        <button onClick={act(onChangeTime)}>
          <CalendarClock size={14} /> Change time…
        </button>
        {open && (
          <button onClick={act(onReschedule)}>
            <FastForward size={14} /> Move to next free time
          </button>
        )}
        {open && (
          <button onClick={act(onDuplicate)}>
            <Copy size={14} /> Duplicate
          </button>
        )}
        <button className="is-danger" onClick={act(onDelete)}>
          <Trash2 size={14} /> Delete session
        </button>
        {open && (
          <small className="popover-note">
            Tip: hold Alt (Option on a Mac) while dragging to copy a session.
          </small>
        )}
      </div>
    </Popover>
  );
}

type FrameProps = {
  frame: FrameOccurrence;
  anchor: DOMRect;
  onClose: () => void;
  onEdit: () => void;
  onSkip: () => void;
};

/** A frame on the calendar: edit it, or skip this day. */
export function FrameMenu({
  frame: f,
  anchor,
  onClose,
  onEdit,
  onSkip,
}: FrameProps) {
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Popover anchor={anchor} label={`${f.name} frame`} onClose={onClose}>
      <div className="popover-head">
        <small className="eyebrow">FRAME</small>
        <strong>{f.name}</strong>
        <small>
          <CalendarClock size={12} aria-hidden="true" /> {shortDay(f.start_at)},{" "}
          {spanLabel(f.start_at, f.end_at)}
        </small>
        <small>
          {f.busy
            ? "Busy: blocks booking pages and team suggestions."
            : "Free: others can still book this time."}
        </small>
      </div>
      <div className="popover-actions">
        <button onClick={act(onEdit)}>
          <Pencil size={14} /> Edit frame…
        </button>
        <button onClick={act(onSkip)}>
          <SkipForward size={14} /> Skip this day
        </button>
      </div>
    </Popover>
  );
}

/** An event from a subscribed calendar: its details, read-only. */
export function ExternalMenu({
  event: x,
  anchor,
  onClose,
}: {
  event: ExternalEntry;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const last = new Date(Date.parse(x.end_at) - 1).toISOString();
  const when = x.all_day
    ? shortDay(x.start_at) +
      (shortDay(last) !== shortDay(x.start_at) ? ` – ${shortDay(last)}` : "") +
      " · all day"
    : `${shortDay(x.start_at)}, ${spanLabel(x.start_at, x.end_at)}`;
  return (
    <Popover anchor={anchor} label={x.title} onClose={onClose}>
      <div className="popover-head">
        <small className="eyebrow">{x.name.toUpperCase()}</small>
        <strong>{x.title}</strong>
        <small>
          <CalendarClock size={12} aria-hidden="true" /> {when}
        </small>
        {x.location && (
          <small>
            <MapPin size={12} aria-hidden="true" /> {x.location}
          </small>
        )}
        <small>
          <Lock size={12} aria-hidden="true" /> Read-only, from a subscribed
          calendar. {x.busy ? "Counts as busy." : "Doesn't count as busy."}
        </small>
      </div>
      <div className="popover-actions">
        <small className="popover-note">
          Change it in the app it comes from.
        </small>
      </div>
    </Popover>
  );
}
