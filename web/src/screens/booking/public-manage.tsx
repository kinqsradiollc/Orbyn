import { inspectManaged } from "./receipts";
import { useEffect, useRef, useState } from "react";
import {
  isTimeZone,
  localDateKey,
  type BookingReceipt,
  type ManagedBooking,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, TextArea } from "../../ui/kit";
import {
  assertBookingReceipt,
  CommandState,
  ReadState,
  Receipt,
  STATUS,
  SlotRange,
  Slots,
  requireReceipt,
  useCommand,
  useExit,
  useRead,
  when,
  zone,
} from "./shared";
export function TokenAction({
  token,
  kind,
}: {
  token: string;
  kind: "confirm" | "cancel";
}) {
  const op = useCommand(),
    started = useRef(false),
    [receipt, setReceipt] = useState<BookingReceipt | null>(null),
    [cancelled, setCancelled] = useState(false);
  function act() {
    if (kind === "confirm")
      void op.run(
        () => client.confirmBooking(token),
        (r) => {
          assertBookingReceipt(r);
          setReceipt(r);
        },
      );
    else
      void op.run(
        () => client.cancelBookingByToken(token),
        (r) => {
          requireReceipt(r, { cancelled: true });
          setCancelled(true);
        },
        {
          title: "Cancel this booking?",
          body: "Cancels the meeting linked by this private email link and can notify the host.",
          action: "Cancel booking",
          danger: true,
        },
      );
  }
  useEffect(() => {
    if (kind === "confirm" && !started.current) {
      started.current = true;
      act();
    }
  }, [kind]);
  return (
    <>
      <h1>{kind === "confirm" ? "Confirm your email" : "Cancel a booking"}</h1>
      {receipt ? (
        <Receipt value={receipt} />
      ) : cancelled ? (
        <p role="status">The booking cancellation is confirmed.</p>
      ) : kind === "cancel" ? (
        <>
          <p>Opening this link has not cancelled anything.</p>
          <Button variant="danger" disabled={op.blocked} onClick={act}>
            Cancel this booking
          </Button>
        </>
      ) : (
        <p>
          {op.busy
            ? "Checking your email confirmation…"
            : "This private confirmation link can only confirm an active, unexpired request."}
        </p>
      )}
      <CommandState op={op} />
      {kind === "confirm" &&
        !receipt &&
        !op.unknown &&
        !op.busy &&
        ![404, 410].includes(op.status ?? 0) &&
        op.error && <Button onClick={act}>Try confirming again</Button>}
    </>
  );
}
export function Manage({ token }: { token: string }) {
  const last = useRef<ManagedBooking | undefined>(undefined),
    read = useRead(() => client.getManagedBooking(token), [token]);
  if (read.data) last.current = read.data;
  const displayed = read.data ?? last.current;
  return (
    <ReadState read={read}>
      {displayed && (
        <ManageForm
          token={token}
          value={displayed}
          visible={!!read.data}
          fresh={read.fresh}
          onReceipt={read.commit}
          reload={read.reload}
        />
      )}
    </ReadState>
  );
}
function ManageForm({
  token,
  value,
  fresh,
  onReceipt,
  reload,
  visible,
}: {
  token: string;
  value: ManagedBooking;
  fresh: boolean;
  onReceipt: (value: ManagedBooking) => void;
  reload: () => Promise<void>;
  visible: boolean;
}) {
  const op = useCommand(),
    [reason, setReason] = useState(""),
    [moving, setMoving] = useState(false),
    [tz, setTz] = useState(zone()),
    [date, setDate] = useState(() => localDateKey(new Date(), zone())),
    [picked, setPicked] = useState(""),
    attempt = useRef<{ kind: "cancel" | "move"; start?: string } | null>(null),
    slots = useRead(
      () =>
        moving && value.can_reschedule && isTimeZone(tz)
          ? client.getRescheduleSlots(token, { timezone: tz, date, days: 7 })
          : Promise.resolve(null),
      [token, moving, tz, date, value.booking.start_at, value.can_reschedule],
    );
  useExit({ dirty: !!reason || !!picked });
  function accept(r: ManagedBooking) {
    if (r.booking.id !== value.booking.id)
      throw new Error("Manage receipt belongs to another booking.");
    onReceipt(r);
    if (attempt.current?.kind === "cancel") setReason("");
    setPicked("");
    setMoving(false);
  }
  async function cancel() {
    if (!fresh || !value.can_cancel) {
      op.reject("Cancellation is not currently available for this booking.");
      return;
    }
    const submittedReason = reason.trim();
    await op.run(
      () => {
        attempt.current = { kind: "cancel" };
        return client.cancelByManageToken(token, submittedReason);
      },
      (r) => {
        requireReceipt(r.booking, {
          id: value.booking.id,
          status: "cancelled",
        });
        accept(r);
      },
      {
        title: "Cancel this meeting?",
        body: "Your reason may be shared with the host.",
        action: "Cancel meeting",
        danger: true,
      },
    );
  }
  async function move() {
    if (
      !picked ||
      !slots.fresh ||
      !slots.data?.slots.some((s) => s.start_at === picked)
    ) {
      op.reject("Choose a current free time.");
      return;
    }
    const start = picked;
    await op.run(
      () => {
        attempt.current = { kind: "move", start };
        return client.rescheduleByToken(token, start);
      },
      (r) => {
        requireReceipt(r.booking, { id: value.booking.id, start_at: start });
        accept(r);
      },
      {
        title: "Move this meeting?",
        body: when(start, undefined, tz),
        action: "Move meeting",
      },
    );
  }
  async function check() {
    const a = attempt.current;
    if (!a) return false;
    const r = await inspectManaged(token);
    if (!op.owner()) return false;
    if (r.booking.id !== value.booking.id) return false;
    const matches =
      a.kind === "cancel"
        ? r.booking.status === "cancelled"
        : r.booking.start_at === a.start;
    if (matches) {
      if (a.kind === "cancel") {
        accept(r);
        return true;
      }
      onReceipt(r); // Inspect the current time, but do not unlock an unversioned move.
    }
    return false;
  }
  useEffect(() => {
    if (op.status === 409 && !op.unknown) {
      setPicked("");
      void slots.reload();
      void reload();
    }
  }, [op.error]);
  if (!visible)
    return (
      <>
        <CommandState op={op} check={check} />
        {reason && (
          <Field label="Retained cancellation reason">
            <TextArea readOnly value={reason} />
          </Field>
        )}
      </>
    );
  return (
    <>
      <span
        className="booking-web-color-dot"
        style={{ backgroundColor: value.page.color }}
        aria-label="Page color"
      />
      <h1 dir="auto">{value.page.title}</h1>
      <p>With {value.page.hosts.join(", ")}</p>
      <p role="status">{STATUS[value.booking.status]}</p>
      <p>{when(value.booking.start_at, value.booking.end_at, tz)}</p>
      <p>Booking timezone: {value.booking.timezone}</p>
      <p>
        {value.page.location}
        {value.page.has_meeting_link
          ? " · Online meeting details are in your confirmation email."
          : ""}
      </p>
      {value.can_cancel && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void cancel();
          }}
        >
          <fieldset disabled={op.blocked || !fresh}>
            <Field label="Cancellation reason (optional)">
              <TextArea
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="danger">
              Cancel meeting
            </Button>
          </fieldset>
        </form>
      )}
      {value.can_reschedule && (
        <>
          <Button
            disabled={op.blocked || !fresh}
            onClick={() => {
              setPicked("");
              setMoving(!moving);
            }}
          >
            {moving ? "Discard move selection" : "Move meeting"}
          </Button>
          {moving && (
            <>
              <SlotRange
                date={date}
                onDate={(v) => {
                  setDate(v);
                  setPicked("");
                }}
                timezone={tz}
                onZone={(v) => {
                  setTz(v);
                  setPicked("");
                }}
                disabled={op.blocked}
              />
              <ReadState read={slots}>
                {slots.fresh && slots.data && isTimeZone(tz) && (
                  <Slots
                    slots={slots.data.slots.filter(
                      (s) => s.start_at !== value.booking.start_at,
                    )}
                    selected={picked}
                    onSelect={setPicked}
                    timezone={slots.data.timezone}
                    disabled={op.blocked}
                  />
                )}
              </ReadState>
              <Button
                variant="primary"
                disabled={op.blocked || !fresh || !slots.fresh || !picked}
                onClick={() => void move()}
              >
                Confirm new time
              </Button>
            </>
          )}
        </>
      )}
      {!value.can_cancel && !value.can_reschedule && (
        <p>No changes are currently available from this manage link.</p>
      )}
      <CommandState op={op} check={check} />
      <Button disabled={op.busy} onClick={() => void reload()}>
        Refresh saved booking
      </Button>
    </>
  );
}
