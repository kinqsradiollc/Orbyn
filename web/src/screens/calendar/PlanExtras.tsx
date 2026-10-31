import {
  atRiskLine,
  dateLabel,
  hoursLabel,
  realityCheck,
  type Item,
  type Plan,
  type WhatIfResult,
  type WorkRecord,
} from "@orbyn/core";
import { FastForward, FlaskConical, Gauge, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  Segmented,
  SelectBox,
  TextArea,
  useToast,
} from "../../ui/kit";
import { spanLabel, whenLabel } from "./format";

/** The plan against how plans have gone lately, in one line. */
export function RealityLine({
  plan,
  timeZone,
}: {
  plan: Plan;
  timeZone: string;
}) {
  const reality = useResource(() => client.planReality(), []);
  const { message, days, note } = realityCheck(
    plan,
    reality.data ?? null,
    timeZone,
  );
  if (reality.error)
    return (
      <ErrorNotice
        message="Couldn't load planning history."
        onRetry={() => void reality.reload()}
      />
    );
  if (!message && !note) return null;
  const stretched = days.some((d) => d.stretch) || !!note?.includes("only");
  return (
    <p className={`calendar-note${stretched ? " is-warn" : ""}`} role="status">
      <Gauge aria-hidden="true" />
      <span>{[message, note].filter(Boolean).join(" ")}</span>
    </p>
  );
}

type Mode = "add" | "off" | "move";
const HOURS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16];

