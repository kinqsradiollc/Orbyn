import {
  HttpError,
  hasSystemPermission,
  type SystemPermission,
  type SystemRole,
} from "@orbyn/core";
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
import { getSessionVersion, getToken } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button, ErrorNotice, Loading, useConfirm } from "../../ui/kit";
export type ExitState = {
  dirty?: boolean;
  pending?: boolean;
  sensitive?: boolean;
};
export const AdminContext = createContext<{
  current: () => { role: SystemRole | undefined; id: string };
  register: (reader: () => ExitState) => () => void;
  leave: () => Promise<boolean>;
  acquire: (lease: object) => boolean;
  release: (lease: object) => void;
}>({
  current: () => ({ role: undefined, id: "" }),
  register: () => () => {},
  leave: async () => false,
  acquire: () => false,
  release: () => {},
});
export function useOwner(permission: SystemPermission = "admin:access") {
  const context = useContext(AdminContext),
    generation = useRef(getSessionVersion()).current,
    alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return useCallback(
    () =>
      alive.current &&
      !!getToken() &&
      generation === getSessionVersion() &&
      hasSystemPermission(context.current().role, permission),
    [context, generation, permission],
  );
}
export function useExit(state: ExitState) {
  const { register } = useContext(AdminContext),
    latest = useRef(state);
  latest.current = state;
  useLayoutEffect(() => register(() => latest.current), [register]);
}
export function useRead<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
  permission: SystemPermission = "admin:access",
) {
  const owned = useOwner(permission),
    loader = useRef(load),
    ticket = useRef(0);
  loader.current = load;
  const [state, setState] = useState<{
    data: T | undefined;
    loading: boolean;
    fresh: boolean;
    error: string;
  }>({ data: undefined, loading: true, fresh: false, error: "" });
  const reload = useCallback(async () => {
    if (!owned()) return;
    const mine = ++ticket.current;
    setState((old) => ({ ...old, loading: true, fresh: false, error: "" }));
    try {
      const data = await loader.current();
      if (owned() && mine === ticket.current)
        setState({ data, loading: false, fresh: true, error: "" });
    } catch (e) {
      if (!owned() || mine !== ticket.current) return;
      setState((old) => ({
        data:
          e instanceof HttpError && [401, 403, 404, 410].includes(e.statusCode)
            ? undefined
            : old.data,
        loading: false,
        fresh: false,
        error: messageOf(e, "Could not load this admin view."),
      }));
    }
  }, [owned]);
  useEffect(() => {
    ticket.current++;
    setState({ data: undefined, loading: true, fresh: false, error: "" });
    void reload();
    return () => {
      ticket.current++;
    };
  }, [reload, ...deps]);
  const commit = (data: T) => {
    ticket.current++;
    if (owned()) setState({ data, loading: false, fresh: true, error: "" });
  };
  return { ...state, reload, commit, owned };
}
export function ReadState({
  read,
  children,
}: {
  read: {
    loading: boolean;
    error: string;
    reload: () => Promise<void>;
    data?: unknown;
    fresh?: boolean;
  };
  children: ReactNode;
}) {
  return (
    <>
      {read.loading && <Loading label="Loading admin data" />}
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {read.fresh === false && read.data !== undefined && (
        <p role="status">
          The displayed data is from the last successful read. Refresh failed or
          is still pending.
        </p>
      )}
      {children}
    </>
  );
}
export function useOperation(permission: SystemPermission = "system:manage") {
  const owned = useOwner(permission),
    domain = useContext(AdminContext),
    lease = useRef({}).current,
    ask = useConfirm(),
    lock = useRef(false),
    uncertain = useRef(false);
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useExit({ pending: busy || unknown });
  async function run<T>(
    work: () => Promise<T>,
    accept: (value: T) => void,
    question?: Parameters<typeof ask>[0],
    effect: "write" | "read" = "write",
  ) {
    if (lock.current || uncertain.current || !owned()) return;
    if (!domain.acquire(lease)) {
      setError(
        "Finish or reconcile the other pending Admin action before starting this one.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let sent = false;
    try {
      if (question && !(await ask(question))) return;
      if (!owned()) return;
      sent = true;
      const result = await work();
      if (owned()) {
        accept(result);
        setNotice("Response received and checked.");
      }
    } catch (e) {
      if (owned()) {
        const unclear =
          effect !== "read" &&
          sent &&
          (!(e instanceof HttpError) ||
            e.statusCode >= 500 ||
            [408, 425, 429].includes(e.statusCode));
        uncertain.current = unclear;
        setUnknown(unclear);
        setError(
          messageOf(
            e,
            unclear
              ? "Receipt unknown. This action will not be repeated."
              : "The change was refused. Your draft is kept.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (!uncertain.current) domain.release(lease);
      if (owned()) setBusy(false);
    }
  }
  async function check(proof: () => Promise<boolean>) {
    if (lock.current || !owned()) return;
    lock.current = true;
    setBusy(true);
    try {
      const matches = await proof();
      if (owned()) {
        if (matches) {
          uncertain.current = false;
          domain.release(lease);
          setUnknown(false);
          setError("");
          setNotice("The saved state confirms this change.");
        } else
          setError(
            "Saved state does not confirm this attempt. It remains blocked; no request was resent.",
          );
      }
    } catch (e) {
      if (owned()) setError(messageOf(e, "Could not check the saved state."));
    } finally {
      lock.current = false;
      if (!uncertain.current) domain.release(lease);
      if (owned()) setBusy(false);
    }
  }
  return {
    run,
    check,
    busy,
    unknown,
    error,
    notice,
    owned,
    blocked: busy || unknown,
    reject: (text: string) => {
      if (owned()) setError(text);
    },
  };
}
export function Outcome({
  op,
  check,
}: {
  op: ReturnType<typeof useOperation>;
  check?: () => Promise<boolean>;
}) {
  return (
    <>
      {op.error && <ErrorNotice message={op.error} />}
      {op.notice && (
        <p role="status" className="small">
          {op.notice}
        </p>
      )}
      {op.unknown && (
        <p role="alert">
          Receipt unconfirmed. No automatic replay.
          {check && (
            <Button disabled={op.busy} onClick={() => void op.check(check)}>
              Check saved state
            </Button>
          )}
        </p>
      )}
    </>
  );
}
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="admin-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function Facts({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="muted">Not reported</span>;
  if (Array.isArray(value))
    return (
      <div className="admin-facts-list">
        {value.length ? (
          value.map((row, i) => (
            <details key={i}>
              <summary>
                {typeof row === "object" && row
                  ? `Record ${i + 1}`
                  : String(row)}
              </summary>
              <Facts value={row} />
            </details>
          ))
        ) : (
          <p className="muted">None</p>
        )}
      </div>
    );
  if (typeof value !== "object") return <span dir="auto">{String(value)}</span>;
  return (
    <dl className="admin-facts">
      {Object.entries(value)
        .filter(
          ([key]) =>
            !/(?:^|_)(?:password|secret|access_token|refresh_token|authorization|key_hash|password_hash|api_key)$/.test(
              key.toLowerCase(),
            ) &&
            ![
              "password",
              "api_key",
              "secret",
              "access_token",
              "refresh_token",
              "key_hash",
              "password_hash",
            ].includes(key),
        )
        .map(([key, v]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>
              {v && typeof v === "object" ? (
                <details>
                  <summary>
                    {Array.isArray(v) ? `${v.length} records` : "Details"}
                  </summary>
                  <Facts value={v} />
                </details>
              ) : (
                <Facts value={v} />
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function PrivateReceipt({
  value,
  onDone,
}: {
  value: string;
  onDone: () => void;
}) {
  const owned = useOwner(),
    lock = useRef(false),
    feedback = useRef(0),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  useLayoutEffect(() => {
    feedback.current++;
    setCopied(false);
    setError("");
    return () => {
      feedback.current++;
    };
  }, [value]);
  useExit({ sensitive: true, pending: busy });
  return (
    <div className="admin-private">
      <p>Save this private receipt before leaving.</p>
      <pre tabIndex={0}>{value}</pre>
      <Button
        disabled={busy}
        onClick={() => {
          if (!owned() || lock.current) return;
          const receipt = feedback.current;
          lock.current = true;
          setBusy(true);
          setCopied(false);
          setError("");
          void Promise.resolve()
            .then(() => {
              if (!owned() || feedback.current !== receipt) return;
              return navigator.clipboard.writeText(value);
            })
            .then(() => {
              if (owned() && feedback.current === receipt) setCopied(true);
            })
            .catch(() => {
              if (owned() && feedback.current === receipt)
                setError(
                  "Copy failed. Select the receipt and save it manually.",
                );
            })
            .finally(() => {
              lock.current = false;
              if (owned()) setBusy(false);
            });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
      {error && <ErrorNotice message={error} />}
      <Button
        disabled={busy}
        onClick={() => {
          if (owned() && !lock.current) onDone();
        }}
      >
        I saved it
      </Button>
    </div>
  );
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const toLocal = (iso: string | null) =>
  iso
    ? new Date(
        new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
export const toIso = (local: string) =>
  local ? new Date(local).toISOString() : null;

export function useAdminLeave() {
  return useContext(AdminContext).leave;
}

/** Receipt subset check; never coerces a missing value into a successful save. */
export function requireMatch(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  const matches = (a: unknown, e: unknown): boolean => {
    if (Array.isArray(e))
      return (
        Array.isArray(a) &&
        a.length === e.length &&
        e.every((v, i) => matches(a[i], v))
      );
    if (e !== null && typeof e === "object")
      return (
        a !== null &&
        typeof a === "object" &&
        Object.entries(e).every(
          ([key, value]) =>
            Object.hasOwn(a, key) && matches(Reflect.get(a, key), value),
        )
      );
    return Object.is(a, e);
  };
  if (!matches(actual, expected))
    throw new Error(
      `${label} receipt does not match the submitted change. Saved state must be checked; no request was resent.`,
    );
}
