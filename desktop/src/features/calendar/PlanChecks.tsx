import { useEffect, useState } from "react";
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
  useEffect(() => {
    client.planReality().then(setReality, () => setReality(null));
  }, []);
  const { message, days, note } = realityCheck(plan, reality, timeZone);
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
    <section className="what-if" aria-labelledby="what-if-title">
      <h3 id="what-if-title">
        <FlaskConical size={14} aria-hidden="true" /> What if…
      </h3>
      <div className="segmented" role="group" aria-label="What would change">
        {(
          [
            ["add", "I take on a task"],
            ["off", "I take a day off"],
            ["move", "A deadline moves"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
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
                maxLength={200}
                placeholder="Quarterly report"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Takes
              <Select
                value={String(hours)}
                onChange={(e) => setHours(Number(e.target.value))}
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
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
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
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
      </div>
      <div className="what-if-actions">
        <button
          className="secondary"
          disabled={!ready || busy}
          onClick={() => void run()}
        >
          {busy ? "Working it out…" : "Check"}
        </button>
        <button className="text-button" onClick={() => setOpen(false)}>
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
          {result.verdict} <small>Nothing was changed.</small>
        </p>
      )}
    </section>
  );
}