/** Try a change against the coming days before making it. Nothing is saved. */
export function WhatIf({ items, days }: { items: Item[]; days: number }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState(2);
  const [day, setDay] = useState("");
  const [itemId, setItemId] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tasks = items.filter(
    (i) => i.kind === "task" && i.status !== "done" && i.status !== "cancelled",
  );
  const endOf = (d: string) => new Date(`${d}T17:00:00`).toISOString();
  const ready =
    mode === "add"
      ? !!title.trim()
      : mode === "off"
        ? !!day
        : !!itemId && !!day;

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await client.whatIf({
          days: Math.max(days, 7),
          ...(mode === "add"
            ? {
                add_tasks: [
                  {
                    title: title.trim(),
                    estimate_minutes: Math.round(hours * 60),
                    due_at: day ? endOf(day) : null,
                  },
                ],
              }
            : mode === "off"
              ? { days_off: [day] }
              : { move_due: [{ item_id: itemId, due_at: endOf(day) }] }),
        }),
      );
    } catch (failure) {
      setError(messageOf(failure, "Couldn't check that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <FlaskConical aria-hidden="true" /> What if
      </Button>
      {open && (
        <Dialog title="What if" onClose={() => !busy && setOpen(false)}>
          <p className="small muted">Preview only. Nothing is saved.</p>
          <form className="calendar-form" onSubmit={run} aria-busy={busy}>
            <Segmented
              label="What would change"
              value={mode}
              options={[
                { value: "add", label: "New task" },
                { value: "off", label: "Day off" },
                { value: "move", label: "Move deadline" },
              ]}
              onChange={(next) => {
                setMode(next);
                setResult(null);
              }}
            />
            {mode === "add" && (
              <>
                <Field label="Task">
                  <Input
                    dir="auto"
                    maxLength={200}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setResult(null);
                    }}
                  />
                </Field>
                <Field label="Takes">
                  <SelectBox
                    value={String(hours)}
                    onChange={(e) => {
                      setHours(Number(e.target.value));
                      setResult(null);
                    }}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h < 1 ? "30 min" : `${h} h`}
                      </option>
                    ))}
                  </SelectBox>
                </Field>
              </>
            )}
            {mode === "move" && (
              <Field label="Task">
                <SelectBox
                  value={itemId}
                  onChange={(e) => {
                    setItemId(e.target.value);
                    setResult(null);
                  }}
                >
                  <option value="">Choose a task</option>
                  {tasks.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title}
                    </option>
                  ))}
                </SelectBox>
              </Field>
            )}
            <Field
              label={
                mode === "add"
                  ? "Due (optional)"
                  : mode === "off"
                    ? "Day"
                    : "New due date"
              }
            >
              <Input
                type="date"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setResult(null);
                }}
              />
            </Field>
            {error && <ErrorNotice message={error} />}
            {result && (
              <p
                className={`calendar-note${result.newly_late.length ? " is-warn" : ""}`}
                role="status"
              >
                {result.verdict}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!ready}
                busy={busy}
              >
                {busy ? "Checking" : "Check"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

const pct = (r: number | null) =>
  r === null ? "—" : `${Math.round(r * 100)}%`;

function Evidence({ id }: { id: string }) {
  const evidence = useResource(() => client.experimentEvidence(id), [id]);
  if (evidence.error)
    return (
      <ErrorNotice
        message={evidence.error}
        onRetry={() => void evidence.reload()}
      />
    );
  const e = evidence.data;
  if (!e) return <Loading label="Loading evidence" />;
  const rows: [string, string, string][] = [
    ["Plans kept", pct(e.before.kept_rate), pct(e.during.kept_rate)],
    [
      "Focus a week",
      hoursLabel(e.before.focus_minutes_per_week),
      hoursLabel(e.during.focus_minutes_per_week),
    ],
    [
      "Tasks done a week",
      String(e.before.tasks_done_per_week),
      String(e.during.tasks_done_per_week),
    ],
  ];
  return (
    <table className="calendar-evidence">
      <caption className="sr-only">Before and during the experiment</caption>
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">Before</th>
          <th scope="col">During</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, before, during]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{before}</td>
            <td>{during}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A short trial log: what to change, what success means, what happened. */
export function PlanExperiments() {
  const rows = useResource(
    async () =>
      (await client.listWorkRecords({ kind: "experiment", limit: 200 })).filter(
        (r) => r.team_id === null,
      ),
    [],
  );
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState<WorkRecord | null>(null);
  const [title, setTitle] = useState("");
  const [success, setSuccess] = useState("");
  const [review, setReview] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const active = rows.data?.filter((r) => r.status === "open") ?? [];
  const done = rows.data?.filter((r) => r.status === "done") ?? [];

  const act = async (work: () => Promise<unknown>, after: () => void) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await rows.reload();
      after();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save the experiment."));
    } finally {
      setBusy(false);
    }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    void act(
      () =>
        client.createWorkRecord({
          kind: "experiment",
          title: title.trim(),
          details: success.trim(),
          review_at: review
            ? new Date(`${review}T12:00:00`).toISOString()
            : null,
        }),
      () => {
        setTitle("");
        setSuccess("");
        setReview("");
        setAdding(false);
      },
    );
  };

  return (
    <details
      className="calendar-more-section"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Plan experiments ·{" "}
        {rows.data
          ? `${active.length} in progress`
          : rows.error
            ? "Unavailable"
            : "Loading"}
      </summary>
      {rows.error && !rows.data && (
        <ErrorNotice
          message="Couldn't load experiments."
          onRetry={() => void rows.reload()}
        />
      )}
      <Button disabled={busy} onClick={() => setAdding(true)}>
        New experiment
      </Button>
      {rows.data && !active.length && !done.length && (
        <p className="small muted">No experiments yet.</p>
      )}
      {[...active, ...(showAll ? done : done.slice(0, 3))].map((record) => (
        <div key={record.id} className="calendar-experiment">
          <b dir="auto">{record.title}</b>
          <small className="muted">
            {record.status === "done" ? "Completed" : "In progress"}
            {record.review_at && ` · Review ${dateLabel(record.review_at)}`}
          </small>
          <details>
            <summary>Details</summary>
            <p className="small" dir="auto">
              {record.details}
            </p>
            <Evidence id={record.id} />
            {record.outcome && (
              <p className="small" dir="auto">
                {record.outcome}
              </p>
            )}
          </details>
          {record.status === "open" && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOutcome(record.outcome);
                setFinishing(record);
              }}
            >
              Record result
            </Button>
          )}
        </div>
      ))}
      {done.length > 3 && (
        <Button variant="ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? "Show fewer completed"
            : `Show all ${done.length} completed`}
        </Button>
      )}
      {adding && (
        <Dialog
          title="New experiment"
          onClose={() => !busy && setAdding(false)}
        >
          <form className="calendar-form" onSubmit={create} aria-busy={busy}>
            <Field label="What will you try?">
              <Input
                autoFocus
                required
                dir="auto"
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Success criteria">
              <TextArea
                required
                dir="auto"
                maxLength={4000}
                value={success}
                onChange={(e) => setSuccess(e.target.value)}
              />
            </Field>
            <Field label="Review on">
              <Input
                type="date"
                required
                value={review}
                onChange={(e) => setReview(e.target.value)}
              />
            </Field>
            {error && <ErrorNotice message={error} />}
            <div className="dialog-actions">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!title.trim() || !success.trim() || !review}
              >
                Start
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {finishing && (
        <Dialog
          title="Record result"
          onClose={() => !busy && setFinishing(null)}
        >
          <p dir="auto">{finishing.title}</p>
          <Field label="What happened?">
            <TextArea
              dir="auto"
              maxLength={4000}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          </Field>
          {error && <ErrorNotice message={error} />}
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setFinishing(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={!outcome.trim()}
              onClick={() =>
                void act(
                  () =>
                    client.updateWorkRecord(finishing.id, {
                      version: finishing.version,
                      outcome: outcome.trim(),
                      status: "done",
                    }),
                  () => setFinishing(null),
                )
              }
            >
              Finish experiment
            </Button>
          </div>
        </Dialog>
      )}
    </details>
  );
}

