import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import type { Plan } from "@orbyn/core";
import { client } from "../lib/api";

const POLL_MS = 30_000;

/**
 * True once the calendar, frames, hours or tasks changed since `plan` was
 * made (or it expired or was replaced). Checked as soon as a plan arrives,
 * again whenever `recheck` changes (pass the calendar data so every reload
 * checks), and every 30 seconds while the app is open. Resets when another
 * plan arrives. `markStale` flags it straight away, e.g. after a 409.
 */
export function usePlanStale(plan: Plan | null, recheck?: unknown) {
  const [stale, setStale] = useState(false);
  const id = plan && !plan.applied ? plan.id : null;

  useEffect(() => {
    setStale(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const check = () => {
      if (AppState.currentState !== "active") return;
      client
        .planStale(id)
        .then((r) => alive && setStale(r.stale))
        .catch(() => {
          // Older servers can't tell; the plan just never looks stale.
        });
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, recheck]);

  const markStale = useCallback(() => setStale(true), []);
  return [stale, markStale] as const;
}
