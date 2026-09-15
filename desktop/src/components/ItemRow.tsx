import { ArrowUpRight, Check } from "lucide-react";
import { dateLabel, type Item } from "@orbyn/core";

type Props = {
  item: Item;
  busy: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
};

export function ItemRow({ item: i, busy, onToggle, onEdit }: Props) {
  return (
    <div className={"item-row " + (i.status === "done" ? "completed" : "")}>
      <button
        disabled={busy}
        className={"check " + (i.status === "done" ? "checked" : "")}
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
          {i.kind === "event" ? "Event" : i.notes || "Personal"}
          {i.due_at && " · " + dateLabel(i.due_at)}
        </span>
      </button>
      <span className={"priority " + i.priority}>{i.priority}</span>
      <button
        className="icon-button"
        aria-label={"Edit " + i.title}
        onClick={() => onEdit(i)}
      >
        <ArrowUpRight size={17} />
      </button>
    </div>
  );
}
