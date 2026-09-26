import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Hourglass,
  ListChecks,
  ListTree,
  Users,
} from "lucide-react";
import {
  dateLabel,
  isClosed,
  plannedLabel,
  rowFitChip,
  type Item,
} from "@orbyn/core";
import { usePlanned } from "../app/planned";
import { stagger } from "../lib/motion";
import { minutesLabel } from "../lib/planning";
import { startDrag } from "../lib/drag";
import { progressOf, stepsLabel, updatesLabel } from "../lib/tasks";
import { StatusPill } from "./StatusPill";
import { ProgressBar } from "./ProgressBar";
import { ItemFacts } from "./ItemFacts";
import "./tasks-w3.css";

type Props = {
  item: Item;
  busy: boolean;
  /** Viewers can open team items but not complete them. */
  readOnly?: boolean;
  /** Position in its list; staggers the entrance animation. */
  index?: number;
  /** Quick-complete / reopen (recorded in the task's timeline). */
  onToggle: (item: Item) => void;
  /** Opens the task detail panel. */
  onOpen: (item: Item) => void;
  /** The priority score, shown when the list is sorted by it. */
  score?: number | null;
  /** For a task with its subtasks listed under it: whether they're folded. */
  collapsed?: boolean;
  onToggleChildren?: () => void;
  /** Manual order: move it before or after its neighbour. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** The parent's title, for a subtask listed apart from its parent. */
  parentTitle?: string;
};

/**
 * One task or event: quick-complete, title and timing, status, progress with
 * checklist, subtask and update counts, and the time left. Clicking the row
 * opens the task panel.
 */
export function ItemRow({
  item: i,
  busy,
  readOnly,
  index = 0,
  onToggle,
  onOpen,
  score,
  collapsed,
  onToggleChildren,
  onMoveUp,
  onMoveDown,
  parentTitle,
}: Props) {
  const done = i.status === "done";
  // Items already done when the row mounts don't pop; completing one does.
  const doneAtMount = useRef(done);
  useEffect(() => {
    if (!done) doneAtMount.current = false;
  }, [done]);
  const steps = stepsLabel(i);
  const updates = updatesLabel(i);
  const showProgress = i.kind === "task" || !!i.steps_total;
  const subtasks = i.child_count
    ? `${i.children_done ?? 0} of ${i.child_count} subtasks`
    : null;
  const left =
    i.kind === "task" && !isClosed(i.status) && i.remaining_minutes != null
      ? `${minutesLabel(i.remaining_minutes)} left`
      : null;
  // "Planned 9:15" for a session today, and the task's status only within a
  // week of its deadline or with a session after it.
  const planned = usePlanned().byItem.get(i.id);
  const open = i.kind === "task" && !isClosed(i.status);
  const plannedToday = open ? plannedLabel(planned) : null;
  const fitChip = open ? rowFitChip(planned?.fit) : null;
  return (
    <div
      className={
        `item-row tone-${i.status} fade-up stagger ` + (done ? "completed" : "")
      }
      style={stagger(index)}
      // Picked up, a task plans a session on a calendar day or links into
      // a page (ORG-06); its menus do the same without a mouse.
      draggable
      onDragStart={(e) =>
        startDrag(e, {
          kind: "task",
          id: i.id,
          title: i.title,
          event: i.kind === "event",
        })
      }
    >
      {onToggleChildren && (
        <button
          className="icon-button row-fold"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Show" : "Hide"} the subtasks of ${i.title}`}
          onClick={onToggleChildren}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
      )}
      <button
        disabled={busy || readOnly}
        className={
          "check " +
          (done ? "checked " : "") +
          (doneAtMount.current ? "" : "can-pop")
        }
        aria-label={done ? "Reopen " + i.title : "Complete " + i.title}
        title={readOnly ? "View only" : done ? "Reopen" : "Mark done"}
        onClick={() => onToggle(i)}
      >
        {done && <Check size={13} />}
      </button>
      <button
        className="item-main"
        onClick={() => onOpen(i)}
        aria-label={`Open ${i.title}${parentTitle ? `, a subtask of ${parentTitle}` : ""}`}
      >
        {parentTitle && (
          <span className="row-parent" aria-hidden="true">
            ↳ {parentTitle}
          </span>
        )}
        <strong>{i.title}</strong>
        <span className="item-meta">
          {i.kind === "event"
            ? "Event"
            : i.notes || (i.team_id ? "Team plan" : "Personal")}
          {i.due_at && " · " + dateLabel(i.due_at)}
        </span>
        {(plannedToday || fitChip) && (
          <span className="item-plan">
            {plannedToday && (
              <span className="plan-chip is-accent">{plannedToday}</span>
            )}
            {fitChip && (
              <span className={`plan-chip is-${fitChip.tone}`}>
                {fitChip.text}
              </span>
            )}
          </span>
        )}
        {(showProgress || steps || updates || subtasks || left) && (
          <span className="item-progress-line">
            {showProgress && (
              <ProgressBar
                value={progressOf(i)}
                status={i.status}
                label={`Progress on ${i.title}`}
              />
            )}
            {steps && (
              <span className="item-fact">
                <ListChecks size={12} aria-hidden="true" />
                {steps}
              </span>
            )}
            {subtasks && (
              <span className="item-fact">
                <ListTree size={12} aria-hidden="true" />
                {subtasks}
              </span>
            )}
            {left && (
              <span className="item-fact">
                <Hourglass size={12} aria-hidden="true" />
                {left}
              </span>
            )}
            {updates && <span className="item-fact">{updates}</span>}
          </span>
        )}
        <ItemFacts item={i} />
      </button>
      <span className="item-tags">
        {i.team_id && i.team_name && (
          <span className="team-badge" title={"Shared with " + i.team_name}>
            <Users size={11} />
            {i.team_name}
          </span>
        )}
        {score != null && (
          <span className="item-score" title="Priority score">
            {score.toFixed(1)}
          </span>
        )}
        <StatusPill status={i.status} />
        <span className={"priority " + i.priority}>{i.priority}</span>
      </span>
      {(onMoveUp || onMoveDown) && (
        <span className="row-move">
          <button
            className="icon-button"
            aria-label={`Move ${i.title} up`}
            title="Move up"
            disabled={!onMoveUp || busy}
            onClick={onMoveUp}
          >
            <ArrowUp size={13} />
          </button>
          <button
            className="icon-button"
            aria-label={`Move ${i.title} down`}
            title="Move down"
            disabled={!onMoveDown || busy}
            onClick={onMoveDown}
          >
            <ArrowDown size={13} />
          </button>
        </span>
      )}
      <ChevronRight size={16} className="item-chevron" aria-hidden="true" />
    </div>
  );
}
