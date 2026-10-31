import {
  isClosed,
  measureLabel,
  plannedLabel,
  rowFitChip,
  statusLabels,
  describeRrule,
  type Item,
  type Priority,
  type Status,
} from "@orbyn/core";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ListChecks,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  Repeat,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import { memo } from "react";
import { IconButton, Menu, Pill, useConfirm } from "../../ui/kit";
import {
  isOverdue,
  minutesLabel,
  progressOf,
  shortDue,
  timeAgo,
  timeFact,
} from "./format";
import { tasks } from "./host-store";
import { useTaskActions, usePlanning } from "./store";

const dayAt = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
};

/** The one menu of quick changes for a task, on rows and board cards. */
export function ItemMenu({ item, label }: { item: Item; label?: string }) {
  const { setStatus, change, remove } = useTaskActions();
  const confirm = useConfirm();
  const status = (next: Status, close: () => void) => {
    close();
    void setStatus(item, next);
  };
  const priority = (next: Priority, close: () => void) => {
    close();
    void change(item, { priority: next });
  };
  const due = (days: number | null, close: () => void) => {
    close();
    void change(item, {
      due_at: days === null ? null : dayAt(days),
      end_at: null,
      all_day: false,
    });
  };
  return (
    <Menu
      label={`Options for ${item.title}`}
      trigger={(open, expanded) => (
        <IconButton
          className="st-row-more"
          label={label ?? `Options for ${item.title}`}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          <MoreHorizontal />
        </IconButton>
      )}
    >
      {(close) => (
        <>
          {(["in_progress", "blocked", "todo"] as Status[])
            .filter((s) => s !== item.status)
            .map((s) => (
              <button key={s} onClick={() => status(s, close)}>
                {s === "todo"
                  ? "Move to To do"
                  : `Mark ${statusLabels[s].toLowerCase()}`}
              </button>
            ))}
          <hr />
          {(["high", "medium", "low"] as Priority[])
            .filter((p) => p !== item.priority)
            .map((p) => (
              <button key={p} onClick={() => priority(p, close)}>
                {p[0].toUpperCase() + p.slice(1)} priority
              </button>
            ))}
          {!item.rrule && item.kind === "task" && (
            <>
              <hr />
              <button onClick={() => due(0, close)}>Due today</button>
              <button onClick={() => due(1, close)}>Due tomorrow</button>
              <button onClick={() => due(7, close)}>Due in a week</button>
              {item.due_at && (
                <button onClick={() => due(null, close)}>No date</button>
              )}
            </>
          )}
          <hr />
          <button
            className="is-danger"
            onClick={() => {
              close();
              if (item.rrule) return tasks.open(item);
              void confirm({
                title: `Delete “${item.title}”?`,
                body: "You can undo this for a few seconds.",
                action: "Delete",
                danger: true,
              }).then((yes) => yes && remove(item));
            }}
          >
            <Trash2 aria-hidden="true" /> Delete
          </button>
        </>
      )}
    </Menu>
  );
}

const updatesText = (item: Item) => {
  const count = `${item.updates_count} ${item.updates_count === 1 ? "update" : "updates"}`;
  return item.last_update_at
    ? `Updated ${timeAgo(item.last_update_at)} · ${count}`
    : count;
};

export type TaskRowProps = {
  item: Item;
  readOnly?: boolean;
  /** The parent's title, for a subtask listed apart from its parent. */
  parentTitle?: string;
  score?: number | null;
  /** Subtasks under this row: whether they are folded. */
  collapsed?: boolean;
  onToggleChildren?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Selecting rows: the left control picks instead of completing. */
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (event: { shiftKey: boolean }) => void;
  /** Keyboard cursor in the list. */
  cursor?: boolean;
  /** Open it another way than the task panel. */
  onOpen?: (item: Item) => void;
};

/**
 * One line for one task: complete it, read it, change it. Facts sit in fixed
 * columns so a list scans straight down, and only what differs from the
 * usual case shows (a status other than To do, a priority other than Medium).
 */
