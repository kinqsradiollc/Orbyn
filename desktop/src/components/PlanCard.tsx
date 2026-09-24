import { useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  CircleX,
  Clock,
} from "lucide-react";
import { dateLabel, type Plan, type TimeBlock } from "@orbyn/core";
import {
  byDay,
  errorText,
  longDay,
  minutesLabel,
  plural,
  spanLabel,
} from "../lib/planning";

/** "Added 4 sessions · 1 skipped because that time is taken now." */
export const appliedText = (r: { blocks: TimeBlock[]; skipped: number }) =>
  `Added ${plural(r.blocks.length, "session")} to your calendar` +
  (r.skipped
    ? ` · ${r.skipped} skipped because something else is there now.`
    : ".");

type Props = {
  plan: Plan;
  /** Saves the plan; resolves with a message to show. */
  onApply?: () => Promise<string>;
  onOpenInPlanner?: () => void;
  /** Show at most this many blocks per day (the rest are counted). */
  limit?: number;
};

/** A proposed schedule: its days and times, what didn't fit, and Apply. */
export function PlanCard({ plan, onApply, onOpenInPlanner, limit = 6 }: Props) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const applied = plan.applied || outcome?.ok;
  const days = byDay(plan.blocks);

  const apply = async () => {
    if (!onApply) return;
    setPending(true);
    setOutcome(null);
    try {
      setOutcome({ ok: true, text: await onApply() });
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
                          · part {b.part} of {b.parts}
                        </small>
                      )}
                      {b.frame_name && <small> · {b.frame_name}</small>}
                    </span>
                  </li>
                ))}
                {blocks.length > limit && (
                  <li className="plan-more">
                    and {plural(blocks.length - limit, "more block")}
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p className="plan-summary">Nothing could be placed in this plan.</p>
      )}
      {plan.at_risk.length > 0 && (
        <div className="plan-flags is-risk">
          <strong>
            <AlertTriangle size={13} aria-hidden="true" /> At risk
          </strong>
          <ul>
            {plan.at_risk.map((t) => (
              <li key={t.item_id}>
                {t.title}
                {t.due_at && <small> · due {dateLabel(t.due_at)}</small>}
                <small> · {t.reason}</small>
              </li>
            ))}
          </ul>
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
              disabled={pending || applied || !plan.blocks.length}
              onClick={() => void apply()}
            >
              <Check size={15} />{" "}
              {applied ? "Plan applied" : pending ? "Applying…" : "Apply plan"}
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
        <p
          className={"inline-outcome " + (outcome.ok ? "ok" : "fail")}
          role={outcome.ok ? "status" : "alert"}
        >
          {outcome.ok ? <Check size={13} /> : <CircleX size={13} />}
          {outcome.text}
        </p>
      )}
    </section>
  );
}
