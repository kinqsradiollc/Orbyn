import {
  atRiskLine,
  clockMinutes,
  dayTime,
  dependencyConflict,
  dueDateOf,
  fitTone,
  horizonLanes,
  laneLabel,
  localDateKey,
  moveLine,
  onDay,
  type Item,
  type Plan,
  type PlannedBlock,
  type PlannerPrefs,
  type PlanTask,
} from "@orbyn/core";
import { X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Input, Pill, SelectBox } from "../../ui/kit";
import { dayLong, minutesLabel, spanLabel } from "./format";
import { plural } from "./model";
import type { PlanState } from "./usePlan";

const SHOWN = 20;

type Drag =
  { kind: "block"; block: PlannedBlock } | { kind: "unplaced"; itemId: string };

/** Where a learned length for a task without an estimate came from. */
const guessText = (basis: "similar" | "list" | "tag" | "typical") =>
  basis === "similar"
    ? "like similar tasks"
    : basis === "typical"
      ? "your usual task"
      : `usual for this ${basis}`;

export function PlanResult({
  plan,
  state: p,
  prefs,
  items,
  tz,
  canLookAhead,
  onLookAhead,
  onSeen,
}: {
  plan: Plan;
  state: PlanState;
  prefs: PlannerPrefs;
  items: Item[];
  tz: string;
  canLookAhead: boolean;
  onLookAhead: () => void;
  onSeen: (at: string) => void;
}) {
  const live = !plan.applied;
  const lanes = horizonLanes(plan, tz);
  const today = localDateKey(new Date(), tz);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [allFor, setAllFor] = useState<Set<string>>(() => new Set());
  const moves = plan.moves ?? [];
  const tasks = plan.tasks ?? [];
  const keepFree = p.state?.keepFree ?? [];
  const busy = p.pending;

  const estimateOf = (id: string) =>
    plan.tasks?.find((t) => t.item_id === id)?.estimate_minutes ??
    items.find((i) => i.id === id)?.estimate_minutes ??
    30;

  const moveTo = async (d: Drag, day: string) => {
    if (busy || !p.state) return;
    setNotice("");
    let start: Date;
    let end: Date;
    if (d.kind === "block") {
      if (localDateKey(new Date(d.block.start_at), tz) === day) return;
      ({ start, end } = onDay(d.block, day, tz));
    } else {
      start = dayTime(day, clockMinutes(prefs.work_start), tz);
      end = new Date(
        start.getTime() + Math.min(estimateOf(d.itemId), 240) * 60_000,
      );
    }
    const itemId = d.kind === "block" ? d.block.item_id : d.itemId;
    const clash = dependencyConflict(itemId, start, end, plan, items);
    if (clash) {
      setNotice(clash);
      return;
    }
    if (d.kind === "block") await p.pin(d.block, start, end);
    else
      await p.tune({
        include_item_ids: [
          ...p.state.include.filter((x) => x !== itemId),
          itemId,
        ],
        exclude_item_ids: p.state.exclude.filter((x) => x !== itemId),
        pinned_blocks: [
          ...p.state.pinned,
          {
            item_id: itemId,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
          },
        ],
      });
  };

  const dayOptions = lanes.map((l) => (
    <option key={l.day} value={l.day}>
      {laneLabel(l.day, today)}
    </option>
  ));

  return (
    <div className="calendar-result">
      <div>
        <h3>
          {plural(plan.days, "day")} from {dayLong(plan.starts_on)}
        </h3>
        {plan.summary && (
          <p className="small muted" dir="auto">
            {plan.summary}
          </p>
        )}
      </div>
      {notice && (
        <p className="small field-error" role="alert">
          {notice}
        </p>
      )}
      {lanes.some((l) => l.blocks.length) || plan.unplaced.length ? (
        <ol className="calendar-lanes">
          {lanes.map((lane) => {
            const shown = allFor.has(lane.day)
              ? lane.blocks
              : lane.blocks.slice(0, SHOWN);
            return (
              <li
                key={lane.day}
                className={over === lane.day ? "is-over" : undefined}
                onDragOver={(e) => {
                  if (!drag || busy) return;
                  e.preventDefault();
                  setOver(lane.day);
                }}
                onDragLeave={() => setOver((o) => (o === lane.day ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  if (drag) void moveTo(drag, lane.day);
                  setDrag(null);
                }}
              >
                <div className="calendar-lane-head">
                  <b>{laneLabel(lane.day, today)}</b>
                  <small className="muted">
                    {lane.minutes ? minutesLabel(lane.minutes) : "Free"}
                  </small>
                </div>
                {shown.map((b) => (
                  <div
                    key={`${b.item_id}-${b.start_at}`}
                    className={`calendar-lane-row${b.pinned ? " is-pinned" : ""}`}
                    draggable={live && !busy}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", b.item_id);
                      setDrag({ kind: "block", block: b });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                  >
                    <span className="row-main">
                      <span className="row-title" dir="auto">
                        {b.title}
                        {b.parts > 1 ? ` (${b.part}/${b.parts})` : ""}
                      </span>
                      <small className="muted">
                        {spanLabel(b.start_at, b.end_at, tz)}
                        {b.frame_name ? ` · ${b.frame_name}` : ""}
                        {b.pinned ? " · pinned" : ""}
                      </small>
                    </span>
                    {live && plan.days > 1 && (
                      <select
                        className="calendar-mini"
                        aria-label={`Move ${b.title} to`}
                        value={lane.day}
                        disabled={busy}
                        onChange={(e) =>
                          void moveTo(
                            { kind: "block", block: b },
                            e.target.value,
                          )
                        }
                      >
                        {dayOptions}
                      </select>
                    )}
                  </div>
                ))}
                {lane.blocks.length > SHOWN && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setAllFor((was) => {
                        const next = new Set(was);
                        if (next.has(lane.day)) next.delete(lane.day);
                        else next.add(lane.day);
                        return next;
                      })
                    }
                  >
                    {allFor.has(lane.day)
                      ? "Show fewer"
                      : `Show all ${lane.blocks.length} sessions`}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        !moves.length &&
        !plan.at_risk.length && (
          <p className="small muted">Nothing could be placed in this plan.</p>
        )
      )}
      {plan.applied && plan.blocks.length > 0 && (
        <Button variant="ghost" onClick={() => onSeen(plan.blocks[0].start_at)}>
          Show on calendar
        </Button>
      )}
      {moves.length > 0 && (
        <details className="calendar-more-section" open>
          <summary>
            Move sessions before their deadline · {moves.length}
          </summary>
          <div className="calendar-checks">
            {moves.map((m) => (
              <label key={m.block_id} className="check">
                <input
                  type="checkbox"
                  checked={p.ticks[m.block_id] ?? m.selected}
                  disabled={busy || !live}
                  onChange={(e) => p.setTick(m.block_id, e.target.checked)}
                />
                <span dir="auto">{moveLine(m)}</span>
              </label>
            ))}
          </div>
        </details>
      )}
      {plan.at_risk.length > 0 && (
        <div className="calendar-flags is-risk">
          <h4>At risk</h4>
          {plan.at_risk.map((t) => {
            const line = atRiskLine(t);
            return (
              <p key={t.item_id} className="small" dir="auto">
                {t.title}
                <span className="muted">
                  {line
                    ? ` · ${line}`
                    : `${dueDateOf(t) ? ` · due ${dueDateOf(t)}` : ""} · ${t.reason}`}
                </span>
              </p>
            );
          })}
          {canLookAhead && (
            <Button variant="ghost" disabled={busy} onClick={onLookAhead}>
              Look further ahead
            </Button>
          )}
        </div>
      )}
      {plan.unplaced.length > 0 && (
        <div className="calendar-flags">
          <h4>Didn't fit</h4>
          {plan.unplaced.map((u) => (
            <div
              key={u.item_id}
              className="calendar-lane-row"
              draggable={live && !busy}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", u.item_id);
                setDrag({ kind: "unplaced", itemId: u.item_id });
              }}
              onDragEnd={() => setDrag(null)}
            >
              <span className="row-main">
                <span className="row-title" dir="auto">
                  {u.title}
                </span>
                <small className="muted">{u.reason}</small>
              </span>
              {live && (
                <select
                  className="calendar-mini"
                  aria-label={`Put ${u.title} on`}
                  value=""
                  disabled={busy}
                  onChange={(e) =>
                    e.target.value &&
                    void moveTo(
                      { kind: "unplaced", itemId: u.item_id },
                      e.target.value,
                    )
                  }
                >
                  <option value="">Put on</option>
                  {dayOptions}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      {live && tasks.length > 0 && (
        <details className="calendar-more-section">
          <summary>
            Tasks considered · {tasks.filter((t) => t.included).length} of{" "}
            {tasks.length}
          </summary>
          <div className="rows">
            {tasks.map((t) => (
              <TaskRow key={t.item_id} task={t} plan={p} />
            ))}
          </div>
        </details>
      )}
      {live && (
        <details className="calendar-more-section">
          <summary>Keep free · {keepFree.length}</summary>
          {keepFree.map((r) => (
            <div key={r.start_at + r.end_at} className="calendar-person">
              <span className="row-main small">
                {dayLong(localDateKey(new Date(r.start_at), tz))},{" "}
                {spanLabel(r.start_at, r.end_at, tz)}
              </span>
              <IconButton
                label={`Stop keeping ${spanLabel(r.start_at, r.end_at, tz)} free`}
                disabled={busy}
                onClick={() => void p.dropKeepFree(r)}
              >
                <X />
              </IconButton>
            </div>
          ))}
          <p className="small muted">
            Drag empty time to keep it free, or drag a session to pin it.
          </p>
        </details>
      )}
    </div>
  );
}

function TaskRow({ task: t, plan: p }: { task: PlanTask; plan: PlanState }) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(t.estimate_minutes ?? 30);
  const [save, setSave] = useState(false);
  const busy = p.pending;
  const warn = t.fit && t.included && fitTone(t.fit.status) === "warn";
  return (
    <div className={`calendar-task${t.included ? "" : " is-out"}`}>
      <label className="check">
        <input
          type="checkbox"
          checked={t.included}
          disabled={busy}
          onChange={(e) => void p.setIncluded(t.item_id, e.target.checked)}
        />
        <span className="row-main">
          <span className="row-title" dir="auto">
            {t.title}
          </span>
          <small className="muted">
            {t.included
              ? `${minutesLabel(t.planned_minutes)} planned`
              : "Left out"}
            {dueDateOf(t) && ` · due ${dueDateOf(t)}`}
            {t.reason && ` · ${t.reason}`}
          </small>
        </span>
      </label>
      {warn ? (
        <Pill tone="amber">{t.fit?.label}</Pill>
      ) : (
        t.at_risk && <Pill tone="amber">At risk</Pill>
      )}
      {editing ? (
        <form
          className="calendar-estimate"
          onSubmit={(e) => {
            e.preventDefault();
            void p.setEstimate(t.item_id, minutes, save);
            setEditing(false);
          }}
        >
          <Input
            type="number"
            min={1}
            max={10080}
            required
            autoFocus
            aria-label={`Minutes to plan for ${t.title}`}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
          <label className="check small">
            <input
              type="checkbox"
              checked={save}
              onChange={(e) => setSave(e.target.checked)}
            />
            Save to the task
          </label>
          <Button type="submit">Use</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          disabled={busy}
          aria-label={`Change the estimate for ${t.title}`}
          onClick={() => {
            setMinutes(t.estimate_minutes ?? 30);
            setEditing(true);
          }}
        >
          {t.estimate_minutes ? minutesLabel(t.estimate_minutes) : "30 min?"}
          {t.estimate_tuned
            ? " (tuned)"
            : t.estimate_guess
              ? ` (${guessText(t.estimate_guess.basis)})`
              : ""}
        </Button>
      )}
    </div>
  );
}
