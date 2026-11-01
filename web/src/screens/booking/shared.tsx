import {
  HttpError,
  isTimeZone,
  localDateKey,
  addDays,
  type BookingStatus,
  type BusyInterval,
  type BookingReceipt,
} from "@orbyn/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSessionVersion, getToken } from "../../lib/session";
import { useBeforeNavigate } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  Loading,
  useConfirm,
  useToast,
} from "../../ui/kit";
type Guard = { dirty?: boolean; pending?: boolean; sensitive?: boolean };
const Domain = createContext<{
  anonymous: boolean;
  register: (fn: () => Guard) => () => void;
  leave: () => Promise<boolean>;
  take: (lease: object) => boolean;
  release: (lease: object) => void;
}>({
  anonymous: false,
  register: () => () => {},
  leave: async () => false,
  take: () => false,
  release: () => {},
});
export function BookingDomain({
  children,
  anonymous = false,
}: {
  children: ReactNode;
  anonymous?: boolean;
}) {
  const generation = useRef(getSessionVersion()).current,
    alive = useRef(true),
    guards = useRef(new Set<() => Guard>()),
    lease = useRef<object | null>(null),
    confirming = useRef(false),
    ask = useConfirm(),
    toast = useToast();
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const leave = useCallback(async () => {
    if (
      confirming.current ||
      !alive.current ||
      generation !== getSessionVersion()
    )
      return false;
    const states = [...guards.current].map((f) => f());
    if (lease.current || states.some((s) => s.pending || s.sensitive)) {
      toast({
        text: "Finish or reconcile the pending booking action before leaving.",
        error: true,
      });
      return false;
    }
    if (!states.some((s) => s.dirty)) return true;
    confirming.current = true;
    try {
      const yes = await ask({
        title: "Discard unsaved booking changes?",
        body: "Saved bookings and pages are not changed.",
        action: "Discard changes",
        danger: true,
      });
      return yes && alive.current && generation === getSessionVersion();
    } finally {
      confirming.current = false;
    }
  }, [ask, toast, generation]);
  const value = useMemo(
    () => ({
      anonymous,
      leave,
      register: (fn: () => Guard) => {
        guards.current.add(fn);
        return () => {
          guards.current.delete(fn);
        };
      },
      take: (id: object) => {
        if (confirming.current) return false;
        if (
          (lease.current && lease.current !== id) ||
          [...guards.current].some((f) => f().pending || f().sensitive)
        )
          return false;
        lease.current = id;
        return true;
      },
      release: (id: object) => {
        if (lease.current === id) lease.current = null;
      },
    }),
    [anonymous, leave],
  );
  useBeforeNavigate(leave);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        lease.current ||
        confirming.current ||
        [...guards.current].some((f) => {
          const g = f();
          return g.dirty || g.pending || g.sensitive;
        })
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return <Domain.Provider value={value}>{children}</Domain.Provider>;
}
export function useOwner() {
  const domain = useContext(Domain),
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
      generation === getSessionVersion() &&
      (domain.anonymous || !!getToken()),
    [generation, domain.anonymous],
  );
}
export function useExit(state: Guard, pending?: { current: boolean }) {
  const { register } = useContext(Domain),
    current = useRef(state);
  current.current = state;
  useLayoutEffect(
    () =>
      register(() => ({
        ...current.current,
        pending: !!(current.current.pending || pending?.current),
      })),
    [register, pending],
  );
}
export const useLeave = () => useContext(Domain).leave;
export function useRead<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
) {
  const identity = JSON.stringify(deps);
  const own = useOwner(),
    loader = useRef(load),
    ticket = useRef(0);
  loader.current = load;
  const [state, set] = useState<{
    data: T | undefined;
    error: string;
    loading: boolean;
    fresh: boolean;
    identity: string;
    status: number | null;
  }>({
    data: undefined,
    error: "",
    loading: true,
    fresh: false,
    identity,
    status: null,
  });
  const reload = useCallback(async () => {
    if (!own()) return;
    const n = ++ticket.current;
    set((s) => ({
      ...s,
      error: "",
      loading: true,
      fresh: false,
      status: null,
    }));
    try {
      const data = await loader.current();
      if (own() && ticket.current === n)
        set({
          data,
          error: "",
          loading: false,
          fresh: true,
          identity,
          status: null,
        });
    } catch (e) {
      if (own() && ticket.current === n)
        set((s) => ({
          ...s,
          data:
            e instanceof HttpError &&
            [401, 403, 404, 410].includes(e.statusCode)
              ? undefined
              : s.data,
          status: e instanceof HttpError ? e.statusCode : null,
          error: messageOf(e, "Could not load this booking information."),
          loading: false,
          fresh: false,
        }));
    }
  }, [own, identity]);
  useEffect(() => {
    ticket.current++;
    set({
      data: undefined,
      error: "",
      loading: true,
      fresh: false,
      identity,
      status: null,
    });
    void reload();
    return () => {
      ticket.current++;
    };
  }, [reload, ...deps]);
  return {
    ...state,
    data: state.identity === identity ? state.data : undefined,
    loading: state.identity !== identity || state.loading,
    fresh: state.identity === identity && state.fresh,
    error: state.identity === identity ? state.error : "",
    reload,
    own,
    commit: (data: T) => {
      ticket.current++;
      if (own())
        set({
          data,
          error: "",
          loading: false,
          fresh: true,
          identity,
          status: null,
        });
    },
  };
}
export function ReadState({
  read,
  children,
}: {
  read: { loading: boolean; error: string; reload: () => Promise<void> };
  children?: ReactNode;
}) {
  return (
    <>
      {read.loading && <Loading label="Loading booking information" />}
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {children}
    </>
  );
}
type Attempt = {
  call: () => Promise<unknown>;
  accept: (value: unknown) => void;
  at: number;
  replay: boolean;
};
export function useCommand() {
  const owner = useOwner(),
    domain = useContext(Domain),
    ask = useConfirm(),
    id = useRef({}).current,
    active = useRef(false),
    attempt = useRef<Attempt | null>(null),
    uncertain = useRef(false);
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [status, setStatus] = useState<number | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useExit({ pending: busy || unknown });
  async function execute(a: Attempt) {
    try {
      const result = await a.call();
      if (owner()) {
        a.accept(result);
        uncertain.current = false;
        setUnknown(false);
        attempt.current = null;
        setNotice("Response received and checked.");
      }
    } catch (e) {
      if (owner()) {
        const ambiguous =
          !(e instanceof HttpError) ||
          e.statusCode >= 500 ||
          [408, 425, 429].includes(e.statusCode);
        uncertain.current = ambiguous;
        setUnknown(ambiguous);
        setStatus(e instanceof HttpError ? e.statusCode : null);
        setError(
          messageOf(
            e,
            ambiguous
              ? "The receipt is unknown. Your submitted draft is kept; no new request was sent."
              : "The request was refused. Your draft is kept.",
          ),
        );
        if (!ambiguous) attempt.current = null;
      }
    } finally {
      active.current = false;
      if (!uncertain.current) domain.release(id);
      if (owner()) setBusy(false);
    }
  }
  async function run<T>(
    call: () => Promise<T>,
    accept: (value: T) => void,
    question?: Parameters<typeof ask>[0],
    replay = false,
  ) {
    if (active.current || uncertain.current || !owner()) return;
    if (!domain.take(id)) {
      setError("Resolve the other pending booking action first.");
      return;
    }
    active.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setStatus(null);
    try {
      if (question && !(await ask(question))) {
        active.current = false;
        setBusy(false);
        domain.release(id);
        return;
      }
      if (!owner()) {
        active.current = false;
        domain.release(id);
        return;
      }
      const a: Attempt = {
        call,
        accept: (value) => accept(value as T),
        at: Date.now(),
        replay,
      };
      attempt.current = a;
      await execute(a);
    } catch (e) {
      active.current = false;
      domain.release(id);
      if (owner()) {
        setBusy(false);
        setError(messageOf(e, "Could not confirm this action."));
      }
    }
  }
  async function retry() {
    const a = attempt.current;
    if (!a || !a.replay || !uncertain.current || active.current || !owner())
      return;
    const age = Date.now() - a.at;
    if (age < 0 || age >= 23 * 3600000) {
      setError(
        "The safe replay window is unavailable. Check the saved booking; this request will not be replayed.",
      );
      return;
    }
    active.current = true;
    setBusy(true);
    setError("");
    await execute(a);
  }
  async function check(proof: () => Promise<boolean>) {
    if (active.current || !owner()) return;
    active.current = true;
    setBusy(true);
    try {
      const matches = await proof();
      if (matches) {
        uncertain.current = false;
        domain.release(id);
      }
      if (owner()) {
        if (matches) {
          uncertain.current = false;
          attempt.current = null;
          setUnknown(false);
          setError("");
          setNotice("The saved state matches the submitted change.");
          domain.release(id);
        } else
          setError(
            "The saved state does not confirm this attempt. No mutation was repeated.",
          );
      }
    } catch (e) {
      if (owner()) setError(messageOf(e, "Could not check the saved state."));
    } finally {
      active.current = false;
      if (owner()) setBusy(false);
    }
  }
  return {
    run,
    retry,
    check,
    busy,
    unknown,
    status,
    error,
    notice,
    blocked: busy || unknown,
    canReplay: !!attempt.current?.replay,
    owner,
    reject: (value: string) => {
      if (owner()) {
        setStatus(null);
        setError(value);
      }
    },
  };
}
export function CommandState({
  op,
  check,
}: {
  op: ReturnType<typeof useCommand>;
  check?: () => Promise<boolean>;
}) {
  return (
    <>
      {op.error && <ErrorNotice message={op.error} />}
      {op.notice && <p role="status">{op.notice}</p>}
      {op.unknown && (
        <div role="alert">
          <p>
            The result is unconfirmed. Your submitted details are kept here, and
            further changes are paused.
          </p>
          {check && (
            <Button disabled={op.busy} onClick={() => void op.check(check)}>
              Check saved state
            </Button>
          )}
          {op.canReplay && (
            <Button disabled={op.busy} onClick={() => void op.retry()}>
              Retry exact saved request
            </Button>
          )}
          {!check && !op.canReplay && (
            <p>Check your email or contact the host before trying again.</p>
          )}
        </div>
      )}
    </>
  );
}
export const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export const zone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const STATUS: Record<BookingStatus, string> = {
  pending: "Awaiting email confirmation",
  awaiting_approval: "Awaiting host approval",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};
