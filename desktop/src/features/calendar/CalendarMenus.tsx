import {
  CalendarClock,
  Crosshair,
  ExternalLink,
  MapPin,
  Pencil,
  SkipForward,
  Trash2,
  Video,
} from "lucide-react";
import {
  dateLabel,
  describeRrule,
  type CalendarEntry,
  type TimeBlock,
} from "@orbyn/core";
import { Popover } from "../../components/Popover";
import { joinable, spanLabel } from "../../lib/planning";

type EntryProps = {
  entry: CalendarEntry;
  anchor: DOMRect;
  /** False for team items you can only view. */
  canWrite: boolean;
  onClose: () => void;
  onOpen: () => void;
  onEditSeries: () => void;
  onSkip: () => void;
  onFocus: () => void;
};

/** What you can do with an event or dated task on the calendar. */
export function EntryMenu({
  entry: e,
  anchor,
  canWrite,
  onClose,
  onOpen,
  onEditSeries,
  onSkip,
  onFocus,
}: EntryProps) {
  const when = e.end_at
    ? `${new Date(e.start_at).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}, ${spanLabel(e.start_at, e.end_at)}`
    : dateLabel(e.start_at);
  const canJoin = joinable(e);
  const later =
    !!e.meeting_url && !canJoin && Date.parse(e.start_at) > Date.now();
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
        {e.kind === "task" && e.status !== "done" && (
          <button onClick={act(onFocus)}>
            <Crosshair size={14} /> Start focus
          </button>
        )}
        {e.occurrence && canWrite && (
          <>
            <button onClick={act(onEditSeries)}>
              <Pencil size={14} /> Edit the series
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
  onClose: () => void;
  onOpen: () => void;
  onFocus: () => void;
  onChangeTime: () => void;
  onDelete: () => void;
};

/** A time block's menu: open its task, focus, change the time, or delete it. */
export function BlockMenu({
  block: b,
  anchor,
  onClose,
  onOpen,
  onFocus,
  onChangeTime,
  onDelete,
}: BlockProps) {
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Popover anchor={anchor} label={`Time for ${b.title}`} onClose={onClose}>
      <div className="popover-head">
        <small className="eyebrow">TIME BLOCK</small>
        <strong>{b.title}</strong>
        <small>
          <CalendarClock size={12} aria-hidden="true" />{" "}
          {new Date(b.start_at).toLocaleDateString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
          , {spanLabel(b.start_at, b.end_at)}
          {b.source === "planner" && " · from a plan"}
        </small>
      </div>
      <div className="popover-actions">
        <button onClick={act(onOpen)}>
          <ExternalLink size={14} /> Open task
        </button>
        {b.status !== "done" && (
          <button onClick={act(onFocus)}>
            <Crosshair size={14} /> Start focus
          </button>
        )}
        <button onClick={act(onChangeTime)}>
          <CalendarClock size={14} /> Change time…
        </button>
        <button className="is-danger" onClick={act(onDelete)}>
          <Trash2 size={14} /> Delete block
        </button>
      </div>
    </Popover>
  );
}
