import { Select } from "../../components/Select";
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
  localDateKey,
  type BreakLevel,
  type BusyInterval,
  type HttpError,
  type Plan,
  type PlannerPrefs,
  type PlannerReview,
  type PlanScope,
  type PlanTask,
  type Team,
  type Item,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import { appliedText, PlanCard } from "../../components/PlanCard";
import {
  deviceTimeZone,
  errorText,
  minutesLabel,
  spanLabel,
} from "../../lib/planning";
import type { PlanTuning } from "./usePlanTuning";
import { HorizonLanes } from "./HorizonLanes";
import { RealityLine, WhatIfBox } from "./PlanChecks";
import { PlanExperiments } from "./PlanExperiments";
import { DateField } from "../../components/DateField";

export const BREAK_LABELS: Record<BreakLevel, string> = {
  none: "No breaks",
  light: "Light breaks",
  normal: "Normal breaks",
  intense: "Plenty of breaks",
};

type Props = {
  prefs: PlannerPrefs | null;
  /** For what waits on what, when a session is moved. */
  items: Item[];
  /** For "Plan for": your teams. */
  teams: Team[];
  plan: Plan | null;
  /** Tuning the previewed plan (shared with the grid). */
  tuner: PlanTuning;
  onPlan: (plan: Plan | null) => void;
  /** Set to run a preview right away ("Plan my day", "Plan it"). */
  request: { days?: number; include?: string[]; key: number } | null;
  /** Reload the calendar and planner after a change. */
  onChanged: () => Promise<void>;
  report: (e: unknown) => void;
  revision: number;
  onClose: () => void;
};

type Outcome = { ok: boolean; text: string } | null;

/** The scope to send: null when it's everything (personal and all teams). */
const scopeOf = (
  personal: boolean,
  teamIds: string[] | null,
  listIds: string[],
): PlanScope | null =>
  personal && teamIds === null && !listIds.length
    ? null
    : {
        personal,
        ...(teamIds === null ? {} : { team_ids: teamIds }),
        list_ids: listIds,
      };

const rangeLabel = (r: BusyInterval) =>
  `${new Date(r.start_at).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}, ${spanLabel(r.start_at, r.end_at)}`;

/**
 * Plan the next days: options and what to plan for, "Preview plan" (ghost
 * blocks on the grid), tuning the preview (tasks in or out, estimates,
 * keep-free times; pin blocks by dragging them on the grid), a warning when
 * the calendar changed since, "Apply plan", and a review of unfinished
 * blocks, clashes and tasks at risk.
 */
