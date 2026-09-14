import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, Users } from "lucide-react";
import { dateLabel, type Item } from "@orbyn/core";
import { stagger } from "../lib/motion";

type Props = {
  item: Item;
  busy: boolean;
  /** Viewers can open team items but not complete them. */
  readOnly?: boolean;
  /** Position in its list; staggers the entrance animation. */
  index?: number;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
};

export function ItemRow({
  item: i,
  busy,
  readOnly,
  index = 0,
  onToggle,
  onEdit,
}: Props) {
  const done = i.status === "done";
  // Items already done when the row mounts don't pop; completing one does.
  const doneAtMount = useRef(done);
  useEffect(() => {
    if (!done) doneAtMount.current = false;
  }, [done]);
  return (
    <div
      className={"item-row fade-up stagger " + (done ? "completed" : "")}
      style={stagger(index)}
    >
      <button
        disabled={busy || readOnly}
        className={
          "check " +
          (done ? "checked " : "") +
          (doneAtMount.current ? "" : "can-pop")
        }
        aria-label={
          i.status === "done" ? "Reopen " + i.title : "Complete " + i.title
        }
        onClick={() => onToggle(i)}
      >
        {i.status === "done" && <Check size={13} />}
      </button>
      <button className="item-main" onClick={() => onEdit(i)}>
        <strong>{i.title}</strong>
        <span>
          {i.kind === "event"
            ? "Event"
            : i.notes || (i.team_id ? "Team plan" : "Personal")}
          {i.due_at && " · " + dateLabel(i.due_at)}
        </span>
      </button>
      {i.team_id && i.team_name && (
        <span className="team-badge" title={"Shared with " + i.team_name}>
          <Users size={11} />
          {i.team_name}
        </span>
      )}
      <span className={"priority " + i.priority}>{i.priority}</span>
      <button
        className="icon-button"
        aria-label={(readOnly ? "View " : "Edit ") + i.title}
        onClick={() => onEdit(i)}
      >
        <ArrowUpRight size={17} />
      </button>
    </div>
  );
}
