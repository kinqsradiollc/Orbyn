import { useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  ChevronDown,
  CircleX,
  Clock,
  MoveLeft,
} from "lucide-react";
import {
  atRiskLine,
  dueDateOf,
  moveLine,
  PLAN_MAX_DAYS,
  planOutcome,
  type Plan,
  type PlanApplied,
} from "@orbyn/core";
import {
  byDay,
  errorText,
  longDay,
  minutesLabel,
  plural,
  spanLabel,
} from "../lib/planning";

/**
 * What applying a plan did: "Planned 5 tasks: 3 today, 2 tomorrow · Moved 1
 * session before its deadline · Couldn't fit before the deadline: Budget
 * review (needs 2h, 45m free)."
 */
export const appliedText = (r: PlanApplied, plan: Pick<Plan, "at_risk">) =>
  planOutcome(r, plan.at_risk);

/** The moves ticked: the planner's choice unless changed here. */
export const tickedMoves = (plan: Plan, ticks: Record<string, boolean>) =>
  (plan.moves ?? [])
    .filter((m) => ticks[m.block_id] ?? m.selected)
    .map((m) => m.block_id);

type Props = {
  plan: Plan;
  /** Saves the plan with the moves ticked; resolves with a message to show. */
  onApply?: (moves: string[]) => Promise<string>;
  onOpenInPlanner?: () => void;
  /** Show at most this many blocks per day (the rest are counted). */
  limit?: number;
  /** Ticks on the offered moves, when kept by the caller across tuning. */
  ticks?: Record<string, boolean>;
  onTick?: (blockId: string, on: boolean) => void;
  /** Plan again over more days (offered on tasks that didn't fit). */
  onLookAhead?: () => void;
  /** After applying: show the first changed session on the calendar. */
  onShowOnCalendar?: (at: string) => void;
};

/**
 * A proposed schedule: its days and times, late sessions it can move before
 * their deadline (the planner's own ticked, yours unticked), what's at risk
 * or didn't fit, and Apply.
 */