export function PlannerPanel({
  prefs,
  items,
  teams,
  plan,
  tuner,
  onPlan,
  request,
  onChanged,
  report,
  revision,
  onClose,
}: Props) {
  const { lists } = usePlanning();
  /** Today in the planner's time zone, which is how the server reads start_date. */
  const today = () =>
    localDateKey(new Date(), prefs?.timezone ?? deviceTimeZone());
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState(prefs?.horizon_days ?? 1);
  const [useFrames, setUseFrames] = useState(true);
  const [split, setSplit] = useState(true);
  const [pad, setPad] = useState(prefs?.pad_percent ?? 15);
  const [breakLevel, setBreakLevel] = useState<BreakLevel>(
    prefs?.break_level ?? "normal",
  );
  const [personal, setPersonal] = useState(true);
  /** Null: every team. */
  const [teamIds, setTeamIds] = useState<string[] | null>(null);
  const [listIds, setListIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [review, setReview] = useState<PlannerReview | null>(null);
  const seeded = useRef(!!prefs);
  const live = !!plan && !plan.applied;
  const planId = plan?.id;

  // Start from saved preferences once they arrive.
  useEffect(() => {
    if (!prefs || seeded.current) return;
    seeded.current = true;
    setDays(prefs.horizon_days);
    setStartDate(localDateKey(new Date(), prefs.timezone));
    setPad(prefs.pad_percent);
    setBreakLevel(prefs.break_level);
  }, [prefs]);

  // Show what a plan was made for (one from the assistant may differ).
  useEffect(() => {
    if (!plan?.options) return;
    const s = plan.options.scope;
    setPersonal(s?.personal ?? true);
    setTeamIds(s?.team_ids ?? null);
    setListIds(s?.list_ids ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

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
    async (dayCount = days, include?: string[]) => {
      setPending(true);
      setOutcome(null);
      try {
        let next = await client.previewPlan({
          start_date: startDate,
          days: dayCount,
          use_frames: useFrames,
          split,
          pad_percent: pad,
          break_level: breakLevel,
          timezone: deviceTimeZone(),
          scope: scopeOf(personal, teamIds, listIds) ?? undefined,
        });
        // "Plan it": make sure the task is in, even outside the scope.
        if (
          include?.length &&
          !include.every((id) =>
            next.tasks?.some((t) => t.item_id === id && t.included),
          )
        )
          next = await client.tunePlan(next.id, { include_item_ids: include });
        onPlan(next);
      } catch (e) {
        fail(e);
      } finally {
        setPending(false);
      }
    },
    [
      days,
      startDate,
      useFrames,
      split,
      pad,
      breakLevel,
      personal,
      teamIds,
      listIds,
      onPlan,
      fail,
    ],
  );

  // "Plan my day" and similar: preview right away.
  const latestPreview = useRef(preview);
  latestPreview.current = preview;
  useEffect(() => {
    if (!request) return;
    const count = request.days ?? days;
    setDays(count);
    setStartDate(today());
    // Let the state settle so the preview uses today's date.
    const id = setTimeout(
      () => void latestPreview.current(count, request.include),
      0,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.key]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void preview();
  };

  /** A change to "Plan for"; a live preview is tuned to match. */
  const changeScope = (p: boolean, t: string[] | null, l: string[]) => {
    setPersonal(p);
    setTeamIds(t);
    setListIds(l);
    if (live) void tuner.setScope(scopeOf(p, t, l));
  };
  const toggleTeam = (id: string) => {
    const current = teamIds ?? teams.map((t) => t.id);
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    changeScope(personal, next.length === teams.length ? null : next, listIds);
  };
  const toggleList = (id: string) =>
    changeScope(
      personal,
      teamIds,
      listIds.includes(id) ? listIds.filter((x) => x !== id) : [...listIds, id],
    );

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

  const setEstimate = (t: PlanTask, minutes: number, save: boolean) =>
    void tuner.setEstimate(t.item_id, minutes, save).then((ok) => {
      if (ok && save)
        setOutcome({
          ok: true,
          text: `Saved ${minutesLabel(minutes)} as the estimate for “${t.title}”.`,
        });
    });

  const unfinished = review?.unfinished ?? [];
  const conflicts = review?.conflicts ?? [];
  const atRisk = review?.at_risk ?? [];
  const tasks = plan?.tasks ?? [];
  const keepFree = tuner.state?.keepFree ?? [];
  const busy = pending || tuner.pending;

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
          <DateField
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label>
          Days
          <Select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 day" : `${d} days`}
              </option>
            ))}
          </Select>
        </label>
        {(teams.length > 0 || lists.length > 0) && (
          <fieldset className="wide planner-scope">
            <legend>Plan for</legend>
            <label className="check-line">
              <input
                type="checkbox"
                checked={personal}
                disabled={tuner.pending}
                onChange={(e) =>
                  changeScope(e.target.checked, teamIds, listIds)
                }
              />
              Personal tasks
            </label>
            {teams.map((t) => (
              <label key={t.id} className="check-line">
                <input
                  type="checkbox"
                  checked={teamIds === null || teamIds.includes(t.id)}
                  disabled={tuner.pending}
                  onChange={() => toggleTeam(t.id)}
                />
                <span>
                  {t.name} <small>· assigned to you</small>
                </span>
              </label>
            ))}
            {lists.length > 0 && (
              <div className="scope-lists" role="group" aria-label="Lists">
                <small>Only these lists (none ticked: any list)</small>
                {lists.map((l) => (
                  <label key={l.id} className="check-line">
                    <input
                      type="checkbox"
                      checked={listIds.includes(l.id)}
                      disabled={tuner.pending}
                      onChange={() => toggleList(l.id)}
                    />
                    <i
                      className="list-dot"
                      style={{ background: l.color }}
                      aria-hidden="true"
                    />
                    {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
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
          <Select
            value={breakLevel}
            onChange={(e) => setBreakLevel(e.target.value as BreakLevel)}
          >
            {BREAK_LEVELS.map((b) => (
              <option key={b} value={b}>
                {BREAK_LABELS[b]}
              </option>
            ))}
          </Select>
        </label>
        <div className="wide planner-buttons">
          <button className="primary" disabled={busy}>
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

      {live && tuner.stale && (
        <div className="plan-stale" role="status">
          <RefreshCw size={14} aria-hidden="true" />
          <span>Your calendar changed since this plan was made.</span>
          <button
            className="secondary"
            disabled={tuner.pending}
            onClick={() => void tuner.refresh()}
          >
            Refresh plan
          </button>
        </div>
      )}
      {tuner.error && (
        <p className="inline-outcome panel-outcome fail" role="alert">
          <CircleX size={13} />
          {tuner.error}
        </p>
      )}
      {tuner.pending && (
        <p className="panel-hint" role="status">
          Updating the plan…
        </p>
      )}

      {plan && (
        <div className="planner-result">
          <PlanCard key={plan.id} plan={plan} onApply={apply} limit={20} />
        </div>
      )}
      {live && plan && (
        <RealityLine
          plan={plan}
          timeZone={prefs?.timezone ?? plan.options?.timezone ?? "UTC"}
        />
      )}
      {live && plan && plan.days > 1 && (
        <HorizonLanes plan={plan} prefs={prefs} items={items} tuner={tuner} />
      )}
      <WhatIfBox items={items} days={plan?.days ?? days} />
      <PlanExperiments />

      {live && tasks.length > 0 && (
        <div className="plan-tasks">
          <div className="planner-review-head">
            <h3>Tasks considered</h3>
            <small>
              {tasks.filter((t) => t.included).length} of {tasks.length} in
            </small>
          </div>
          <ul>
            {tasks.map((t) => (
              <PlanTaskRow
                key={t.item_id}
                task={t}
                disabled={busy}
                onInclude={(on) => void tuner.setIncluded(t.item_id, on)}
                onEstimate={(minutes, save) => setEstimate(t, minutes, save)}
              />
            ))}
          </ul>
        </div>
      )}

      {live && (
        <div className="plan-keepfree">
          <h3>Keep free</h3>
          {keepFree.length > 0 && (
            <ul>
              {keepFree.map((r) => (
                <li key={r.start_at + r.end_at}>
                  <span>{rangeLabel(r)}</span>
                  <button
                    className="icon-button"
                    aria-label={`Stop keeping ${rangeLabel(r)} free`}
                    disabled={busy}
                    onClick={() => void tuner.dropKeepFree(r)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="panel-hint">
            Drag across empty time in week or day view to keep it free. Drag a
            planned block to pin it; × leaves it out.
          </p>
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

type RowProps = {
  task: PlanTask;
  disabled: boolean;
  onInclude: (included: boolean) => void;
  onEstimate: (minutes: number, save: boolean) => void;
};

/** One task the plan looked at: in or out, why, and its estimate. */
function PlanTaskRow({ task: t, disabled, onInclude, onEstimate }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(t.estimate_minutes ?? 30);
  const [save, setSave] = useState(false);
  const inputId = "plan-estimate-" + t.item_id;
  return (
    <li className={"plan-task" + (t.included ? "" : " is-out")}>
      <label className="plan-task-check">
        <input
          type="checkbox"
          checked={t.included}
          disabled={disabled}
          onChange={(e) => onInclude(e.target.checked)}
        />
        <span>
          <strong>{t.title}</strong>
          <small>
            {t.included
              ? `${minutesLabel(t.planned_minutes)} planned`
              : "Left out"}
            {t.due_at && ` · due ${dateLabel(t.due_at)}`}
            {t.reason && ` · ${t.reason}`}
          </small>
        </span>
      </label>
      {t.at_risk && <span className="chip is-warn">At risk</span>}
      {editing ? (
        <form
          className="plan-estimate"
          onSubmit={(e) => {
            e.preventDefault();
            onEstimate(minutes, save);
            setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor={inputId}>
            Minutes to plan for {t.title}
          </label>
          <input
            id={inputId}
            type="number"
            min={1}
            max={10080}
            required
            autoFocus
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
          <span className="muted">min</span>
          <label className="check-line">
            <input
              type="checkbox"
              checked={save}
              onChange={(e) => setSave(e.target.checked)}
            />
            Save estimate to the task
          </label>
          <button className="secondary" disabled={disabled}>
            Use
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="link-button"
          disabled={disabled}
          aria-label={`Change the estimate for ${t.title}`}
          title="Change the estimate for this plan"
          onClick={() => {
            setMinutes(t.estimate_minutes ?? 30);
            setEditing(true);
          }}
        >
          {t.estimate_minutes ? minutesLabel(t.estimate_minutes) : "30 min?"}
          {t.estimate_tuned && " (tuned)"}
        </button>
      )}
    </li>
  );
}
