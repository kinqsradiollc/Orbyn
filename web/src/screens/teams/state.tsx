import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HttpError } from "@orbyn/core";
import { client, getSessionVersion, getToken } from "../../lib/session";
import { onBeforeNavigate } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { Button, ErrorNotice, useConfirm } from "../../ui/kit";
export const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export async function readTeam(id: string) {
  const team = await client.getTeam(id);
  if (!team || team.id !== id)
    throw Error(
      "The returned team did not match this request. Refresh and try again.",
    );
  return team;
}
export const uncertainError = (error: unknown) =>
  !(error instanceof HttpError) ||
  error.statusCode >= 500 ||
  [408, 425, 429].includes(error.statusCode);
export function useOwned() {
  const generation = useRef(getSessionVersion()).current,
    mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && !!getToken() && generation === getSessionVersion(),
    [generation],
  );
}
export function useRead<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
) {
  const owned = useOwned(),
    loader = useRef(load),
    seq = useRef(0),
    key = JSON.stringify(deps),
    keyRef = useRef(key);
  loader.current = load;
  keyRef.current = key;
  const [state, set] = useState<{
    key: string;
    data?: T;
    loading: boolean;
    fresh: boolean;
    error: string;
  }>({ key, loading: true, fresh: false, error: "" });
  const reload = useCallback(async () => {
    if (!owned()) return undefined;
    const mine = ++seq.current,
      k = keyRef.current;
    set((s) => ({
      key: k,
      data: s.key === k ? s.data : undefined,
      loading: true,
      fresh: false,
      error: "",
    }));
    try {
      const value = await loader.current();
      if (!owned() || mine !== seq.current || k !== keyRef.current)
        return undefined;
      set({ key: k, data: value, loading: false, fresh: true, error: "" });
      return value;
    } catch (e) {
      if (owned() && mine === seq.current && k === keyRef.current)
        set((s) => ({
          key: k,
          data:
            e instanceof HttpError && [401, 403, 404].includes(e.statusCode)
              ? undefined
              : s.data,
          loading: false,
          fresh: false,
          error: messageOf(e, "Could not load this information."),
        }));
      return undefined;
    }
  }, [owned]);
  useEffect(() => {
    void reload();
    return () => {
      seq.current++;
    };
  }, [key, reload]);
  const commit = useCallback(
    (value: T) => {
      if (owned()) {
        seq.current++;
        set({
          key: keyRef.current,
          data: value,
          loading: false,
          fresh: true,
          error: "",
        });
      }
    },
    [owned],
  );
  return {
    ...(state.key === key
      ? state
      : { loading: true, fresh: false, error: "", data: undefined }),
    reload,
    commit,
  };
}
export type ExitState = {
  live?: () => { pending?: boolean; uncertain?: boolean };
  dirty?: boolean;
  pending?: boolean;
  uncertain?: boolean;
  fingerprint?: string;
  discard?: () => void;
};
const ExitContext = createContext<(read: () => ExitState) => () => void>(
  () => () => {},
);
const LeaveContext = createContext<() => Promise<boolean>>(async () => false);
export const useTeamsLeave = () => useContext(LeaveContext);
export function useTeamsExit(state: ExitState) {
  const register = useContext(ExitContext),
    current = useRef(state);
  current.current = state;
  useLayoutEffect(
    () =>
      register(() => {
        const value = current.current,
          live = value.live?.();
        return {
          ...value,
          pending: !!value.pending || !!live?.pending,
          uncertain: !!value.uncertain || !!live?.uncertain,
        };
      }),
    [register],
  );
}
export function Guard({ children }: { children: ReactNode }) {
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false),
    readers = useRef(new Set<() => ExitState>()),
    [warning, setWarning] = useState("");
  const register = useCallback((read: () => ExitState) => {
    readers.current.add(read);
    return () => void readers.current.delete(read);
  }, []);
  const leave = useCallback(async () => {
    if (!owned()) return true;
    if (lock.current) return false;
    const current = [...readers.current].map((read) => ({
      read,
      state: read(),
    }));
    if (current.some((x) => x.state.pending || x.state.uncertain)) {
      setWarning(
        "Finish the pending action or check its outcome before leaving.",
      );
      return false;
    }
    const dirty = current.filter((x) => x.state.dirty);
    if (!dirty.length) {
      setWarning("");
      return true;
    }
    lock.current = true;
    try {
      if (
        !(await confirm({
          title: "Discard team edits?",
          body: "Your unsaved team and planning form changes will be discarded.",
          action: "Discard",
          danger: true,
        })) ||
        !owned()
      )
        return false;
      if (
        current.some(
          (x) =>
            !readers.current.has(x.read) ||
            x.read().pending ||
            x.read().uncertain ||
            x.read().fingerprint !== x.state.fingerprint,
        )
      )
        return false;
      dirty.forEach((x) => x.read().discard?.());
      setWarning("");
      return true;
    } finally {
      lock.current = false;
    }
  }, [confirm, owned]);
  useEffect(() => onBeforeNavigate(() => leave()), [leave]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (
        owned() &&
        [...readers.current].some((read) => {
          const s = read();
          return s.dirty || s.pending || s.uncertain;
        })
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [owned]);
  return (
    <ExitContext.Provider value={register}>
      <LeaveContext.Provider value={leave}>
        {warning && (
          <p role="alert" className="teams-warning">
            {warning}
          </p>
        )}
        {children}
      </LeaveContext.Provider>
    </ExitContext.Provider>
  );
}
export type CommandSpec<T> = {
  prepare?: () => Promise<unknown>;
  label: string;
  perform: () => Promise<T>;
  validate: (receipt: T) => boolean;
  check: () => Promise<{ done: boolean; value?: T }>;
  saved: (value: T | undefined) => void;
  checkLabel?: string;
};
export function useCommand() {
  const owned = useOwned(),
    lock = useRef(false),
    attempt = useRef<{
      check: () => Promise<{ done: boolean; finish: () => void }>;
      checkLabel?: string;
    } | null>(null),
    [pending, setPending] = useState(false),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState("");
  async function run<T>(spec: CommandSpec<T>) {
    if (!owned() || lock.current || attempt.current) return false;
    lock.current = true;
    setPending(true);
    setError("");
    const captured = {
      checkLabel: spec.checkLabel,
      check: async () => {
        const observed = await spec.check();
        return {
          done: observed.done,
          finish: () => spec.saved(observed.value),
        };
      },
    };
    attempt.current = captured;
    let dispatched = false;
    try {
      await spec.prepare?.();
      if (!owned() || attempt.current !== captured) return false;
      dispatched = true;
      const value = await spec.perform();
      if (!owned() || attempt.current !== captured) return false;
      if (!spec.validate(value)) {
        setUnknown(true);
        setError(
          `${spec.label}: the response did not confirm this action. Check its outcome before continuing.`,
        );
        return false;
      }
      attempt.current = null;
      setUnknown(false);
      try {
        spec.saved(value);
      } catch {
        setError("Saved. Refresh this view to see the latest state.");
      }
      return true;
    } catch (e) {
      if (!owned()) return false;
      if (dispatched && uncertainError(e)) {
        setUnknown(true);
        setError(
          `${spec.label}: the outcome is uncertain. Do not repeat this action; check the saved state.`,
        );
      } else {
        attempt.current = null;
        setError(messageOf(e, "Could not save this change."));
      }
      return false;
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  }
  async function check() {
    const captured = attempt.current;
    if (!captured || !owned() || lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const observed = await captured.check();
      if (!owned() || attempt.current !== captured) return;
      if (!observed.done) {
        setError(
          "The saved state does not yet confirm this action. It remains blocked; check again.",
        );
        return;
      }
      attempt.current = null;
      setUnknown(false);
      setError("");
      observed.finish();
    } catch (e) {
      if (owned())
        setError(
          messageOf(
            e,
            "Could not check the outcome. This action remains blocked.",
          ),
        );
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  }
  return {
    live: () => ({
      pending: lock.current,
      uncertain: attempt.current !== null,
    }),
    run,
    check,
    pending,
    unknown,
    error,
    blocked: pending || unknown,
    checkLabel: attempt.current?.checkLabel ?? "Check saved state",
  };
}
export type Command = ReturnType<typeof useCommand>;
export function ActionState({ command }: { command: Command }) {
  return (
    <>
      {command.error && <ErrorNotice message={command.error} />}
      {command.unknown && (
        <Button busy={command.pending} onClick={() => void command.check()}>
          {command.checkLabel}
        </Button>
      )}
    </>
  );
}
export function ReadState({
  read,
  label,
}: {
  read: { loading: boolean; error: string; reload: () => Promise<unknown> };
  label: string;
}) {
  return (
    <>
      {read.loading && <p role="status">Loading {label}…</p>}
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
    </>
  );
}
export async function teamAbsent(id: string) {
  try {
    await readTeam(id);
    return false;
  } catch (e) {
    if (e instanceof HttpError && e.statusCode === 404) return true;
    throw e;
  }
}
