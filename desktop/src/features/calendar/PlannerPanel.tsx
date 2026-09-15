import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  Check,
  CircleX,
  FastForward,
  RefreshCw,
  Wand2,
  X,
} from "lucide-react";
import {
  BREAK_LEVELS,
  dateLabel,
  type BreakLevel,
  type HttpError,
  type Plan,
  type PlannerPrefs,
  type PlannerReview,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { appliedText, PlanCard } from "../../components/PlanCard";
import {
  dayKey,
  deviceTimeZone,
  errorText,
  minutesLabel,
  spanLabel,
} from "../../lib/planning";

export const BREAK_LABELS: Record<BreakLevel, string> = {
  none: "No breaks",
  light: "Light breaks",
  normal: "Normal breaks",
  intense: "Plenty of breaks",
};

type Props = {
  prefs: PlannerPrefs | null;
  plan: Plan | null;
  onPlan: (plan: Plan | null) => void;
  /** Set to run a preview right away (from "Plan my day"). */
  request: { days?: number; key: number } | null;
  /** Reload the calendar and planner after a change. */
  onChanged: () => Promise<void>;
  report: (e: unknown) => void;
  revision: number;
  onClose: () => void;
};

type Outcome = { ok: boolean; text: string } | null;

/**
 * Plan the next days: options, "Preview plan" (ghost blocks on the grid),
 * "Apply plan", and a review of unfinished blocks, clashes and tasks at risk.
 */
export function PlannerPanel({
  prefs,
  plan,
  onPlan,
  request,
  onChanged,
  report,
  revision,
  onClose,
}: Props) {
  const [startDate, setStartDate] = useState(() => dayKey(new Date()));
  const [days, setDays] = useState(prefs?.horizon_days ?? 1);
  const [useFrames, setUseFrames] = useState(true);
  const [split, setSplit] = useState(true);
  const [pad, setPad] = useState(prefs?.pad_percent ?? 15);
  const [breakLevel, setBreakLevel] = useState<BreakLevel>(
    prefs?.break_level ?? "normal",
  );
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [review, setReview] = useState<PlannerReview | null>(null);
  const seeded = useRef(!!prefs);

  // Start from saved preferences once they arrive.
  useEffect(() => {
    if (!prefs || seeded.current) return;
    seeded.current = true;
    setDays(prefs.horizon_days);
    setPad(prefs.pad_percent);
    setBreakLevel(prefs.break_level);
  }, [prefs]);

  const fail = useCallback(
    (e: unknown) => {
      if ((e as HttpError).status === 401) report(e);
      setOutcome({ ok: false, text: errorText(e) });
    },
    [report],
  );

  const loadReview = useCallback(async () => {
    try {
      setReview(await client.plannerReview());
    } catch (e) {
      if ((e as HttpError).status === 401) report(e);
    }
  }, [report]);
  useEffect(() => {
    void loadReview();
  }, [loadReview, revision]);

  const preview = useCallback(
    async (dayCount = days) => {
      setPending(true);
      setOutcome(null);
      try {
        onPlan(
          await client.previewPlan({
            start_date: startDate,
            days: dayCount,
            use_frames: useFrames,
            split,
            pad_percent: pad,
            break_level: breakLevel,
            timezone: deviceTimeZone(),
          }),
        );
      } catch (e) {
        fail(e);
      } finally {
        setPending(false);
      }
    },
    [days, startDate, useFrames, split, pad, breakLevel, onPlan, fail],
  );

  // "Plan my day" and similar: preview right away.
  const latestPreview = useRef(preview);
  latestPreview.current = preview;
  useEffect(() => {
    if (!request) return;
    const count = request.days ?? days;
    setDays(count);
    setStartDate(dayKey(new Date()));
    // Let the state settle so the preview uses today's date.
    const id = setTimeout(() => void latestPreview.current(count), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.key]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void preview();
  };

  const apply = async () => {
    if (!plan) return "";
    const result = await client.applyPlan(plan.id);
    onPlan({ ...plan, applied: true });
    await onChanged();
    void loadReview();
    return appliedText(result);
  };

  const moveForward = async (ids?: string[]) => {
    setPending(true);
    setOutcome(null);
    try {
      onPlan(await client.rollForward(ids));
      setOutcome({
        ok: true,
        text: "Here's a plan for the unfinished work. Apply it to save.",
      });
    } catch (e) {
      fail(e);
    } finally {
      setPending(false);
    }
  };

  const reschedule = async (blockId: string) => {
    setPending(true);
    setOutcome(null);
    try {
      const moved = await client.rescheduleBlock(blockId);
      setOutcome({
        ok: true,
        text: `Moved to ${dateLabel(moved.start_at)}.`,
      });
      await onChanged();
      await loadReview();
    } catch (e) {
      fail(e);
    } finally {
      setPending(false);
    }
  };

  const unfinished = review?.unfinished ?? [];
  const conflicts = review?.conflicts ?? [];
  const atRisk = review?.at_risk ?? [];

  return (
    <section className="card planner-panel" aria-labelledby="planner-title">
      <div className="section-heading">
        <h2 id="planner-title">
          <Wand2 size={16} aria-hidden="true" /> Planner
        </h2>
        <button
          className="icon-button"
          aria-label="Close planner"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form className="planner-form" onSubmit={submit}>
        <label>
          Start
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label>
          Days
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 day" : `${d} days`}
              </option>
            ))}
          </select>
        </label>
        <label className="switch-line">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={useFrames}
            onChange={(e) => setUseFrames(e.target.checked)}
          />
          <span>
            Use frames
            <small>Only place tasks inside your frames.</small>
          </span>
        </label>
        <label className="switch-line">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
          />
          <span>
            Split long tasks
            <small>Break big tasks into sessions.</small>
          </span>
        </label>
        <label className="wide">
          Padding <strong>{pad}%</strong>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pad}
            aria-valuetext={`${pad}% extra time`}
            onChange={(e) => setPad(Number(e.target.value))}
          />
          <small className="field-hint">
            Extra time added to each estimate.
          </small>
        </label>
        <label className="wide">
          Breaks
          <select
            value={breakLevel}
            onChange={(e) => setBreakLevel(e.target.value as BreakLevel)}
          >
            {BREAK_LEVELS.map((b) => (
              <option key={b} value={b}>
                {BREAK_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        <div className="wide planner-buttons">
          <button className="primary" disabled={pending}>
            <Wand2 size={15} /> {pending ? "Planning…" : "Preview plan"}
          </button>
          {plan && (
            <button
              type="button"
              className="text-button"
              onClick={() => onPlan(null)}
            >
              Clear preview
            </button>
          )}
        </div>
      </form>

      {outcome && (
        <p
          className={
            "inline-outcome panel-outcome " + (outcome.ok ? "ok" : "fail")
          }
          role={outcome.ok ? "status" : "alert"}
        >
          {outcome.ok ? <Check size={13} /> : <CircleX size={13} />}
          {outcome.text}
        </p>
      )}

      {plan && (
        <div className="planner-result">
          <PlanCard key={plan.id} plan={plan} onApply={apply} limit={20} />
        </div>
      )}

      <div className="planner-review">
        <div className="planner-review-head">
          <h3>Review</h3>
          <button
            className="icon-button"
            aria-label="Refresh review"
            onClick={() => void loadReview()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {!review ? (
          <p className="panel-hint">Checking your plan…</p>
        ) : !unfinished.length && !conflicts.length && !atRisk.length ? (
          <p className="panel-hint">All clear. Nothing needs attention.</p>
        ) : null}

        {unfinished.length > 0 && (
          <div className="review-group">
            <div className="review-group-head">
              <strong>Unfinished blocks</strong>
              <button
                className="secondary"
                disabled={pending}
                onClick={() => void moveForward()}
              >
                <FastForward size={13} /> Move all forward
              </button>
            </div>
            <ul>
              {unfinished.map((b) => (
                <li key={b.id}>
                  <span>
                    {b.title}
                    <small>
                      {new Date(b.start_at).toLocaleDateString([], {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                      , {spanLabel(b.start_at, b.end_at)}
                    </small>
                  </span>
                  <button
                    className="link-button"
                    disabled={pending}
                    onClick={() => void moveForward([b.id])}
                  >
                    Move forward
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="review-group">
            <strong>Clashes</strong>
            <ul>
              {conflicts.map(({ block, entry }) => (
                <li key={block.id}>
                  <span>
                    {block.title}
                    <small>
                      {dateLabel(block.start_at)} · overlaps {entry.title}
                    </small>
                  </span>
                  <button
                    className="link-button"
                    disabled={pending}
                    onClick={() => void reschedule(block.id)}
                  >
                    Reschedule
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {atRisk.length > 0 && (
          <div className="review-group is-risk">
            <strong>
              <AlertTriangle size={13} aria-hidden="true" /> At risk
            </strong>
            <ul>
              {atRisk.map((t) => (
                <li key={t.item_id}>
                  <span>
                    {t.title}
                    <small>
                      {t.due_at ? `Due ${dateLabel(t.due_at)} · ` : ""}
                      needs {minutesLabel(t.remaining_minutes)}, free{" "}
                      {minutesLabel(t.free_minutes)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
