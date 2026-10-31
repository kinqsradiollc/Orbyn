import {
  agentStateText,
  durationText,
  isAgentLane,
  isClosed,
  OWNER_AGENT,
  OWNER_REVIEW,
  statusLabels,
  type BoardGroupBy,
  type Item,
  type ReviewItem,
  type TaskGroup,
} from "@orbyn/core";
import {
  ArrowRightLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  ListChecks,
  MessageSquare,
  Plus,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { IconButton, Menu, Pill } from "../../ui/kit";
import {
  isOverdue,
  ItemMenu,
  progressOf,
  shortDue,
  tasks,
} from "../shared-task";

const CARD = "application/x-orbyn-card";

type Props = {
  columns: TaskGroup[];
  by: BoardGroupBy;
  /** Where a card can move to: every column, shown or not. */
  targets: { key: string; title: string }[];
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onMove: (item: Item, from: string, to: string) => void;
  onAdd?: (column: string) => void;
  folded: Set<string>;
  onToggleFold: (column: string) => void;
  parentOf: (item: Item) => string | undefined;
  reviewCards: ReviewItem[];
  onOpenReview: (id: string) => void;
  agentName: string;
  agentOf: (item: Item) => string | undefined;
};

export function Board({
  columns,
  by,
  targets,
  busy,
  canWrite,
  onMove,
  onAdd,
  folded,
  onToggleFold,
  parentOf,
  reviewCards,
  onOpenReview,
  agentName,
  agentOf,
}: Props) {
  const owners = by === "owner";
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; from: string } | null>(
    null,
  );
  const [over, setOver] = useState<string | null>(null);
  const byId = new Map(columns.flatMap((c) => c.items.map((i) => [i.id, i])));

  const drop = (to: string, raw: string) => {
    setOver(null);
    setDragging(null);
    try {
      const { id, from } = JSON.parse(raw) as { id: string; from: string };
      const item = byId.get(id);
      if (
        !busy &&
        item &&
        canWrite(item) &&
        from !== to &&
        targets.some((t) => t.key === to)
      )
        onMove(item, from, to);
    } catch {
      // Something else was dropped here: nothing to move.
    }
  };
  /** A card dragged near an edge scrolls the board along. */
  const edge = (x: number) => {
    const node = box.current;
    if (!node) return;
    const area = node.getBoundingClientRect();
    if (x < area.left + 40) node.scrollLeft -= 16;
    else if (x > area.right - 40) node.scrollLeft += 16;
  };

  return (
    <div
      ref={box}
      className="work-board"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(CARD)) edge(event.clientX);
      }}
    >
      {columns.map((column) => {
        const isFolded = folded.has(column.key);
        const review = owners && column.key === OWNER_REVIEW;
        const count = review ? reviewCards.length : column.items.length;
        const agent =
          owners && (column.key === OWNER_AGENT || isAgentLane(column.key));
        return (
          <section
            key={column.key}
            aria-label={`${column.title}, ${count}`}
            className={`work-column${isFolded ? " is-folded" : ""}${
              over === column.key && dragging?.from !== column.key
                ? " is-drop"
                : ""
            }`}
            onDragOver={(event) => {
              if (busy || !event.dataTransfer.types.includes(CARD)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== column.key) setOver(column.key);
            }}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setOver((key) => (key === column.key ? null : key));
            }}
            onDrop={(event) => {
              const raw = event.dataTransfer.getData(CARD);
              if (!raw) return;
              event.preventDefault();
              drop(column.key, raw);
            }}
          >
            <header className="work-column-head">
              <button
                type="button"
                aria-expanded={!isFolded}
                aria-label={`${isFolded ? "Show" : "Fold"} ${column.title}`}
                onClick={() => onToggleFold(column.key)}
              >
                {isFolded ? (
                  <ChevronRight aria-hidden="true" />
                ) : (
                  <ChevronDown aria-hidden="true" />
                )}
                {agent ? (
                  <Bot aria-hidden="true" />
                ) : (
                  column.color && (
                    <i
                      style={{ background: column.color }}
                      aria-hidden="true"
                    />
                  )
                )}
                <span dir="auto">{column.title}</span>
              </button>
              <span className="work-count">
                {count}
                {column.minutes > 0 && ` · ${durationText(column.minutes)}`}
              </span>
              {onAdd && (
                <IconButton
                  label={`New task in ${column.title}`}
                  disabled={busy}
                  onClick={() => onAdd(column.key)}
                >
                  <Plus />
                </IconButton>
              )}
            </header>
            {!isFolded && (
              <div className="work-cards">
                {count === 0 && (
                  <p className="work-column-empty">
                    {review
                      ? "Nothing waits for your review."
                      : dragging
                        ? "Drop here"
                        : column.key === OWNER_AGENT && owners
                          ? `Drag a task here to hand it to ${agentName}.`
                          : "Nothing here yet"}
                  </p>
                )}
                {review &&
                  reviewCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="work-card work-card-main"
                      aria-label={`Review ${card.summary}`}
                      onClick={() => onOpenReview(card.id)}
                    >
                      <span className="work-card-title" dir="auto">
                        {card.summary}
                      </span>
                      <span className="work-card-meta">
                        <span className="st-fact">
                          <Bot aria-hidden="true" />
                          {card.source === "assistant"
                            ? agentName
                            : card.proposer}
                        </span>
                        <span className="st-fact">
                          {card.changes.length === 1
                            ? "1 change"
                            : `${card.changes.length} changes`}
                        </span>
                      </span>
                    </button>
                  ))}
                {column.items.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    column={column}
                    owners={owners}
                    writable={canWrite(item)}
                    busy={busy}
                    dragging={dragging?.id === item.id}
                    targets={targets}
                    parent={parentOf(item)}
                    agentName={agentName}
                    agentLane={agentOf(item)}
                    onMove={onMove}
                    onDrag={(on) => {
                      setDragging(
                        on ? { id: item.id, from: column.key } : null,
                      );
                      if (!on) setOver(null);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Card({
  item,
  column,
  owners,
  writable,
  busy,
  dragging,
  targets,
  parent,
  agentName,
  agentLane,
  onMove,
  onDrag,
}: {
  item: Item;
  column: TaskGroup;
  owners: boolean;
  writable: boolean;
  busy: boolean;
  dragging: boolean;
  targets: { key: string; title: string }[];
  parent?: string;
  agentName: string;
  agentLane?: string;
  onMove: (item: Item, from: string, to: string) => void;
  onDrag: (on: boolean) => void;
}) {
  const progress = progressOf(item);
  const showProgress =
    !isClosed(item.status) &&
    ((progress > 0 && progress < 100) || !!item.steps_total);
  const late = isOverdue(item);
  const elsewhere = targets.filter((target) => target.key !== column.key);
  return (
    <article
      className={`work-card${dragging ? " is-dragging" : ""}`}
      draggable={writable && !busy}
      onDragStart={(event) => {
        event.dataTransfer.setData(
          CARD,
          JSON.stringify({ id: item.id, from: column.key }),
        );
        event.dataTransfer.setData("text/plain", item.title);
        event.dataTransfer.effectAllowed = "move";
        onDrag(true);
      }}
      onDragEnd={() => onDrag(false)}
    >
      <button
        type="button"
        className="work-card-main"
        aria-label={`Open ${item.title}`}
        onClick={() => tasks.open(item)}
      >
        {parent && (
          <span className="work-card-parent" dir="auto">
            {parent} ›
          </span>
        )}
        <span className="work-card-title" dir="auto">
          {item.title}
        </span>
        <span className="work-card-meta">
          {item.due_at && (
            <span className={`st-fact${late ? " work-late" : ""}`}>
              {shortDue(item)}
              {late && " · Overdue"}
            </span>
          )}
          {owners && <Pill>{statusLabels[item.status]}</Pill>}
          {item.priority === "high" && <Pill tone="amber">High</Pill>}
          {!!item.steps_total && (
            <span className="st-fact">
              <ListChecks aria-hidden="true" />
              {item.steps_done ?? 0}/{item.steps_total}
            </span>
          )}
          {!!item.updates_count && (
            <span className="st-fact">
              <MessageSquare aria-hidden="true" />
              {item.updates_count}
            </span>
          )}
          {item.team_name && (
            <span className="st-fact">
              <Users aria-hidden="true" />
              <span className="st-clip" dir="auto">
                {item.team_name}
              </span>
            </span>
          )}
          {item.agent_grant_id ? (
            <span
              className="st-fact"
              title={agentStateText(item.agent_state, agentName)}
            >
              <Bot aria-hidden="true" />
              {agentName}
            </span>
          ) : agentLane ? (
            <span className="st-fact">
              <Bot aria-hidden="true" />
              {agentLane}
            </span>
          ) : item.assignee_name ? (
            <span
              className="st-fact"
              title={`Assigned to ${item.assignee_name}`}
            >
              <span className="st-mini-avatar" aria-hidden="true">
                {item.assignee_name.trim()[0]?.toUpperCase()}
              </span>
              <span className="sr-only">Assigned to {item.assignee_name}</span>
            </span>
          ) : null}
        </span>
        {owners && item.agent_state && (
          <span
            className={`work-agent-line${item.agent_state === "needs_you" ? " is-needs" : ""}`}
            role="status"
          >
            {item.agent_grant_id && item.agent_progress
              ? item.agent_progress
              : item.agent_result ||
                agentStateText(item.agent_state, agentName)}
          </span>
        )}
        {showProgress && (
          <span className="st-bar" aria-hidden="true">
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
      </button>
      {writable && (
        <div className="work-card-tools">
          {elsewhere.length > 0 && (
            <Menu
              label={`Move ${item.title} to`}
              trigger={(open, expanded) => (
                <IconButton
                  label={`Move ${item.title} to`}
                  aria-expanded={expanded}
                  disabled={busy}
                  onClick={open}
                >
                  <ArrowRightLeft />
                </IconButton>
              )}
            >
              {(close) =>
                elsewhere.map((target) => (
                  <button
                    key={target.key}
                    onClick={() => {
                      close();
                      onMove(item, column.key, target.key);
                    }}
                  >
                    {target.title}
                  </button>
                ))
              }
            </Menu>
          )}
          <ItemMenu item={item} />
        </div>
      )}
    </article>
  );
}