export function PlanCard({
  plan,
  onApply,
  onOpenInPlanner,
  limit = 6,
  ticks: heldTicks,
  onTick,
  onLookAhead,
  onShowOnCalendar,
}: Props) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [ownTicks, setOwnTicks] = useState<Record<string, boolean>>({});
  const ticks = heldTicks ?? ownTicks;
  const tick = (id: string, on: boolean) =>
    onTick ? onTick(id, on) : setOwnTicks((t) => ({ ...t, [id]: on }));
  const applied = plan.applied || outcome?.ok;
  const days = byDay(plan.blocks);
  const moves = plan.moves ?? [];
  const chosen = tickedMoves(plan, ticks);
  const canLookFurther = !!onLookAhead && plan.days < PLAN_MAX_DAYS && !applied;
  const lookFurther = (
    <button type="button" className="text-button" onClick={onLookAhead}>
      Look further ahead
    </button>
  );
  /** Where the plan's first change lands, for "Show on calendar". */
  const firstAt = [
    ...plan.blocks.map((b) => b.start_at),
    ...moves.filter((m) => chosen.includes(m.block_id)).map((m) => m.start_at),
  ].sort()[0];

  const apply = async () => {
    if (!onApply) return;
    setPending(true);
    setOutcome(null);
    try {
      setOutcome({ ok: true, text: await onApply(chosen) });
    } catch (e) {
      setOutcome({ ok: false, text: errorText(e) });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="plan-card" aria-label="Proposed plan">
      <header className="plan-card-head">
        <CalendarRange size={16} aria-hidden="true" />
        <strong>
          {plural(plan.days, "day")} from {longDay(plan.starts_on)}
        </strong>
        <small>
          {minutesLabel(plan.planned_minutes)} planned of{" "}
          {minutesLabel(plan.capacity_minutes)} free
        </small>
      </header>
      {plan.summary && <p className="plan-summary">{plan.summary}</p>}
      {days.length ? (
        <ol className="plan-days">
          {days.map(([key, blocks]) => (
            <li key={key}>
              <h4>{longDay(key)}</h4>
              <ul>
                {blocks.slice(0, limit).map((b) => (
                  <li key={b.item_id + b.start_at}>
                    <span className="plan-time">
                      {spanLabel(b.start_at, b.end_at)}
                    </span>
                    <span className="plan-title">
                      {b.title}
                      {b.parts > 1 && (
                        <small>
                          {" "}
                          · Session {b.part} of {b.parts}
                        </small>
                      )}
                      {b.frame_name && <small> · {b.frame_name}</small>}
                    </span>
                  </li>
                ))}
                {blocks.length > limit && (
                  <li className="plan-more">
                    and {plural(blocks.length - limit, "more session")}
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ol>
      ) : !moves.length && !plan.at_risk.length ? (
        <p className="plan-summary">Nothing could be placed in this plan.</p>
      ) : null}
      {moves.length > 0 && (
        <details className="plan-flags plan-moves" open>
          <summary>
            <MoveLeft size={13} aria-hidden="true" /> Move sessions before their
            deadline ({moves.length})
            <ChevronDown
              size={13}
              className="plan-moves-caret"
              aria-hidden="true"
            />
          </summary>
          <ul>
            {moves.map((m) => (
              <li key={m.block_id}>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={chosen.includes(m.block_id)}
                    disabled={pending || !!applied || !onApply}
                    onChange={(e) => tick(m.block_id, e.target.checked)}
                  />
                  <span>{moveLine(m)}</span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
      {plan.at_risk.length > 0 && (
        <div className="plan-flags is-risk">
          <strong>
            <AlertTriangle size={13} aria-hidden="true" /> At risk
          </strong>
          <ul>
            {plan.at_risk.map((t) => {
              const line = atRiskLine(t);
              return (
                <li key={t.item_id} className="plan-risk-row">
                  <span>
                    {t.title}
                    {line ? (
                      <small> · {line}</small>
                    ) : (
                      <>
                        {dueDateOf(t) && <small> · due {dueDateOf(t)}</small>}
                        <small> · {t.reason}</small>
                      </>
                    )}
                  </span>
                  {canLookFurther && plan.at_risk.length === 1 && lookFurther}
                </li>
              );
            })}
          </ul>
          {/* Several at risk: one "Look further ahead" for them all. */}
          {canLookFurther && plan.at_risk.length > 1 && (
            <div className="plan-risk-more">{lookFurther}</div>
          )}
        </div>
      )}
      {plan.unplaced.length > 0 && (
        <div className="plan-flags">
          <strong>
            <Clock size={13} aria-hidden="true" /> Didn&apos;t fit
          </strong>
          <ul>
            {plan.unplaced.map((t) => (
              <li key={t.item_id}>
                {t.title}
                <small> · {t.reason}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(onApply || onOpenInPlanner) && (
        <div className="plan-actions">
          {onApply && (
            <button
              className="primary"
              disabled={
                pending || applied || (!plan.blocks.length && !chosen.length)
              }
              onClick={() => void apply()}
            >
              <Check size={15} />{" "}
              {applied ? "Plan applied" : pending ? "Applying…" : "Apply"}
            </button>
          )}
          {onOpenInPlanner && (
            <button className="secondary" onClick={onOpenInPlanner}>
              <CalendarRange size={15} /> Open in planner
            </button>
          )}
        </div>
      )}
      {outcome && (
        <div
          className={
            "inline-outcome plan-outcome " + (outcome.ok ? "ok" : "fail")
          }
          role={outcome.ok ? "status" : "alert"}
        >
          {outcome.ok ? <Check size={13} /> : <CircleX size={13} />}
          <span>{outcome.text}</span>
          {outcome.ok && onShowOnCalendar && firstAt && (
            <button
              type="button"
              className="text-button"
              onClick={() => onShowOnCalendar(firstAt)}
            >
              Show on calendar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
