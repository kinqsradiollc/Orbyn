import {
  dateLabel,
  deadlineLine,
  describeRrule,
  isClosed,
  isLateSession,
  sessionCount,
  type CalendarEntry,
} from "@orbyn/core";
import {
  CalendarClock,
  Check,
  CircleCheck,
  Copy,
  Crosshair,
  ExternalLink,
  FastForward,
  Flag,
  Lock,
  MapPin,
  Pencil,
  Pin,
  RotateCcw,
  SkipForward,
  Trash2,
  Video,
  Wand2,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, Dialog, Field, IconButton, Input } from "../../ui/kit";
import { spanLabel, whenLabel } from "./format";
import { fieldTarget, joinable, type Picked } from "./model";
import type { Times } from "./useActions";

/** Things a detail panel can ask the screen to do. */
export type DetailActions = {
  canWriteEntry: (entry: CalendarEntry) => boolean;
  canWriteItem: (itemId: string, teamId?: string | null) => boolean;
  canComplete: (entry: CalendarEntry) => boolean;
  openItem: (itemId: string, entry?: CalendarEntry) => void;
  focus: (itemId: string) => void;
  complete: (itemId: string, repeating?: boolean) => void;
  reopen: (itemId: string) => void;
  skipOccurrence: (entry: CalendarEntry) => void;
  duplicate: (block: Extract<Picked, { kind: "block" }>["block"]) => void;
  reschedule: (block: Extract<Picked, { kind: "block" }>["block"]) => void;
  beforeDeadline: (block: Extract<Picked, { kind: "block" }>["block"]) => void;
  changeTime: (block: Extract<Picked, { kind: "block" }>["block"]) => void;
  removeBlock: (block: Extract<Picked, { kind: "block" }>["block"]) => void;
  editFrame: (frameId: string) => void;
  skipFrame: (frame: Extract<Picked, { kind: "frame" }>["frame"]) => void;
  checkInHabit: (
    habit: Extract<Picked, { kind: "habit" }>["habit"],
    outcome: "done" | "skipped" | null,
  ) => void;
  removeHabit: (habit: Extract<Picked, { kind: "habit" }>["habit"]) => void;
  changeGhost: (ghost: Extract<Picked, { kind: "ghost" }>["ghost"]) => void;
  removeGhost: (ghost: Extract<Picked, { kind: "ghost" }>["ghost"]) => void;
  ghostTunable: (ghost: Extract<Picked, { kind: "ghost" }>["ghost"]) => boolean;
  openField: (target: string, id: string) => void;
};

function Fact({
  icon,
  tone,
  children,
}: {
  icon?: ReactNode;
  tone?: "warn";
  children: ReactNode;
}) {
  return (
    <small className={`calendar-fact${tone ? " is-warn" : ""}`}>
      {icon}
      <span dir="auto">{children}</span>
    </small>
  );
}

