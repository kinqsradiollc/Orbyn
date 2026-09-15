import { Repeat, Timer, UserRound } from "lucide-react";
import { describeRrule, type Item } from "@orbyn/core";
import { usePlanning } from "../app/planning";
import { minutesLabel } from "../lib/planning";

type Props = {
  item: Item;
  /** Leave out tags (for tight spaces). */
  hideTags?: boolean;
  className?: string;
};

/** "30 min · 10 min spent", list, repeat, assignee and tags for a task. */
export function timeFact(i: Item) {
  const spent = i.spent_minutes ?? 0;
  if (!i.estimate_minutes && !spent) return null;
  if (!i.estimate_minutes) return `${minutesLabel(spent)} spent`;
  return spent
    ? `${minutesLabel(spent)} of ${minutesLabel(i.estimate_minutes)}`
    : minutesLabel(i.estimate_minutes);
}

export function ItemFacts({ item: i, hideTags, className = "" }: Props) {
  const { listById, tagById } = usePlanning();
  const list = i.list_id ? listById.get(i.list_id) : undefined;
  const tags = hideTags
    ? []
    : (i.tag_ids ?? []).map((id) => tagById.get(id)).filter((t) => !!t);
  const time = timeFact(i);
  const repeat = describeRrule(i.rrule);
  if (!time && !list && !repeat && !i.assignee_name && !tags.length)
    return null;
  return (
    <span className={"item-facts " + className}>
      {time && (
        <span className="item-fact" title="Time: spent of estimate">
          <Timer size={12} aria-hidden="true" />
          <span className="sr-only">Time: </span>
          {time}
        </span>
      )}
      {list && (
        <span className="item-fact">
          <i
            className="list-dot"
            style={{ background: list.color }}
            aria-hidden="true"
          />
          <span className="sr-only">List: </span>
          {list.name}
        </span>
      )}
      {repeat && (
        <span className="item-fact">
          <Repeat size={12} aria-hidden="true" />
          {repeat}
        </span>
      )}
      {i.assignee_name && (
        <span className="item-fact">
          <UserRound size={12} aria-hidden="true" />
          <span className="sr-only">Assigned to </span>
          {i.assignee_name}
        </span>
      )}
      {tags.map((t) => (
        <span
          key={t.id}
          className="tag-chip"
          style={{ "--tag": t.color } as never}
        >
          <i aria-hidden="true" />
          {t.name}
        </span>
      ))}
    </span>
  );
}
