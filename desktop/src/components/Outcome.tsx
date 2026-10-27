import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import type { HttpError } from "@orbyn/core";
import { session } from "../lib/session";
import { errorText } from "../features/planner/planning";

export type Outcome = { ok: boolean; text: string } | null;

/**
 * Pending state plus an inline result for one form or card. A 401 still goes
 * to the planner (which signs out); other errors stay next to the button.
 */
export function useAction(report: (e: unknown) => void) {
  const account = session.get();
  const mutation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const run = useCallback(
    async (fn: () => Promise<string | void>) => {
      if (!mounted.current || mutation.current || session.get() !== account)
        return false;
      const current = () => mounted.current && session.get() === account;
      mutation.current = true;
      setPending(true);
      setOutcome(null);
      try {
        const text = await fn();
        if (!current()) return false;
        if (text) setOutcome({ ok: true, text });
        return true;
      } catch (e) {
        if (!current()) return false;
        if ((e as HttpError).status === 401) reportRef.current(e);
        else if (current()) setOutcome({ ok: false, text: errorText(e) });
        return false;
      } finally {
        mutation.current = false;
        if (current()) setPending(false);
      }
    },
    [account],
  );
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
      {outcome.ok ? (
        <CircleCheck size={13} aria-hidden="true" />
      ) : (
        <CircleX size={13} aria-hidden="true" />
      )}
      <span>{outcome.text}</span>
    </p>
  );
}
