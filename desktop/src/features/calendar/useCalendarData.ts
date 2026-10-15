import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { CalendarView } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";

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
  const account = session.get();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const identity = `${account}:${fromIso}:${toIso}`;
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const [receipt, setReceipt] = useState<{
    identity: string;
    data: CalendarView | null;
  } | null>(null);
  const [status, setStatus] = useState({
    identity,
    loading: true,
    failed: false,
  });
  const data = receipt?.identity === identity ? receipt.data : null;
  const loading = status.identity === identity ? status.loading : true;
  const failed = status.identity === identity && status.failed;
  const setData: Dispatch<SetStateAction<CalendarView | null>> = useCallback(
    (next) => {
      if (latestIdentity.current !== identity || session.get() !== account)
        return;
      setReceipt((previous) => ({
        identity,
        data:
          typeof next === "function"
            ? next(previous?.identity === identity ? previous.data : null)
            : next,
      }));
    },
    [identity, account],
  );
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current++;
    };
  }, []);
  const reportRef = useRef(report);
  reportRef.current = report;
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const current = () =>
      alive.current &&
      mine === seq.current &&
      account === session.get() &&
      latestIdentity.current === identity;
    if (!current()) return;
    setStatus({ identity, loading: true, failed: false });
    try {
      const next = await client.calendar(fromIso, toIso);
      if (current()) setData(next);
    } catch (e) {
      if (current()) {
        setStatus({ identity, loading: false, failed: true });
        reportRef.current(e);
      }
    } finally {
      if (current())
        setStatus((previous) => ({ ...previous, identity, loading: false }));
    }
  }, [fromIso, toIso, identity, account, setData]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  return { data, loading, failed, reload, setData };
}
