import {
  atRiskLine,
  dueDateOf,
  localDateKey,
  moveLine,
  type Plan,
} from "@orbyn/core";
import { AlertTriangle, CalendarRange, Clock } from "lucide-react";
import { useRef, useState } from "react";
import { HttpError } from "@orbyn/core";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button } from "../../ui/kit";
import { deviceTimeZone, minutesLabel, plural } from "../shared-task";
import { useOwned, useOwner } from "./hooks";
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
function PlanPreviewBody({
  plan,
  onApply,
  onOpen,
  onShowOnCalendar,
  onRefresh,
}: {
  plan: Plan;
  /** Saves the plan with these moves; resolves with what it did. */
  onApply?: (moves: string[]) => Promise<string>;
  onOpen?: () => void | Promise<void>;
  /** Re-read this exact saved plan after a missing apply receipt. */
  onRefresh?: () => Promise<Plan>;
  onShowOnCalendar?: (at: string) => void | Promise<void>;
}) {
  const owned = useOwned();
  const zone = deviceTimeZone();
  const running = useRef(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uncertain, setUncertain] = useState(false);
  const [confirmedApplied, setConfirmedApplied] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{
    ok: boolean;
    text: string;
    at?: string;
  } | null>(null);
  const applied = plan.applied || confirmedApplied || !!outcome?.ok;
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
    if (!owned() || !onApply || running.current || applied || uncertain) return;
    running.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const text = await onApply(chosen);
      if (owned()) {
        setConfirmedApplied(true);
        setOutcome({ ok: true, text, at: firstAt });
      }
    } catch (failure) {
      if (owned()) {
        const status = failure instanceof HttpError ? failure.statusCode : 0;
        setUncertain(
          !status || status >= 500 || status === 408 || status === 429,
        );
        setOutcome({
          ok: false,
          text: messageOf(
            failure,
            "Couldn't confirm whether the plan was applied. Check its saved state before trying again.",
          ),
        });
      }
    } finally {
      running.current = false;
      if (owned()) setPending(false);
    }
  };

  const open = async (action: () => void | Promise<void>) => {
    if (!owned()) return;
    try {
      await action();
    } catch (failure) {
      if (owned())
        setOutcome({
          ok: false,
          text: messageOf(failure, "Couldn't open this plan destination."),
        });
    }
  };
  const reconcile = async () => {
    if (!owned() || running.current) return;
    running.current = true;
    setPending(true);
    try {
      const current = await (onRefresh ? onRefresh() : client.getPlan(plan.id));
      if (!owned()) return;
      if (current.id !== plan.id)
        throw new Error("The refreshed plan doesn't match this preview.");
      if (current.applied) {
        setConfirmedApplied(true);
        setUncertain(false);
        setOutcome({
          ok: true,
          text: "The saved plan confirms it was applied.",
          at: firstAt,
        });
      } else {
        // An earlier apply may still commit after this read. Keep its decision frozen.
        setUncertain(true);
        setOutcome({
          ok: false,
          text: "The latest saved snapshot is not applied yet. The earlier request may still finish. Check again or open this plan in the planner.",
        });
      }
    } catch (failure) {
      if (owned())
        setOutcome({
          ok: false,
          text: messageOf(
            failure,
            "Couldn't check this saved plan. Apply remains blocked.",
          ),
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
                disabled={pending || applied || uncertain || !onApply}
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
              disabled={
                applied || uncertain || (!plan.blocks.length && !chosen.length)
              }
              onClick={() => void apply()}
            >
              {applied ? "Plan applied" : pending ? "Applying…" : "Apply plan"}
            </Button>
          )}
          {onOpen && (
            <Button disabled={pending} onClick={() => void open(onOpen)}>
              Open in planner
            </Button>
          )}
        </div>
      )}
      {uncertain && (
        <Button disabled={pending} onClick={() => void reconcile()}>
          Check saved plan
        </Button>
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
              onClick={() => {
                if (owned() && outcome.at) {
                  const at = outcome.at;
                  void open(() => onShowOnCalendar(at));
                }
              }}
            >
              Show on calendar
            </Button>
          )}
        </p>
      )}
    </section>
  );
}

export function PlanPreview(props: Parameters<typeof PlanPreviewBody>[0]) {
  const owner = useOwner();
  return (
    <PlanPreviewBody
      key={`${owner}:${JSON.stringify(props.plan)}`}
      {...props}
    />
  );
}
