import {
  BREAK_LEVELS,
  localDateKey,
  planDaysBefore,
  PLAN_MAX_DAYS,
  type BreakLevel,
  type Item,
  type PlannerPrefs,
  type PlanScope,
  type TaskList,
  type Team,
} from "@orbyn/core";
import { Check, RefreshCw, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  SelectBox,
} from "../../ui/kit";
import { minutesLabel } from "./format";
import { plural } from "./model";
import { PlanExperiments, PlanReview, RealityLine, WhatIf } from "./PlanExtras";
import { PlanResult } from "./PlanResult";
import type { PlanState } from "./usePlan";

const BREAK_LABELS: Record<BreakLevel, string> = {
  none: "No breaks",
  light: "Light breaks",
  normal: "Normal breaks",
  intense: "Plenty of breaks",
};

/** A request from elsewhere: "Plan my day", "Plan it", "Find time before". */
export type PlanRequest = {
  key: string;
  days?: number;
  include?: string[];
  only?: string[];
  until?: string | null;
};

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

const deviceZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * Plan the coming days: what for and how, the preview (it hovers over the
 * floor or shows as ghosts on the grid), tuning it, staleness, and a review
 * of unfinished sessions, clashes and tasks at risk.
 */
export function PlanPanel({
  prefs,
  items,
  teams,
  lists,
  plan: p,
  request,
  tz,
  revision,
  onClose,
  onChanged,
  onSeen,
}: {
  prefs: PlannerPrefs;
  items: Item[];
  teams: Team[];
  lists: TaskList[];
  plan: PlanState;
  request: PlanRequest | null;
  tz: string;
  revision: unknown;
  onClose: () => void;
  onChanged: () => void;
  /** Show the plan's first change on the calendar. */
  onSeen: (at: string) => void;
}) {
  const today = () => localDateKey(new Date(), prefs.timezone);
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState(prefs.horizon_days);
  const [useFrames, setUseFrames] = useState(true);
  const [split, setSplit] = useState(true);
  const [pad, setPad] = useState(prefs.pad_percent);
  const [breakLevel, setBreakLevel] = useState<BreakLevel>(prefs.break_level);
  const [personal, setPersonal] = useState(true);
  const [teamIds, setTeamIds] = useState<string[] | null>(null);
  const [listIds, setListIds] = useState<string[]>([]);
  const plan = p.plan;
  const planId = plan?.id;

  // Show what a plan was made for: one from elsewhere may differ.
  useEffect(() => {
    const s = plan?.options?.scope;
    if (!plan?.options) return;
    setPersonal(s?.personal ?? true);
    setTeamIds(s?.team_ids ?? null);
    setListIds(s?.list_ids ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const run = async (
    dayCount = days,
    include?: string[],
    only?: string[],
    start = startDate,
  ) => {
    const ok = await p.preview(
      {
        start_date: start,
        days: dayCount,
        use_frames: useFrames,
        split,
        pad_percent: pad,
        break_level: breakLevel,
        timezone: deviceZone(),
        ...(only?.length
          ? { item_ids: only }
          : { scope: scopeOf(personal, teamIds, listIds) ?? undefined }),
      },
      include,
      plan?.options?.project_id,
    );
    return ok;
  };

  const latestRun = useRef(run);
  latestRun.current = run;
  const seenRequest = useRef("");
  useEffect(() => {
    if (!request || seenRequest.current === request.key) return;
    seenRequest.current = request.key;
    const count =
      (request.until
        ? planDaysBefore(request.until, new Date(), prefs.timezone)
        : undefined) ??
      request.days ??
      days;
    const start = today();
    setDays(count);
    setStartDate(start);
    void latestRun.current(count, request.include, request.only, start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.key]);

  const changeScope = (a: boolean, t: string[] | null, l: string[]) => {
    if (p.pending) return;
    setPersonal(a);
    setTeamIds(t);
    setListIds(l);
    if (p.live) void p.setScope(scopeOf(a, t, l));
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

  const lookAhead = () => {
    setDays(PLAN_MAX_DAYS);
    void run(
      PLAN_MAX_DAYS,
      plan?.options?.include_item_ids,
      plan?.options?.item_ids ?? undefined,
    );
  };

  const scopeSummary =
    [
      personal ? "Personal" : "",
      teams.length
        ? teamIds === null
          ? "All teams"
          : plural(teamIds.length, "team")
        : "",
      listIds.length ? plural(listIds.length, "list") : "",
    ]
      .filter(Boolean)
      .join(" · ") || "No tasks";

  const busy = p.pending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run();
  };

  return (
    <section className="calendar-plan" aria-label="Plan">
      <div className="calendar-side-head">
        <h2>Plan</h2>
        <IconButton label="Close plan" disabled={busy} onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <form className="calendar-form" onSubmit={submit} aria-busy={busy}>
        <div className="calendar-form-grid">
          <Field label="Start">
            <Input
              type="date"
              required
              disabled={busy}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="Days">
            <SelectBox
              value={days}
              disabled={busy}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[...new Set([1, 2, 3, 4, 5, 6, 7, 14, days])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <option key={d} value={d}>
                    {plural(d, "day")}
                  </option>
                ))}
            </SelectBox>
          </Field>
        </div>
        {(teams.length > 0 || lists.length > 0) && (
          <details className="calendar-more-section">
            <summary>Plan for · {scopeSummary}</summary>
            <div className="calendar-checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={personal}
                  disabled={busy}
                  onChange={(e) =>
                    changeScope(e.target.checked, teamIds, listIds)
                  }
                />
                Personal tasks
              </label>
              {teams.map((t) => (
                <label key={t.id} className="check">
                  <input
                    type="checkbox"
                    checked={teamIds === null || teamIds.includes(t.id)}
                    disabled={busy}
                    onChange={() => toggleTeam(t.id)}
                  />
                  <span dir="auto">{t.name} · assigned to you</span>
                </label>
              ))}
              {lists.length > 0 && (
                <small className="muted">
                  Lists · none picked includes all
                </small>
              )}
              {lists.map((l) => (
                <label key={l.id} className="check">
                  <input
                    type="checkbox"
                    checked={listIds.includes(l.id)}
                    disabled={busy}
                    onChange={() => toggleList(l.id)}
                  />
                  <i
                    className="calendar-dot"
                    style={{ background: l.color }}
                    aria-hidden="true"
                  />
                  <span dir="auto">
                    {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
                  </span>
                </label>
              ))}
            </div>
          </details>
        )}
        <details className="calendar-more-section">
          <summary>Scheduling options</summary>
          <div className="calendar-checks">
            <label className="check">
              <input
                type="checkbox"
                checked={useFrames}
                disabled={busy}
                onChange={(e) => setUseFrames(e.target.checked)}
              />
              Only place tasks inside frames
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={split}
                disabled={busy}
                onChange={(e) => setSplit(e.target.checked)}
              />
              Split long tasks into sessions
            </label>
            <Field
              label={`Padding · ${pad}%`}
              hint="Extra time added to each estimate."
            >
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                disabled={busy}
                value={pad}
                aria-valuetext={`${pad}% extra time`}
                onChange={(e) => setPad(Number(e.target.value))}
              />
            </Field>
            <Field label="Breaks">
              <SelectBox
                value={breakLevel}
                disabled={busy}
                onChange={(e) => setBreakLevel(e.target.value as BreakLevel)}
              >
                {BREAK_LEVELS.map((b) => (
                  <option key={b} value={b}>
                    {BREAK_LABELS[b]}
                  </option>
                ))}
              </SelectBox>
            </Field>
          </div>
        </details>
        <Button type="submit" busy={busy}>
          <Wand2 aria-hidden="true" />{" "}
          {busy ? "Planning" : plan ? "Plan again" : "Preview plan"}
        </Button>
      </form>

      {p.live && p.stale && (
        <div className="calendar-note is-warn" role="status">
          <RefreshCw aria-hidden="true" />
          <span>Your calendar changed since this plan was made.</span>
          <Button disabled={busy} onClick={() => void p.refresh()}>
            Refresh plan
          </Button>
        </div>
      )}
      {p.error && <ErrorNotice message={p.error} />}
      {p.pending && p.live && (
        <p className="small muted" role="status">
          Updating the plan
        </p>
      )}
      {plan?.applied && (
        <p className="calendar-applied" role="status">
          <Check aria-hidden="true" /> Plan applied
        </p>
      )}

      {plan && (
        <PlanResult
          plan={plan}
          state={p}
          prefs={prefs}
          items={items}
          tz={tz}
          canLookAhead={plan.days < PLAN_MAX_DAYS && !plan.applied}
          onLookAhead={lookAhead}
          onSeen={onSeen}
        />
      )}
      {p.live && plan && <RealityLine plan={plan} timeZone={tz} />}
      <WhatIf items={items} days={plan?.days ?? days} />
      <PlanExperiments />
      <PlanReview
        tz={tz}
        busy={busy}
        revision={revision}
        onRoll={(ids) => void p.rollForward(ids)}
        onChanged={onChanged}
      />
    </section>
  );
}

/** The one Apply for a live plan, always in reach under the calendar. */
export function PlanBar({
  plan: p,
  onApply,
}: {
  plan: PlanState;
  onApply: () => void;
}) {
  const plan = p.plan;
  if (!plan || plan.applied) return null;
  const moves = (plan.moves ?? []).filter(
    (m) => p.ticks[m.block_id] ?? m.selected,
  ).length;
  const empty = !plan.blocks.length && !moves;
  return (
    <div className="calendar-planbar" role="status">
      <span dir="auto">
        <b>{plural(plan.blocks.length + moves, "session")} proposed</b>
        <small className="muted">
          {minutesLabel(plan.planned_minutes)} of{" "}
          {minutesLabel(plan.capacity_minutes)} free
        </small>
      </span>
      <Button variant="ghost" disabled={p.pending} onClick={() => p.show(null)}>
        Discard
      </Button>
      <Button variant="primary" disabled={p.pending || empty} onClick={onApply}>
        <Check aria-hidden="true" /> Apply plan
      </Button>
    </div>
  );
}
