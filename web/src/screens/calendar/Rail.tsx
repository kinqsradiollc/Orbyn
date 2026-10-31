import {
  checkInNote,
  dueDateOf,
  isClosed,
  latestDates,
  priorityScore,
  rowFitChip,
  SESSION_OUTCOME_LABELS,
  shortMinutes,
  stillToPlan,
  stillToPlanLabel,
  type Item,
  type SessionCheckIn,
  type SessionOutcome,
} from "@orbyn/core";
import { CalendarPlus, GripVertical } from "lucide-react";
import { useMemo, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import { Button, ErrorNotice, IconButton, Loading, Pill } from "../../ui/kit";
import { minutesLabel, spanLabel, whenLabel } from "./format";
import { TASK_MIME } from "./model";
import type { Workspace } from "./useWorkspace";

const SHOWN = 12;
const MORE = [15, 30, 60, 120];

/** Open tasks that still need time, most pressing first. */
function toPlace(items: Item[], planned: Workspace["plannedById"]) {
  const now = new Date();
  const latest = latestDates(items);
  const score = (i: Item) =>
    priorityScore(
      latest.has(i.id) ? { ...i, deadline_at: latest.get(i.id) } : i,
      now,
    );
  return items
    .filter(
      (i) =>
        i.kind === "task" &&
        !isClosed(i.status) &&
        stillToPlan(planned.get(i.id)) !== 0,
    )
    .sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title));
}

export function TasksToPlace({
  workspace,
  onSchedule,
}: {
  workspace: Workspace;
  onSchedule: (item: Item) => void;
}) {
  const [all, setAll] = useState(false);
  const {
    items,
    plannedById,
    itemsLoading,
    error: itemsError,
    retry,
  } = workspace;
  const open = useMemo(() => toPlace(items, plannedById), [items, plannedById]);
  const shown = all ? open : open.slice(0, SHOWN);
  return (
    <section className="calendar-side-section" aria-labelledby="calendar-place">
      <div className="calendar-side-head">
        <h2 id="calendar-place">
          Tasks to place{" "}
          {open.length > 0 && <span className="muted">{open.length}</span>}
        </h2>
      </div>
      {itemsError && !items.length ? (
        <ErrorNotice
          message="Couldn't load your tasks."
          onRetry={() => void retry()}
        />
      ) : itemsLoading ? (
        <Loading label="Loading tasks" />
      ) : !shown.length ? (
        <p className="small muted">No tasks need more planned time.</p>
      ) : (
        <div className="rows">
          {shown.map((i) => {
            const need = stillToPlan(plannedById.get(i.id));
            const size =
              need != null
                ? stillToPlanLabel(need)
                : i.estimate_minutes
                  ? minutesLabel(i.estimate_minutes)
                  : "No estimate · 30 min";
            const due = dueDateOf(i);
            const chip = rowFitChip(plannedById.get(i.id)?.fit);
            return (
              <div
                key={i.id}
                className="calendar-place"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TASK_MIME, i.id);
                  e.dataTransfer.setData("text/plain", i.title);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <GripVertical aria-hidden="true" />
                <span className="row-main">
                  <span className="row-title" dir="auto">
                    {i.title}
                  </span>
                  <small className="muted">
                    {due ? `${size} · due ${due}` : size}
                  </small>
                  {chip?.tone === "warn" && (
                    <Pill tone="amber">{chip.text}</Pill>
                  )}
                </span>
                <IconButton
                  label={`Plan a session for ${i.title}`}
                  onClick={() => onSchedule(i)}
                >
                  <CalendarPlus />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      {open.length > SHOWN && (
        <Button variant="ghost" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${open.length}`}
        </Button>
      )}
    </section>
  );
}

/**
 * Sessions that ended and how each went. "Done" and "Need more" count their
 * time toward the task once; a past session is never assumed done.
 */
export function CheckIns({
  tz,
  version,
  onOpen,
  onPlanIt,
  onChanged,
}: {
  tz: string;
  version: unknown;
  onOpen: (itemId: string) => void;
  onPlanIt: (itemId: string) => void;
  onChanged: () => void;
}) {
  const list = useResource(() => client.sessionCheckIns(), [version]);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [said, setSaid] = useState<{
    item: string;
    text: string;
    plan: boolean;
  } | null>(null);
  const rows = list.data ?? [];

  const answer = async (
    s: SessionCheckIn,
    outcome: SessionOutcome,
    more?: number,
  ) => {
    if (busy) return;
    setBusy(s.id);
    setError("");
    try {
      const r = await client.checkInSession(s.id, {
        outcome,
        ...(more ? { more_minutes: more } : {}),
      });
      list.set((l) => l?.filter((x) => x.id !== s.id));
      setAsking(null);
      setSaid({
        item: s.item_id,
        text: `${s.title}: ${checkInNote(outcome, r.counted_minutes)}`,
        plan: outcome !== "done",
      });
      onChanged();
    } catch (failure) {
      setError(
        messageOf(failure, "Couldn't save that. Try the check-in again."),
      );
    } finally {
      setBusy(null);
    }
  };

  if (list.error && !list.data)
    return (
      <ErrorNotice
        message="Couldn't load session check-ins."
        onRetry={() => void list.reload()}
      />
    );
  if (!rows.length && !said) return null;
  return (
    <section
      className="calendar-side-section"
      aria-labelledby="calendar-checkin"
    >
      <div className="calendar-side-head">
        <h2 id="calendar-checkin">
          How did it go?{" "}
          {rows.length > 0 && <span className="muted">{rows.length}</span>}
        </h2>
      </div>
      {error && <ErrorNotice message={error} />}
      {said && (
        <p className="calendar-note" role="status">
          <span dir="auto">{said.text}</span>
          {said.plan && (
            <Button variant="ghost" onClick={() => onPlanIt(said.item)}>
              Plan it
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSaid(null)}>
            OK
          </Button>
        </p>
      )}
      <div className="rows">
        {rows.map((s) => (
          <div key={s.id} className="calendar-checkin">
            <button
              type="button"
              className="row"
              aria-label={`Open ${s.title}`}
              onClick={() => onOpen(s.item_id)}
            >
              <span className="row-main">
                <span className="row-title" dir="auto">
                  {s.title}
                </span>
                <small className="muted">
                  {whenLabel(s.start_at, tz)}{" "}
                  {spanLabel(s.start_at, s.end_at, tz)} ·{" "}
                  {shortMinutes(s.minutes)}
                  {s.project_name ? ` · ${s.project_name}` : ""}
                </small>
              </span>
            </button>
            {asking === s.id ? (
              <div
                className="calendar-answers"
                role="group"
                aria-label={`How much more ${s.title} needs`}
              >
                {MORE.map((m) => (
                  <Button
                    key={m}
                    disabled={!!busy}
                    onClick={() => void answer(s, "more", m)}
                  >
                    +{shortMinutes(m)}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div
                className="calendar-answers"
                role="group"
                aria-label={`How ${s.title} went`}
              >
                <Button
                  disabled={!!busy}
                  onClick={() => void answer(s, "done")}
                >
                  {SESSION_OUTCOME_LABELS.done}
                </Button>
                <Button disabled={!!busy} onClick={() => setAsking(s.id)}>
                  {SESSION_OUTCOME_LABELS.more}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => void answer(s, "skipped")}
                >
                  {SESSION_OUTCOME_LABELS.skipped}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
