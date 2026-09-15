import { useCallback, useRef, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import type { HttpError } from "@orbyn/core";
import { errorText } from "../lib/planning";

export type Outcome = { ok: boolean; text: string } | null;

/**
 * Pending state plus an inline result for one form or card. A 401 still goes
 * to the planner (which signs out); other errors stay next to the button.
 */
export function useAction(report: (e: unknown) => void) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const run = useCallback(async (fn: () => Promise<string | void>) => {
    setPending(true);
    setOutcome(null);
    try {
      const text = await fn();
      if (text) setOutcome({ ok: true, text });
      return true;
    } catch (e) {
      if ((e as HttpError).status === 401) reportRef.current(e);
      else setOutcome({ ok: false, text: errorText(e) });
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, outcome, setOutcome, run };
}

/** The result of the last action, next to where it happened. */
export function OutcomeNote({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return (
    <p
      className={"inline-outcome " + (outcome.ok ? "ok" : "fail")}
      role={outcome.ok ? "status" : "alert"}
    >
      {outcome.ok ? <CircleCheck size={13} /> : <CircleX size={13} />}
      <span>{outcome.text}</span>
    </p>
  );
}
