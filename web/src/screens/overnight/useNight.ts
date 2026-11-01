import { HttpError, type OvernightNight } from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import { useConfirm } from "../../ui/kit";
import { onForeground, onLive, useOwned } from "../agents-shared/hooks";

export type NightAction = {
  label: string;
  destination?: string;
  /** Compare the exact evidence displayed before asking for confirmation. */
  matches: (current: OvernightNight) => boolean;
  perform: () => Promise<unknown>;
  receipt?: (value: unknown) => boolean;
  /** A current exact resource state may establish only its explicitly supported outcome. */
  reconcile?: (current: OvernightNight) => string | null;
  confirm?: { title: string; body: string; action: string; danger?: boolean };
};
type Command = { action: NightAction; unknown: boolean };
export const bulkRuns = (night: OvernightNight, action: "keep" | "undo") =>
  night.runs
    .filter(
      (run) =>
        !run.restricted &&
        run.kind !== "reflection" &&
        (action === "keep"
          ? run.state === "done" && run.status !== "undone"
          : run.state === "done" || run.state === "failed"),
    )
    .map((run) => ({ id: run.id, token: run.decision_token }));

/** One reader and one decision owner. A missing write receipt never becomes a new command. */
export function useNight(nightId?: string) {
  const owned = useOwned(),
    confirm = useConfirm();
  const [night, setNight] = useState<OvernightNight | null>(null);
  const current = useRef<OvernightNight | null>(null);
  const [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [loadError, setLoadError] = useState(""),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState("");
  const sequence = useRef(0),
    operation = useRef(false),
    queued = useRef(false);
  const active = useRef<Promise<OvernightNight | null> | null>(null);
  const command = useRef<Command | null>(null);
  const lastReadAt = useRef(0);
  const hasRead = useRef(false);
  const read = useCallback(
    (
      invalidate = true,
      duringMutation = false,
    ): Promise<OvernightNight | null> => {
      if (!owned()) return Promise.resolve(null);
      if (operation.current && !duringMutation) {
        queued.current = true;
        return Promise.resolve(null);
      }
      if (active.current) {
        if (invalidate) {
          sequence.current++;
          queued.current = true;
        }
        return active.current;
      }
      const execute = async () => {
        let result: OvernightNight | null = null;
        do {
          queued.current = false;
          const mine = ++sequence.current;
          lastReadAt.current = Date.now();
          if (owned()) setLoading(true);
          try {
            result = await client.latestAssistantNight(nightId);
            if (result && nightId && result.id !== nightId)
              throw new Error("The saved night doesn't match this address.");
            if (owned() && mine === sequence.current) {
              hasRead.current = true;
              current.current = result;
              setNight(result);
              setFresh(true);
              setLoaded(true);
              setLoadError("");
            } else result = null;
          } catch (failure) {
            if (owned() && mine === sequence.current) {
              setFresh(false);
              setLoaded(true);
              setLoadError(
                messageOf(
                  failure,
                  "Couldn't refresh this night. Refresh before making a decision.",
                ),
              );
              if (
                failure instanceof HttpError &&
                [401, 403, 404].includes(failure.statusCode)
              ) {
                current.current = null;
                setNight(null);
              }
            }
            result = null;
          }
        } while (queued.current && owned() && !operation.current);
        return result;
      };
      const pending = execute().finally(() => {
        if (active.current === pending) active.current = null;
        if (owned()) setLoading(false);
      });
      active.current = pending;
      return pending;
    },
    [nightId, owned],
  );
  useEffect(() => {
    let passive: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!owned() || document.hidden) return;
      if (operation.current) {
        queued.current = true;
        return;
      }
      // Fence the in-flight pre-event snapshot immediately, then coalesce bursts.
      sequence.current++;
      if (passive !== undefined) return;
      const delay = hasRead.current
        ? Math.max(160, lastReadAt.current + 5000 - Date.now())
        : 160;
      passive = setTimeout(() => {
        passive = undefined;
        if (owned() && !document.hidden) void read();
      }, delay);
    };
    void read(false);
    const timer = setInterval(() => {
      if (!document.hidden) void read(false);
    }, 15_000);
    const foreground = onForeground(schedule);
    const live = onLive((news) => {
      if (news.kind === "changed" && (!news.area || news.area === "assistant"))
        schedule();
    });
    return () => {
      sequence.current++;
      queued.current = false;
      clearInterval(timer);
      clearTimeout(passive);
      foreground();
      live();
    };
  }, [read, owned]);
  const execute = async (saved: Command): Promise<boolean> => {
    let dispatched = false;
    try {
      {
        if (saved.action.confirm && !(await confirm(saved.action.confirm)))
          return false;
        if (!owned()) return false;
        // Drain any earlier read, then obtain new authority before dispatch.
        await active.current;
        if (!owned()) return false;
        const authoritative = await read(true, true);
        if (!owned()) return false;
        if (!authoritative || !saved.action.matches(authoritative)) {
          setActionError(
            "This work changed after you reviewed it. Review the refreshed night before trying again.",
          );
          return false;
        }
        command.current = saved;
      }
      if (!owned()) return false;
      dispatched = true;
      // These endpoints reject generic Idempotency-Key headers. This is the
      // original dispatch only; missing receipts are reconciled with reads.
      const receipt = await saved.action.perform();
      if (!owned()) return false;
      if (saved.action.receipt && !saved.action.receipt(receipt))
        throw new Error("The action receipt doesn't match the reviewed work.");
      command.current = null;
      setUnknown(false);
      setFresh(false);
      setNotice(`${saved.action.label}: saved. Refreshing the night…`);
      await active.current;
      if (!owned()) return false;
      const refreshed = await read(true, true);
      if (owned())
        setNotice(
          refreshed
            ? `${saved.action.label}: saved and refreshed.`
            : `${saved.action.label}: saved. The night could not be refreshed; further decisions are blocked.`,
        );
      return true;
    } catch (failure) {
      if (owned()) {
        const status = failure instanceof HttpError ? failure.statusCode : 0;
        const uncertain =
          saved.unknown ||
          (dispatched &&
            (!status || status >= 500 || status === 408 || status === 429));
        if (uncertain) {
          saved.unknown = true;
          command.current = saved;
          setUnknown(true);
        } else command.current = null;
        setFresh(false);
        setActionError(
          uncertain
            ? `${saved.action.label}: the receipt is missing. Check its saved state before making another decision. This action will not be resent.`
            : messageOf(
                failure,
                `Couldn't finish ${saved.action.label.toLowerCase()}. Refresh before trying again.`,
              ),
        );
      }
      return false;
    } finally {
      operation.current = false;
      if (owned()) setBusy(false);
    }
  };
  const act = async (action: NightAction) => {
    if (
      !owned() ||
      operation.current ||
      command.current ||
      !fresh ||
      !current.current
    )
      return false;
    operation.current = true;
    sequence.current++;
    setBusy(true);
    setActionError("");
    setNotice("");
    return execute({ action, unknown: false });
  };
  const check = async () => {
    const saved = command.current;
    if (!owned() || operation.current || !saved?.unknown) return;
    operation.current = true;
    sequence.current++;
    setBusy(true);
    try {
      await active.current;
      if (!owned()) return;
      const snapshot = await read(true, true);
      if (!owned()) return;
      if (!snapshot) {
        setActionError(
          "The saved night couldn't be read. This original decision remains unknown and has not been resent.",
        );
        return;
      }
      const proof = saved.action.reconcile?.(snapshot);
      if (proof) {
        command.current = null;
        setUnknown(false);
        setActionError("");
        setNotice(proof);
      } else
        setActionError(
          "The saved state has been checked, but it cannot confirm this original decision. Further night decisions remain blocked. Open the exact work or Review item to inspect its outcome; this action has not been resent.",
        );
    } finally {
      operation.current = false;
      if (owned()) setBusy(false);
    }
  };
  return {
    night,
    loaded,
    loading,
    busy,
    unknown,
    unknownDestination: command.current?.action.destination,
    fresh,
    loadError,
    actionError,
    notice,
    locked: busy || unknown || !fresh,
    refresh: () => read(),
    act,
    check,
  };
}
