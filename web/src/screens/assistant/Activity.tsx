import type { ChatTraceEntry } from "@orbyn/core";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { traceWords } from "../agents-shared/words";

export function duration(ms: number) {
  const secs = Math.max(1, Math.round(ms / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Recorded steps of a finished turn, folded under how long it worked. */
export function TurnTrace({
  trace,
  status,
}: {
  trace: readonly ChatTraceEntry[];
  status?: string;
}) {
  const [open, setOpen] = useState(false);
  const lines = traceWords([...trace]);
  if (!lines.length && !status) return null;
  const times = trace
    .map((entry) => Date.parse(entry.at))
    .filter(Number.isFinite);
  const span =
    times.length > 1 ? Math.max(...times) - Math.min(...times) : null;
  const label = [
    span !== null ? `Worked for ${duration(span)}` : "Steps",
    status,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="assistant-trace">
      {lines.length > 0 ? (
        <button
          type="button"
          className="assistant-trace-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
          {label}
        </button>
      ) : (
        <span className="assistant-trace-toggle">{label}</span>
      )}
      {open && (
        <ol className="assistant-trace-steps">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The run in progress: elapsed time and each progress label as it arrives. */
export function LiveWork({
  started,
  steps,
  waiting,
}: {
  started: number;
  steps: string[];
  waiting: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="assistant-trace" role="status">
      <span className="assistant-trace-toggle">
        <LoaderCircle className="assistant-spin" aria-hidden="true" />
        {waiting ? "Waiting for you" : "Working"} ·{" "}
        {duration(Math.max(1000, now - started))}
      </span>
      {steps.length > 0 && (
        <ol className="assistant-trace-steps" aria-live="off">
          {steps.map((step, index) => (
            <li key={`${index}:${step}`} className="assistant-in">
              {step}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const still = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Shows a just-arrived answer a few words at a time; history renders whole. */
export function useReveal(text: string | null) {
  const [shown, setShown] = useState(0);
  const words = text?.match(/\S+\s*/g) ?? [];
  const total = words.length;
  useEffect(() => {
    setShown(0);
    if (!text || still()) {
      setShown(Number.MAX_SAFE_INTEGER);
      return;
    }
    // Long answers speed up so none takes much more than five seconds.
    const step = Math.max(1, Math.ceil(total / 140));
    const timer = setInterval(
      () =>
        setShown((value) => {
          if (value + step >= total) clearInterval(timer);
          return value + step;
        }),
      35,
    );
    return () => clearInterval(timer);
  }, [text, total]);
  return {
    done: !text || shown >= total,
    text: text && shown < total ? words.slice(0, shown).join("") : text,
  };
}
