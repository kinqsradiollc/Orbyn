import { useEffect, useRef } from "react";
import { Check, ChevronRight, ListChecks, Users } from "lucide-react";
import { dateLabel, type Item } from "@orbyn/core";
import { stagger } from "../lib/motion";
import { progressOf, stepsLabel, updatesLabel } from "../lib/tasks";
import { StatusPill } from "./StatusPill";
import { ProgressBar } from "./ProgressBar";

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
};

/**
 * One task or event: quick-complete, title and timing, status, progress with
 * checklist and update counts. Clicking the row opens the task panel.
 */
export function ItemRow({
  item: i,
  busy,
  readOnly,
  index = 0,
  onToggle,
  onOpen,
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
  return (
    <div
      className={
        `item-row tone-${i.status} fade-up stagger ` + (done ? "completed" : "")
      }
      style={stagger(index)}
    >
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
        aria-label={`Open ${i.title}`}
      >
        <strong>{i.title}</strong>
        <span className="item-meta">
          {i.kind === "event"
            ? "Event"
            : i.notes || (i.team_id ? "Team plan" : "Personal")}
          {i.due_at && " · " + dateLabel(i.due_at)}
        </span>
        {(showProgress || steps || updates) && (
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
            {updates && <span className="item-fact">{updates}</span>}
          </span>
        )}
      </button>
      <span className="item-tags">
        {i.team_id && i.team_name && (
          <span className="team-badge" title={"Shared with " + i.team_name}>
            <Users size={11} />
            {i.team_name}
          </span>
        )}
        <StatusPill status={i.status} />
        <span className={"priority " + i.priority}>{i.priority}</span>
      </span>
      <ChevronRight size={16} className="item-chevron" aria-hidden="true" />
    </div>
  );
}