/** Unfinished sessions, clashes and tasks at risk, with roll forward. */
export function PlanReview({
  tz,
  busy,
  revision,
  onRoll,
  onChanged,
}: {
  tz: string;
  busy: boolean;
  revision: unknown;
  onRoll: (ids?: string[]) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const review = useResource(() => client.plannerReview(), [revision]);
  const moving = useRef(false);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (moved) void review.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moved]);
  const reschedule = async (id: string) => {
    if (moving.current) return;
    moving.current = true;
    try {
      const saved = await client.rescheduleBlock(id);
      toast({ text: `Moved to ${dateLabel(saved.start_at)}.` });
      setMoved((n) => n + 1);
      onChanged();
    } catch (failure) {
      toast({
        error: true,
        text: messageOf(failure, "Couldn't move that session."),
      });
    } finally {
      moving.current = false;
    }
  };
  const r = review.data;
  const unfinished = r?.unfinished ?? [];
  const conflicts = r?.conflicts ?? [];
  const risk = r?.at_risk ?? [];
  return (
    <section className="calendar-review" aria-label="Review">
      <div className="calendar-side-head">
        <h3>Review</h3>
        <IconButton
          label="Refresh review"
          disabled={review.loading || busy}
          onClick={() => void review.reload()}
        >
          <RefreshCw />
        </IconButton>
      </div>
      {review.error && (
        <ErrorNotice
          message="Couldn't load the review."
          onRetry={() => void review.reload()}
        />
      )}
      {review.loading && !r && <Loading label="Checking your plan" />}
      {r && !unfinished.length && !conflicts.length && !risk.length && (
        <p className="small muted">No clashes or unfinished sessions.</p>
      )}
      {unfinished.length > 0 && (
        <div>
          <div className="calendar-side-head">
            <h4>Unfinished sessions</h4>
            <Button disabled={busy} onClick={() => onRoll()}>
              <FastForward aria-hidden="true" /> Move all forward
            </Button>
          </div>
          {unfinished.map((b) => (
            <div key={b.id} className="calendar-person">
              <span className="row-main">
                <span className="row-title" dir="auto">
                  {b.title}
                </span>
                <small className="muted">
                  {whenLabel(b.start_at, tz)},{" "}
                  {spanLabel(b.start_at, b.end_at, tz)}
                </small>
              </span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onRoll([b.id])}
              >
                Move forward
              </Button>
            </div>
          ))}
        </div>
      )}
      {conflicts.length > 0 && (
        <div>
          <h4>Clashes</h4>
          {conflicts.map(({ block, entry }) => (
            <div key={block.id} className="calendar-person">
              <span className="row-main">
                <span className="row-title" dir="auto">
                  {block.title}
                </span>
                <small className="muted" dir="auto">
                  {dateLabel(block.start_at)} · overlaps {entry.title}
                </small>
              </span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void reschedule(block.id)}
              >
                Reschedule
              </Button>
            </div>
          ))}
        </div>
      )}
      {risk.length > 0 && (
        <div>
          <h4>At risk</h4>
          {risk.map((t) => (
            <p key={t.item_id} className="small" dir="auto">
              {t.title}
              <span className="muted"> · {atRiskLine(t) ?? t.reason}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