export const TaskRow = memo(function TaskRow({
  item,
  readOnly,
  parentTitle,
  score,
  collapsed,
  onToggleChildren,
  onMoveUp,
  onMoveDown,
  selecting,
  selected,
  onSelect,
  cursor,
  onOpen,
}: TaskRowProps) {
  const { toggle } = useTaskActions();
  const { listById, tagById, plannedById } = usePlanning();
  const done = item.status === "done";
  const closed = isClosed(item.status);
  const list = item.list_id ? listById.get(item.list_id) : undefined;
  const tags = (item.tag_ids ?? [])
    .map((id) => tagById.get(id))
    .filter((t) => !!t);
  const planned = plannedById.get(item.id);
  const open = item.kind === "task" && !closed;
  const plannedText = open ? plannedLabel(planned) : null;
  const fit = open ? rowFitChip(planned?.fit) : null;
  const progress = progressOf(item);
  const showProgress = !closed && progress > 0 && progress < 100;
  const late = isOverdue(item);
  const left =
    open && item.remaining_minutes != null
      ? `${minutesLabel(item.remaining_minutes)} left`
      : null;
  const time = left ? null : timeFact(item);
  const repeat = describeRrule(item.rrule);
  const measure = measureLabel(item);
  const place = list?.name ?? item.team_name ?? "";
  const whereTitle = [
    list?.name,
    item.team_name,
    ...tags.map((tag) => tag.name),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={`st-row${closed ? " is-closed" : ""}${selected ? " is-selected" : ""}${cursor ? " is-cursor" : ""}`}
      data-item={item.id}
    >
      {onToggleChildren ? (
        <button
          type="button"
          className="st-fold"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Show" : "Hide"} the subtasks of ${item.title}`}
          onClick={onToggleChildren}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </button>
      ) : (
        <span className="st-fold" aria-hidden="true" />
      )}
      {selecting ? (
        <label className="st-pick">
          <input
            type="checkbox"
            aria-label={`Select ${item.title}`}
            checked={!!selected}
            onChange={() => undefined}
            onClick={(event) => onSelect?.({ shiftKey: event.shiftKey })}
          />
        </label>
      ) : (
        <button
          type="button"
          className={`st-check${item.kind === "event" ? " is-event" : ""}`}
          aria-pressed={done}
          aria-label={done ? `Reopen ${item.title}` : `Complete ${item.title}`}
          title={readOnly ? "View only" : done ? "Reopen" : "Mark done"}
          disabled={readOnly}
          onClick={() => void toggle(item)}
        >
          {done && <Check aria-hidden="true" />}
        </button>
      )}
      <button
        type="button"
        className="st-row-main"
        aria-label={`Open ${item.title}${parentTitle ? `, a subtask of ${parentTitle}` : ""}`}
        onClick={(event) => {
          if (
            onSelect &&
            (selecting || event.metaKey || event.ctrlKey || event.shiftKey)
          )
            return onSelect({ shiftKey: event.shiftKey });
          if (onOpen) onOpen(item);
          else tasks.open(item);
        }}
      >
        <span className="st-row-title">
          {parentTitle && (
            <span className="st-row-parent" dir="auto">
              {parentTitle} ›
            </span>
          )}
          <span className="st-row-name" dir="auto">
            {item.title}
          </span>
          {item.kind === "event" && <span className="st-fact">Event</span>}
          {!!item.steps_total && (
            <span
              className="st-fact"
              title={`${item.steps_done ?? 0} of ${item.steps_total} steps`}
            >
              <ListChecks aria-hidden="true" />
              {item.steps_done ?? 0}/{item.steps_total}
            </span>
          )}
          {!!item.child_count && (
            <span
              className="st-fact"
              title={`${item.children_done ?? 0} of ${item.child_count} subtasks`}
            >
              <ListTree aria-hidden="true" />
              {item.children_done ?? 0}/{item.child_count}
            </span>
          )}
          {!!item.updates_count && (
            <span className="st-fact" title={updatesText(item)}>
              <MessageSquare aria-hidden="true" />
              {item.updates_count}
            </span>
          )}
          {repeat && (
            <span className="st-fact" title={repeat}>
              <Repeat aria-hidden="true" />
              <span className="sr-only">{repeat}</span>
            </span>
          )}
          {measure && (
            <span className="st-fact" title="Number to reach">
              <Target aria-hidden="true" />
              {measure}
            </span>
          )}
        </span>
        <span className="st-row-signals">
          {item.status === "in_progress" && (
            <Pill tone="blue">
              In progress
              {showProgress && !item.steps_total ? ` · ${progress}%` : ""}
            </Pill>
          )}
          {item.status === "blocked" && <Pill tone="red">Blocked</Pill>}
          {item.status === "cancelled" && <Pill>Cancelled</Pill>}
          {fit && (
            <Pill tone={fit.tone === "warn" ? "amber" : undefined}>
              {fit.text}
            </Pill>
          )}
          {plannedText && <Pill tone="blue">{plannedText}</Pill>}
        </span>
        <span className="st-col st-col-time">{left ?? time}</span>
        <span className="st-col st-col-where" title={whereTitle}>
          {place && (
            <>
              {list ? (
                <i style={{ background: list.color }} aria-hidden="true" />
              ) : (
                <Users aria-hidden="true" />
              )}
              <span className="st-clip" dir="auto">
                {place}
              </span>
            </>
          )}
          {tags.slice(0, 3).map((tag) => (
            <i
              key={tag.id}
              style={{ background: tag.color }}
              aria-hidden="true"
            />
          ))}
          <span className="sr-only">
            {tags.map((tag) => tag.name).join(", ")}
          </span>
        </span>
        <span
          className="st-col st-col-who"
          title={item.assignee_name ?? undefined}
        >
          {item.assignee_name && (
            <>
              <span className="st-mini-avatar" aria-hidden="true">
                {item.assignee_name.trim()[0]?.toUpperCase()}
              </span>
              <span className="sr-only">Assigned to {item.assignee_name}</span>
            </>
          )}
        </span>
        <span
          className="st-col st-col-priority"
          title={
            score != null ? `Priority score ${score.toFixed(1)}` : undefined
          }
        >
          {item.priority === "high" && <Pill tone="amber">High</Pill>}
          {item.priority === "low" && "Low"}
        </span>
        <span className={`st-row-due${late ? " is-late" : ""}`}>
          {shortDue(item)}
        </span>
      </button>
      {(onMoveUp || onMoveDown) && (
        <span className="st-row-move">
          <IconButton
            label={`Move ${item.title} up`}
            disabled={!onMoveUp || readOnly}
            onClick={onMoveUp}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            label={`Move ${item.title} down`}
            disabled={!onMoveDown || readOnly}
            onClick={onMoveDown}
          >
            <ArrowDown />
          </IconButton>
        </span>
      )}
      {!readOnly && !selecting && <ItemMenu item={item} />}
    </div>
  );
});
