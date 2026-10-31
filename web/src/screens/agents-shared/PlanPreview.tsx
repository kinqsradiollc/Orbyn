import {
  atRiskLine,
  dueDateOf,
  localDateKey,
  moveLine,
  type Plan,
} from "@orbyn/core";
import { AlertTriangle, CalendarRange, Clock } from "lucide-react";
import { useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { Button } from "../../ui/kit";
import { deviceTimeZone, minutesLabel, plural } from "../shared-task";
import { useOwned } from "./hooks";
import { More } from "./parts";

const LIMIT = 6;
const dayName = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

/** A schedule the assistant proposed: its days, moves, risks, and Apply. */
export function PlanPreview({
  plan,
  onApply,
  onOpen,
  onShowOnCalendar,
}: {
  plan: Plan;
  /** Saves the plan with these moves; resolves with what it did. */
  onApply?: (moves: string[]) => Promise<string>;
  onOpen?: () => void;
  onShowOnCalendar?: (at: string) => void;
}) {
  const owned = useOwned();
  const zone = deviceTimeZone();
  const running = useRef(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{
    ok: boolean;
    text: string;
    at?: string;
  } | null>(null);
  const applied = plan.applied || !!outcome?.ok;
  const moves = plan.moves ?? [];
  const chosen = moves
    .filter((move) => ticks[move.block_id] ?? move.selected)
    .map((move) => move.block_id);
  const days = new Map<string, typeof plan.blocks>();
  for (const block of plan.blocks) {
    const key = localDateKey(new Date(block.start_at), zone);
    days.set(key, [...(days.get(key) ?? []), block]);
  }
  const firstAt = [
    ...plan.blocks.map((block) => block.start_at),
    ...moves
      .filter((move) => chosen.includes(move.block_id))
      .map((move) => move.start_at),
  ].sort()[0];

  const apply = async () => {
    if (!owned() || !onApply || running.current || applied) return;
    running.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const text = await onApply(chosen);
      if (owned()) setOutcome({ ok: true, text, at: firstAt });
    } catch (failure) {
      if (owned())
        setOutcome({
          ok: false,
          text: messageOf(failure, "Couldn't apply the plan."),
        });
    } finally {
      running.current = false;
      if (owned()) setPending(false);
    }
  };

  return (
    <section className="agents-plan" aria-label="Proposed plan">
      <header>
        <CalendarRange aria-hidden="true" />
        <strong>
          {plural(plan.days, "day")} from {dayName(plan.starts_on)}
        </strong>
        <span className="muted small">
          {minutesLabel(plan.planned_minutes)} planned of{" "}
          {minutesLabel(plan.capacity_minutes)} free
        </span>
      </header>
      {plan.summary && <p dir="auto">{plan.summary}</p>}
      {[...days].map(([key, blocks]) => {
        const open = expanded.has(key);
        return (
          <div key={key} className="agents-plan-day">
            <h4>{dayName(key)}</h4>
            <ul>
              {(open ? blocks : blocks.slice(0, LIMIT)).map((block) => (
                <li key={block.item_id + block.start_at}>
                  <span className="muted small">
                    {clock(block.start_at, zone)} – {clock(block.end_at, zone)}
                  </span>
                  <span dir="auto">
                    {block.title}
                    {block.parts > 1 && (
                      <span className="muted small">
                        {" "}
                        · Session {block.part} of {block.parts}
                      </span>
                    )}
                    {block.frame_name && (
                      <span className="muted small"> · {block.frame_name}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {blocks.length > LIMIT && (
              <Button
                variant="ghost"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((now) => {
                    const next = new Set(now);
                    if (open) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                {open ? "Show fewer" : `Show all ${blocks.length} sessions`}
              </Button>
            )}
          </div>
        );
      })}
      {!days.size && !moves.length && !plan.at_risk.length && (
        <p>Nothing could be placed in this plan.</p>
      )}
      {moves.length > 0 && (
        <More
          summary={`Move sessions before their deadline (${moves.length})`}
          open
        >
          {moves.map((move) => (
            <label key={move.block_id} className="check agents-check">
              <input
                type="checkbox"
                checked={chosen.includes(move.block_id)}
                disabled={pending || applied || !onApply}
                onChange={(event) =>
                  setTicks((now) => ({
                    ...now,
                    [move.block_id]: event.target.checked,
                  }))
                }
              />
              <span dir="auto">{moveLine(move)}</span>
            </label>
          ))}
        </More>
      )}
      {plan.at_risk.length > 0 && (
        <div className="agents-plan-flag">
          <strong>
            <AlertTriangle aria-hidden="true" /> At risk
          </strong>
          <ul>
            {plan.at_risk.map((task) => {
              const line = atRiskLine(task);
              const due = dueDateOf(task);
              return (
                <li key={task.item_id} dir="auto">
                  {task.title}
                  <span className="muted small">
                    {line
                      ? ` · ${line}`
                      : `${due ? ` · due ${due}` : ""} · ${task.reason}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {plan.unplaced.length > 0 && (
        <div className="agents-plan-flag">
          <strong>
            <Clock aria-hidden="true" /> Didn't fit
          </strong>
          <ul>
            {plan.unplaced.map((task) => (
              <li key={task.item_id} dir="auto">
                {task.title}
                <span className="muted small"> · {task.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(onApply || onOpen) && (
        <div className="agents-buttons">
          {onApply && (
            <Button
              variant="primary"
              busy={pending}
              disabled={applied || (!plan.blocks.length && !chosen.length)}
              onClick={() => void apply()}
            >
              {applied ? "Plan applied" : pending ? "Applying…" : "Apply plan"}
            </Button>
          )}
          {onOpen && (
            <Button disabled={pending} onClick={onOpen}>
              Open in planner
            </Button>
          )}
        </div>
      )}
      {outcome && (
        <p
          className={outcome.ok ? "agents-done" : "agents-failed"}
          role={outcome.ok ? "status" : "alert"}
        >
          {outcome.text}
          {outcome.ok && onShowOnCalendar && outcome.at && (
            <Button
              variant="ghost"
              onClick={() => onShowOnCalendar(outcome.at!)}
            >
              Show on calendar
            </Button>
          )}
        </p>
      )}
    </section>
  );
}
