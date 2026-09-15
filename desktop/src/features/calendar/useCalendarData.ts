import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarView } from "@orbyn/core";
import { client } from "../../lib/api";

/**
 * Everything on the calendar in [from, to): occurrences, time blocks, buffers
 * and travel. Reloads when the range changes and after planner refreshes.
 */
export function useCalendarData(
  from: Date,
  to: Date,
  revision: number,
  report: (e: unknown) => void,
) {
  const [data, setData] = useState<CalendarView | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const next = await client.calendar(fromIso, toIso);
      if (mine === seq.current) setData(next);
    } catch (e) {
      if (mine === seq.current) reportRef.current(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [fromIso, toIso]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  return { data, loading, reload, setData };
}
