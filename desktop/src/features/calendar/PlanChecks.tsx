import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { FlaskConical, Gauge } from "lucide-react";
import {
  realityCheck,
  type Item,
  type Plan,
  type PlanReality,
  type WhatIfResult,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";
import { errorText } from "../../lib/planning";
import "./plan-checks.css";
import { DateField } from "../../components/DateField";

/**
 * The plan held up against how plans have gone lately, in one line. Says
 * nothing until there's enough history to go on.
 */
export function RealityLine({
  plan,
  timeZone,
}: {
  plan: Plan;
  timeZone: string;
}) {
  const [reality, setReality] = useState<PlanReality | null>(null);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    client.planReality().then(
      (next) => {
        if (alive) setReality(next);
      },
      () => {
        if (alive) {
          setReality(null);
          setError(true);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [version]);
  const { message, days, note } = realityCheck(plan, reality, timeZone);
  if (error)
    return (
      <p className="reality-line" role="alert">
        Couldn't load planning history.
        <button
          className="text-button"
          type="button"
          onClick={() => setVersion((n) => n + 1)}
        >
          Retry
        </button>
      </p>
    );
  if (!message && !note) return null;
  const stretched = days.some((d) => d.stretch) || !!note?.includes("only");
  return (
    <p
      className={"reality-line" + (stretched ? " is-stretch" : "")}
      role="status"
    >
      <Gauge size={14} aria-hidden="true" />
      <span>{[message, note].filter(Boolean).join(" ")}</span>
    </p>
  );
}

type Mode = "add" | "off" | "move";
const HOURS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16];

/**
 * "What if…": try a change against the coming days before making it — a
 * new task, a day off, a deadline moved. The answer is one sentence; nothing
 * is saved.
 */
export function WhatIfBox({ items, days }: { items: Item[]; days: number }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState(2);
  const [day, setDay] = useState("");
  const [itemId, setItemId] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open_ = items.filter(
    (i) => i.kind === "task" && i.status !== "done" && i.status !== "cancelled",
  );
  const endOf = (d: string) => new Date(`${d}T17:00:00`).toISOString();

  const ready =
    mode === "add"
      ? !!title.trim()
      : mode === "off"
        ? !!day
        : !!itemId && !!day;

  const run = async () => {
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
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button
        className="text-button what-if-open"
        onClick={() => setOpen(true)}
      >
        <FlaskConical size={14} /> What if…
      </button>
    );
  return (
    <WhatIfDialog busy={busy} onClose={() => setOpen(false)}>
      <section
        className="what-if"
        aria-labelledby="what-if-title"
        aria-busy={busy}
      >
        <h3 id="what-if-title">
          <FlaskConical size={14} aria-hidden="true" /> What if…
        </h3>
        <p className="muted what-if-scope">
          Preview only. No changes are saved.
        </p>
        <div className="segmented" role="group" aria-label="What would change">
          {(
            [
              ["add", "New task"],
              ["off", "Day off"],
              ["move", "Move deadline"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              aria-pressed={mode === id}
              className={mode === id ? "active" : ""}
              onClick={() => {
                setMode(id);
                setResult(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="what-if-fields">
          {mode === "add" && (
            <>
              <label>
                Task
                <input
                  value={title}
                  disabled={busy}
                  maxLength={200}
                  placeholder="Quarterly report"
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setResult(null);
                  }}
                />
              </label>
              <label>
                Takes
                <Select
                  value={String(hours)}
                  disabled={busy}
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
                </Select>
              </label>
            </>
          )}
          {mode === "move" && (
            <label>
              Task
              <Select
                disabled={busy}
                value={itemId}
                onChange={(e) => {
                  setItemId(e.target.value);
                  setResult(null);
                }}
              >
                <option value="">Choose a task</option>
                {open_.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label>
            {mode === "add"
              ? "Due (optional)"
              : mode === "off"
                ? "Day"
                : "New due date"}
            <DateField
              type="date"
              disabled={busy}
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setResult(null);
              }}
            />
          </label>
        </div>
        <div className="what-if-actions">
          <button
            className="secondary"
            disabled={!ready || busy}
            onClick={() => void run()}
          >
            {busy ? "Checking…" : "Check"}
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p
            className={
              "what-if-verdict" + (result.newly_late.length ? " is-bad" : "")
            }
            role="status"
          >
            {result.verdict}
          </p>
        )}
      </section>
    </WhatIfDialog>
  );
}

function WhatIfDialog({
  busy,
  onClose,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      className="modal what-if-dialog"
      data-modal-focus={focus.id}
      aria-labelledby="what-if-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