function Act({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`calendar-act${danger ? " is-danger" : ""}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * One item's facts and what can be done with it. The flat views show this in
 * a popover and the 3D view docks it on the stage, so nothing is left behind
 * in either.
 */
export function Details({
  picked,
  tz,
  writeBusy,
  actions: a,
  onClose,
}: {
  picked: Picked;
  tz: string;
  writeBusy: boolean;
  actions: DetailActions;
  onClose: () => void;
}) {
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const head = (eyebrow: string | null, title: string) => (
    <div className="calendar-details-head">
      <div>
        {eyebrow && <small className="muted">{eyebrow}</small>}
        <h3 dir="auto">{title}</h3>
      </div>
      <IconButton label="Close" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  );

  if (picked.kind === "entry") {
    const e = picked.entry;
    const when = e.end_at
      ? `${whenLabel(e.start_at, tz)}, ${spanLabel(e.start_at, e.end_at, tz)}`
      : dateLabel(e.start_at);
    const canJoin = joinable(e);
    const later =
      !!e.meeting_url && !canJoin && Date.parse(e.start_at) > Date.now();
    const open = e.kind === "task" && !isClosed(e.status);
    const cancelled = e.kind === "task" && e.status === "cancelled";
    const canWrite = !writeBusy && a.canWriteEntry(e);
    return (
      <>
        {head(e.kind === "event" ? "Event" : "Task", e.title)}
        <Fact icon={<CalendarClock aria-hidden="true" />}>{when}</Fact>
        {e.location && (
          <Fact icon={<MapPin aria-hidden="true" />}>{e.location}</Fact>
        )}
        {e.rrule && <Fact>{describeRrule(e.rrule)}</Fact>}
        {e.team_name && <Fact>Shared with {e.team_name}</Fact>}
        {!!e.attendee_count && <Fact>{e.attendee_count} invited</Fact>}
        {cancelled && <Fact>Cancelled</Fact>}
        <div className="calendar-acts">
          {canJoin && (
            <a
              className="btn btn-primary"
              href={e.meeting_url}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
            >
              <Video aria-hidden="true" /> Join
            </a>
          )}
          {later && <Fact>Join opens 5 minutes before the start.</Fact>}
          <Act
            icon={<ExternalLink aria-hidden="true" />}
            onClick={run(() => a.openItem(e.item_id, e))}
          >
            Open details
          </Act>
          {cancelled && canWrite && (
            <Act
              icon={<RotateCcw aria-hidden="true" />}
              onClick={run(() => a.reopen(e.item_id))}
            >
              Reopen
            </Act>
          )}
          {!writeBusy && a.canComplete(e) && (
            <Act
              icon={<CircleCheck aria-hidden="true" />}
              onClick={run(() => a.complete(e.item_id, !!e.occurrence))}
            >
              {e.occurrence ? "Mark this one done" : "Mark done"}
            </Act>
          )}
          {open && (
            <Act
              icon={<Crosshair aria-hidden="true" />}
              onClick={run(() => a.focus(e.item_id))}
            >
              Start focus
            </Act>
          )}
          {e.occurrence && canWrite && (
            <Act
              icon={<SkipForward aria-hidden="true" />}
              onClick={run(() => a.skipOccurrence(e))}
            >
              Skip this occurrence
            </Act>
          )}
        </div>
      </>
    );
  }

  if (picked.kind === "block") {
    const b = picked.block;
    const open = !isClosed(b.status);
    const count = sessionCount(b);
    const deadline = deadlineLine(b);
    const late = open && isLateSession(b);
    const canWrite = !writeBusy && a.canWriteItem(b.item_id, b.team_id);
    return (
      <>
        {head("Session", b.title)}
        <Fact icon={<CalendarClock aria-hidden="true" />}>
          {whenLabel(b.start_at, tz)}, {spanLabel(b.start_at, b.end_at, tz)}
          {count && ` · ${count}`}
          {b.source === "planner" && " · from a plan"}
        </Fact>
        {deadline && (
          <Fact
            icon={<Flag aria-hidden="true" />}
            tone={late ? "warn" : undefined}
          >
            {deadline}
            {late && " · This session ends after it"}
          </Fact>
        )}
        <div className="calendar-acts">
          <Act
            icon={<ExternalLink aria-hidden="true" />}
            onClick={run(() => a.openItem(b.item_id))}
          >
            Open task
          </Act>
          {late && canWrite && (
            <Act
              icon={<Wand2 aria-hidden="true" />}
              onClick={run(() => a.beforeDeadline(b))}
            >
              Find time before deadline
            </Act>
          )}
          {open && (
            <Act
              icon={<Crosshair aria-hidden="true" />}
              onClick={run(() => a.focus(b.item_id))}
            >
              Start focus
            </Act>
          )}
          {open && canWrite && (
            <Act
              icon={<CircleCheck aria-hidden="true" />}
              onClick={run(() => a.complete(b.item_id))}
            >
              Mark task done
            </Act>
          )}
          {canWrite && (
            <Act
              icon={<CalendarClock aria-hidden="true" />}
              onClick={run(() => a.changeTime(b))}
            >
              Change time
            </Act>
          )}
          {open && canWrite && (
            <Act
              icon={<FastForward aria-hidden="true" />}
              onClick={run(() => a.reschedule(b))}
            >
              Move to next free time
            </Act>
          )}
          {open && canWrite && (
            <Act
              icon={<Copy aria-hidden="true" />}
              onClick={run(() => a.duplicate(b))}
            >
              Duplicate
            </Act>
          )}
          {canWrite && (
            <Act
              danger
              icon={<Trash2 aria-hidden="true" />}
              onClick={run(() => a.removeBlock(b))}
            >
              Delete session
            </Act>
          )}
        </div>
        {open && canWrite && (
          <Fact>Hold Alt or Option while dragging to copy a session.</Fact>
        )}
      </>
    );
  }

  if (picked.kind === "frame") {
    const f = picked.frame;
    return (
      <>
        {head("Frame", f.name)}
        <Fact icon={<CalendarClock aria-hidden="true" />}>
          {whenLabel(f.start_at, tz)}, {spanLabel(f.start_at, f.end_at, tz)}
        </Fact>
        <Fact>
          {f.busy
            ? "Busy: blocks booking pages and team suggestions."
            : "Free: others can still book this time."}
        </Fact>
        <div className="calendar-acts">
          <Act
            icon={<Pencil aria-hidden="true" />}
            onClick={run(() => a.editFrame(f.frame_id))}
          >
            Edit frame
          </Act>
          <Act
            icon={<SkipForward aria-hidden="true" />}
            onClick={run(() => a.skipFrame(f))}
          >
            Skip this day
          </Act>
        </div>
      </>
    );
  }

  if (picked.kind === "external") {
    const x = picked.event;
    const field = fieldTarget(x);
    const last = new Date(Date.parse(x.end_at) - 1).toISOString();
    const when = x.all_day
      ? `${whenLabel(x.start_at, tz)}${
          whenLabel(last, tz) !== whenLabel(x.start_at, tz)
            ? ` – ${whenLabel(last, tz)}`
            : ""
        } · all day`
      : `${whenLabel(x.start_at, tz)}, ${spanLabel(x.start_at, x.end_at, tz)}`;
    return (
      <>
        {head(x.name, x.title)}
        <Fact icon={<CalendarClock aria-hidden="true" />}>{when}</Fact>
        {x.location && (
          <Fact icon={<MapPin aria-hidden="true" />}>{x.location}</Fact>
        )}
        {field ? (
          <div className="calendar-acts">
            <Act
              icon={<ExternalLink aria-hidden="true" />}
              onClick={run(() => a.openField(field.target, field.id))}
            >
              Open {field.target}
            </Act>
          </div>
        ) : (
          <>
            <Fact icon={<Lock aria-hidden="true" />}>
              Read-only calendar.{" "}
              {x.busy ? "Counts as busy." : "Doesn't count as busy."}
            </Fact>
            <Fact>Edit it in the source calendar.</Fact>
          </>
        )}
      </>
    );
  }

  if (picked.kind === "habit") {
    const h = picked.habit;
    return (
      <>
        {head("Habit", h.name)}
        <Fact icon={<CalendarClock aria-hidden="true" />}>
          {whenLabel(h.start_at, tz)}, {spanLabel(h.start_at, h.end_at, tz)}
          {h.outcome && ` · ${h.outcome === "done" ? "Done" : "Skipped"}`}
        </Fact>
        <div className="calendar-acts">
          {h.outcome ? (
            <Act
              icon={<RotateCcw aria-hidden="true" />}
              onClick={run(() => a.checkInHabit(h, null))}
            >
              Undo check-in
            </Act>
          ) : (
            <>
              <Act
                icon={<Check aria-hidden="true" />}
                onClick={run(() => a.checkInHabit(h, "done"))}
              >
                Mark done
              </Act>
              <Act
                icon={<SkipForward aria-hidden="true" />}
                onClick={run(() => a.checkInHabit(h, "skipped"))}
              >
                Skip
              </Act>
            </>
          )}
          <Act
            danger
            icon={<Trash2 aria-hidden="true" />}
            onClick={run(() => a.removeHabit(h))}
          >
            Remove session
          </Act>
        </div>
      </>
    );
  }

  const g = picked.ghost;
  return (
    <>
      {head(g.pinned ? "Pinned in this plan" : "Proposed", g.title)}
      <Fact icon={<CalendarClock aria-hidden="true" />}>
        {whenLabel(g.start_at, tz)}, {spanLabel(g.start_at, g.end_at, tz)}
        {g.parts > 1 && ` · Session ${g.part} of ${g.parts}`}
      </Fact>
      {g.frame_name && <Fact>{g.frame_name}</Fact>}
      {a.ghostTunable(g) && (
        <div className="calendar-acts">
          <Act
            icon={<CalendarClock aria-hidden="true" />}
            onClick={run(() => a.changeGhost(g))}
          >
            Change time
          </Act>
          <Act
            danger
            icon={
              g.pinned ? <Pin aria-hidden="true" /> : <X aria-hidden="true" />
            }
            onClick={run(() => a.removeGhost(g))}
          >
            {g.pinned ? "Unpin session" : "Leave this task out"}
          </Act>
        </div>
      )}
    </>
  );
}

/** A small panel beside what opened it; a sheet on phones. */
export function Popover({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: DOMRect;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement,
  );
  const latest = useRef(onClose);
  latest.current = onClose;

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const size = node.getBoundingClientRect();
    const roomRight = anchor.right + 8 + size.width <= innerWidth - 8;
    const left = roomRight
      ? anchor.right + 8
      : Math.max(
          8,
          Math.min(anchor.left - size.width - 8, innerWidth - size.width - 8),
        );
    const top = Math.max(
      8,
      Math.min(anchor.top, innerHeight - size.height - 8),
    );
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.querySelector<HTMLElement>("button, a")?.focus();
  }, [anchor]);

  useEffect(() => {
    const previous = opener.current;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) latest.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        latest.current();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      ref={box}
      className="calendar-popover"
      role="dialog"
      aria-label={label}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Dragging a deadline can plan work without changing the deadline. */
export function DeadlineChoice({
  title,
  when,
  onPlan,
  onMove,
  onCancel,
}: {
  title: string;
  when: string;
  onPlan: () => void;
  onMove: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title="Plan a session or move the deadline?"
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onMove}>Move deadline</Button>
          <Button variant="primary" onClick={onPlan}>
            Plan a session
          </Button>
        </>
      }
    >
      <p dir="auto">{title}</p>
      <p className="muted">{when}</p>
    </Dialog>
  );
}

const toLocal = (date: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return parts.replace(" ", "T");
};

/** Pick a start and length: the keyboard way to place a session. */
export function TimeDialog({
  heading,
  subject,
  start,
  minutes,
  tz,
  busy,
  error,
  hint,
  minimumMinutes = 5,
  minuteStep = 5,
  fromLocal,
  onSave,
  onClose,
}: {
  heading: string;
  subject: string;
  start: Date;
  minutes: number;
  tz: string;
  busy?: boolean;
  error?: string;
  hint?: string;
  minimumMinutes?: number;
  minuteStep?: number;
  fromLocal: (value: string) => Date;
  onSave: (times: Times) => void;
  onClose: () => void;
}) {
  const [when, setWhen] = useState(() => toLocal(start, tz));
  const [length, setLength] = useState(String(minutes));
  const [problem, setProblem] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const duration = Number(length);
    if (
      !Number.isFinite(duration) ||
      duration < minimumMinutes ||
      duration > 1440
    ) {
      setProblem(`Use between ${minimumMinutes} and 1440 minutes.`);
      return;
    }
    if (!when) {
      setProblem("Pick a start.");
      return;
    }
    const from = fromLocal(when);
    onSave({
      start_at: from.toISOString(),
      end_at: new Date(from.getTime() + duration * 60_000).toISOString(),
    });
  };
  return (
    <Dialog title={heading} onClose={() => !busy && onClose()}>
      <form className="calendar-form" onSubmit={submit}>
        <p className="muted" dir="auto">
          {subject}
        </p>
        {hint && <p className="small muted">{hint}</p>}
        <Field label="Starts">
          <Input
            type="datetime-local"
            required
            autoFocus
            disabled={busy}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Length in minutes" error={problem || error}>
          <Input
            type="number"
            required
            min={minimumMinutes}
            max={1440}
            step={minuteStep}
            disabled={busy}
            value={length}
            onChange={(e) => setLength(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Save time
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
