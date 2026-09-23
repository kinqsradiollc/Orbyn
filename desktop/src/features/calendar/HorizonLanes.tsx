import { useState } from "react";
import { GripVertical, Inbox } from "lucide-react";
import {
  clockMinutes,
  dayTime,
  dependencyConflict,
  horizonLanes,
  laneLabel,
  localDateKey,
  onDay,
  type Item,
  type Plan,
  type PlannedBlock,
  type PlannerPrefs,
} from "@orbyn/core";
import { Select } from "../../components/Select";
import { minutesLabel, spanLabel } from "../../lib/planning";
import type { PlanTuning } from "./usePlanTuning";
import "./horizon.css";

type Drag =
  | { kind: "block"; block: PlannedBlock }
  | { kind: "unplaced"; itemId: string; title: string };

/**
 * The plan as days ahead: a lane per day with its sessions. Drag a session
 * to another day — or use its "Move to" menu — and it's pinned there at the
 * same time while the rest is planned around it. Tasks the plan couldn't
 * place wait in a tray and can be put on a day the same way. A move that
 * would start a task before what it waits on is refused, with the reason.
 */
export function HorizonLanes({
  plan,
  prefs,
  items,
  tuner,
}: {
  plan: Plan;
  prefs: PlannerPrefs | null;
  items: Item[];
  tuner: PlanTuning;
}) {
  const zone = prefs?.timezone ?? plan.options?.timezone ?? "UTC";
  const lanes = horizonLanes(plan, zone);
  const today = localDateKey(new Date(), zone);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const estimateOf = (itemId: string) =>
    plan.tasks?.find((t) => t.item_id === itemId)?.estimate_minutes ??
    items.find((i) => i.id === itemId)?.estimate_minutes ??
    30;

  const move = async (d: Drag, day: string) => {
    setNotice("");
    let start: Date;
    let end: Date;
    if (d.kind === "block") {
      if (localDateKey(new Date(d.block.start_at), zone) === day) return;
      ({ start, end } = onDay(d.block, day, zone));
    } else {
      start = dayTime(day, clockMinutes(prefs?.work_start ?? "09:00"), zone);
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
    if (d.kind === "block") await tuner.pin(d.block, start, end);
    else if (tuner.state)
      await tuner.tune({
        include_item_ids: [
          ...tuner.state.include.filter((x) => x !== itemId),
          itemId,
        ],
        exclude_item_ids: tuner.state.exclude.filter((x) => x !== itemId),
        pinned_blocks: [
          ...tuner.state.pinned,
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
    <section className="horizon" aria-labelledby="horizon-title">
      <div className="planner-review-head">
        <h3 id="horizon-title">Days ahead</h3>
        <small className="muted">
          Drag a session to another day, or use Move to.
        </small>
      </div>
      {notice && (
        <p className="horizon-notice" role="alert">
          {notice}
        </p>
      )}
      <ol className="horizon-lanes">
        {lanes.map((lane) => (
          <li
            key={lane.day}
            className={"horizon-lane" + (over === lane.day ? " is-over" : "")}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              setOver(lane.day);
            }}
            onDragLeave={() => setOver((o) => (o === lane.day ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (drag) void move(drag, lane.day);
              setDrag(null);
            }}
          >
            <div className="horizon-day">
              <strong>{laneLabel(lane.day, today)}</strong>
              <small>
                {lane.minutes ? minutesLabel(lane.minutes) : "Free"}
              </small>
            </div>
            <ul className="horizon-blocks">
              {lane.blocks.map((b) => (
                <li
                  key={`${b.item_id}-${b.start_at}`}
                  className={"horizon-block" + (b.pinned ? " is-pinned" : "")}
                  draggable={!tuner.pending}
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
                  <GripVertical size={13} aria-hidden="true" />
                  <span className="horizon-block-text">
                    <strong>
                      {b.title}
                      {b.parts > 1 ? ` (${b.part}/${b.parts})` : ""}
                    </strong>
                    <small>
                      {spanLabel(b.start_at, b.end_at)}
                      {b.pinned ? " · pinned" : ""}
                    </small>
                  </span>
                  <label className="horizon-move">
                    <span className="sr-only">Move {b.title} to</span>
                    <Select
                      value={lane.day}
                      disabled={tuner.pending}
                      onChange={(e) =>
                        void move({ kind: "block", block: b }, e.target.value)
                      }
                    >
                      {dayOptions}
                    </Select>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {plan.unplaced.length > 0 && (
        <div className="horizon-tray" aria-label="Not placed yet">
          <h4>
            <Inbox size={14} aria-hidden="true" /> Not placed yet
          </h4>
          <ul>
            {plan.unplaced.map((u) => (
              <li
                key={u.item_id}
                className="horizon-block is-unplaced"
                draggable={!tuner.pending}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", u.item_id);
                  setDrag({
                    kind: "unplaced",
                    itemId: u.item_id,
                    title: u.title,
                  });
                }}
                onDragEnd={() => setDrag(null)}
              >
                <GripVertical size={13} aria-hidden="true" />
                <span className="horizon-block-text">
                  <strong>{u.title}</strong>
                  <small>{u.reason}</small>
                </span>
                <label className="horizon-move">
                  <span className="sr-only">Put {u.title} on</span>
                  <Select
                    value=""
                    disabled={tuner.pending}
                    onChange={(e) =>
                      e.target.value &&
                      void move(
                        { kind: "unplaced", itemId: u.item_id, title: u.title },
                        e.target.value,
                      )
                    }
                  >
                    <option value="">Put on…</option>
                    {dayOptions}
                  </Select>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