export function when(start: string, end: string | undefined, tz: string) {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: isTimeZone(tz) ? tz : "UTC",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  return `${new Date(start).toLocaleString([], options)}${end ? " — " + new Date(end).toLocaleString([], options) : ""}`;
}
export function Slots({
  slots,
  selected,
  onSelect,
  timezone,
  disabled = false,
}: {
  slots: BusyInterval[];
  selected: string;
  onSelect: (instant: string) => void;
  timezone: string;
  disabled?: boolean;
}) {
  const groups = new Map<string, BusyInterval[]>();
  for (const s of slots) {
    const key = localDateKey(new Date(s.start_at), timezone);
    groups.set(key, [...(groups.get(key) || []), s]);
  }
  return (
    <div className="booking-web-slots">
      {!slots.length && <p role="status">No free times in this date range.</p>}
      {[...groups].map(([date, items]) => (
        <fieldset key={date} disabled={disabled}>
          <legend>{date}</legend>
          <div>
            {items.map((s) => (
              <Button
                key={s.start_at}
                aria-pressed={selected === s.start_at}
                onClick={() => onSelect(s.start_at)}
              >
                {new Date(s.start_at).toLocaleTimeString([], {
                  timeZone: timezone,
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </Button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
export function SlotRange({
  date,
  onDate,
  timezone,
  onZone,
  disabled = false,
}: {
  date: string;
  onDate: (date: string) => void;
  timezone: string;
  onZone: (zone: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="booking-web-form-grid">
      <Field label="First date">
        <Input
          type="date"
          value={date}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value) onDate(e.target.value);
          }}
        />
      </Field>
      <Field
        label="Your timezone"
        hint="Use an IANA name, for example Europe/London."
      >
        <Input
          value={timezone}
          disabled={disabled}
          onChange={(e) => onZone(e.target.value)}
        />
      </Field>
      <div className="booking-web-actions">
        <Button disabled={disabled} onClick={() => onDate(addDays(date, -7))}>
          Previous week
        </Button>
        <Button disabled={disabled} onClick={() => onDate(addDays(date, 7))}>
          Next week
        </Button>
      </div>
      {!isTimeZone(timezone) && (
        <p role="alert">Enter a valid timezone before choosing a time.</p>
      )}
    </div>
  );
}
export function Receipt({ value }: { value: BookingReceipt }) {
  return (
    <section className="booking-web-receipt" role="status">
      <h2>{STATUS[value.status]}</h2>
      <p>{when(value.start_at, value.end_at, zone())}</p>
      {value.needs_confirmation ? (
        <p>
          Open the confirmation link sent to your email. The time is held for 30
          minutes while you confirm; it is not confirmed yet.
        </p>
      ) : value.needs_approval || value.status === "awaiting_approval" ? (
        <p>
          The host must approve this request before the meeting starts. It is
          not confirmed yet.
        </p>
      ) : value.status === "confirmed" ? (
        <p>
          Your meeting is confirmed. If a confirmation email arrives, keep its
          private manage link.
        </p>
      ) : (
        <p>Use the status above to check the current outcome.</p>
      )}
      {value.confirmation_message && (
        <p dir="auto">{value.confirmation_message}</p>
      )}
    </section>
  );
}
export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}
export function saveFile(
  text: string,
  name: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function matches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => matches(actual[i], v))
    );
  if (expected !== null && typeof expected === "object")
    return (
      actual !== null &&
      typeof actual === "object" &&
      Object.entries(expected).every(
        ([k, v]) =>
          Object.hasOwn(actual, k) && matches(Reflect.get(actual, k), v),
      )
    );
  return Object.is(actual, expected);
}
export function requireReceipt(actual: unknown, expected: unknown) {
  if (!matches(actual, expected))
    throw new Error(
      "The returned receipt does not match the submitted booking change.",
    );
}

export function assertBookingReceipt(
  value: unknown,
): asserts value is BookingReceipt {
  if (!value || typeof value !== "object")
    throw new Error("Booking receipt is missing.");
  const id = Reflect.get(value, "id"),
    status = Reflect.get(value, "status"),
    start = Reflect.get(value, "start_at"),
    end = Reflect.get(value, "end_at");
  if (
    typeof id !== "string" ||
    !validId(id) ||
    typeof status !== "string" ||
    !Object.hasOwn(STATUS, status) ||
    typeof start !== "string" ||
    typeof end !== "string" ||
    !Number.isFinite(Date.parse(start)) ||
    Date.parse(end) <= Date.parse(start) ||
    !Number.isFinite(Date.parse(end)) ||
    typeof Reflect.get(value, "needs_confirmation") !== "boolean" ||
    typeof Reflect.get(value, "needs_approval") !== "boolean" ||
    typeof Reflect.get(value, "confirmation_message") !== "string"
  )
    throw new Error(
      "Booking receipt is incomplete or does not describe a valid meeting.",
    );
}

export function inviteHref(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      /^\/invite\/[A-Za-z0-9_-]{20,64}$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
