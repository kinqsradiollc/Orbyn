import { inspectBooking } from "./receipts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fromDateTimeLocal,
  toDateTimeLocal,
  isTimeZone,
  localDateKey,
  type BookingDetail,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, TextArea } from "../../ui/kit";
import { CopyButton } from "./sharing";
import {
  CommandState,
  ReadState,
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
export function HostDetail({
  id,
  onChanged,
  onClose,
}: {
  id: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const last = useRef<BookingDetail | undefined>(undefined);
  const read = useRead(async () => {
      const booking = await client.getBooking(id);
      if (booking?.id !== id)
        throw new Error("Booking response does not match this link.");
      return booking;
    }, [id]),
    [buffer, setBuffer] = useState<{
      note: string | null;
      reason: string | null;
    }>({ note: null, reason: null });
  const capture = useCallback(
    (key: "note" | "reason", value: string | null) =>
      setBuffer((old) => ({ ...old, [key]: value })),
    [],
  );
  useExit({ dirty: !read.data && !!(buffer.note || buffer.reason) });
  if (read.data) last.current = read.data;
  const displayed = read.data ?? last.current;
  return (
    <section className="booking-web-detail" aria-label="Focused booking">
      <div className="booking-web-actions">
        <h2>Booking detail</h2>
        <Button onClick={onClose}>Close booking</Button>
        <Button disabled={read.loading} onClick={() => void read.reload()}>
          Refresh focused booking
        </Button>
      </div>
      <ReadState read={read}>
        {displayed && (
          <Detail
            id={id}
            data={displayed}
            visible={!!read.data}
            fresh={read.fresh}
            accept={read.commit}
            onChanged={onChanged}
            refresh={read.reload}
            capture={capture}
            retained={buffer}
          />
        )}
      </ReadState>
      {!read.data && (buffer.note !== null || buffer.reason !== null) && (
        <section>
          <h3>Retained local draft</h3>
          <p>
            The booking cannot currently be read. Your authored note and reason
            are retained locally for copying; they have not been submitted.
          </p>
          <TextArea
            readOnly
            aria-label="Retained host draft"
            value={JSON.stringify(buffer, null, 2)}
          />
          <CopyButton
            text={JSON.stringify(buffer, null, 2)}
            label="Copy retained host draft"
          />
        </section>
      )}
    </section>
  );
}
function Detail({
  id,
  data,
  fresh,
  accept,
  onChanged,
  refresh,
  capture,
  retained,
  visible,
}: {
  id: string;
  data: BookingDetail;
  fresh: boolean;
  accept: (value: BookingDetail) => void;
  onChanged: () => void;
  refresh: () => Promise<void>;
  capture: (key: "note" | "reason", value: string | null) => void;
  retained: { note: string | null; reason: string | null };
  visible: boolean;
}) {
  const op = useCommand(),
    [note, setNote] = useState(retained.note ?? data.host_note),
    [reason, setReason] = useState(retained.reason ?? ""),
    [moving, setMoving] = useState(false),
    [slotsVersion, setSlotsVersion] = useState(0),
    noteDirty = note !== data.host_note;
  useExit({ dirty: noteDirty || !!reason });
  useEffect(() => {
    if (!noteDirty) setNote(data.host_note);
  }, [data.host_note]);
  useEffect(() => {
    if (op.status === 409 && !op.unknown) {
      setSlotsVersion((n) => n + 1);
      void refresh();
    }
  }, [op.error]);
  const oldNote = useRef(data.host_note);
  useEffect(() => {
    setNote((v) => (v === oldNote.current ? data.host_note : v));
    oldNote.current = data.host_note;
  }, [data.host_note]);
  const attempt = useRef<{ kind: string; value?: string | boolean } | null>(
    null,
  );
  function adopt(r: BookingDetail) {
    requireReceipt(r, { id });
    setNote(r.host_note);
    oldNote.current = r.host_note;
    accept(r);
    if (["cancel", "decline"].includes(attempt.current?.kind || "")) {
      setReason("");
      capture("reason", null);
    }
    if (["move", "cancel", "decline"].includes(attempt.current?.kind || ""))
      setMoving(false);
    capture("note", null);
    onChanged();
  }
  function command(
    kind: "approve" | "decline" | "cancel" | "note" | "no-show" | "move",
    value?: string | boolean,
  ) {
    if (!fresh) return;
    if (kind !== "note" && noteDirty) {
      op.reject(
        "Save or discard the private note before changing this meeting.",
      );
      return;
    }
    const key = crypto.randomUUID(),
      snapshot = { kind, value };
    const call = () => {
      attempt.current = snapshot;
      return client.once(key, () =>
        kind === "approve"
          ? client.approveBooking(id)
          : kind === "decline"
            ? client.declineBooking(id, String(value || ""))
            : kind === "cancel"
              ? client.cancelBookingAsHost(id, String(value || ""))
              : kind === "note"
                ? client.setBookingNote(id, String(value || ""))
                : kind === "no-show"
                  ? client.setBookingNoShow(id, !!value)
                  : client.rescheduleBooking(id, String(value)),
      );
    };
    const labels = {
      approve: "Approve request",
      decline: "Decline request",
      cancel: "Cancel meeting",
      note: "Save private note",
      "no-show": "Change no-show marker",
      move: "Move meeting",
    };
    void op.run(
      call,
      (r) => {
        requireReceipt(r, {
          id,
          ...(kind === "approve"
            ? { status: "confirmed" }
            : kind === "decline"
              ? { status: "declined" }
              : kind === "cancel"
                ? { status: "cancelled" }
                : kind === "note"
                  ? { host_note: String(value || "") }
                  : kind === "no-show"
                    ? { no_show: !!value }
                    : { start_at: String(value) }),
        });
        adopt(r);
      },
      kind === "note"
        ? undefined
        : {
            title: `${labels[kind]}?`,
            body:
              kind === "cancel" || kind === "decline"
                ? "The booker may be emailed with your reason."
                : kind === "move"
                  ? "Moves the real calendar meeting and may notify the booker."
                  : "Updates this exact meeting.",
            action: labels[kind],
            danger: kind === "cancel" || kind === "decline",
          },
      true,
    );
  }
  async function check() {
    const a = attempt.current;
    if (!a) return false;
    const r = await inspectBooking(id);
    if (!op.owner()) return false;
    const expected =
      a.kind === "approve"
        ? { status: "confirmed" }
        : a.kind === "decline"
          ? { status: "declined" }
          : a.kind === "cancel"
            ? { status: "cancelled" }
            : a.kind === "note"
              ? { host_note: a.value }
              : a.kind === "no-show"
                ? { no_show: a.value }
                : { start_at: a.value };
    try {
      requireReceipt(r, { id, ...expected });
      if (a.kind === "cancel" || a.kind === "decline") {
        adopt(r);
        return true;
      }
      accept(r); // Exact keyed replay, rather than a status snapshot, settles this action.
      return false;
    } catch {
      return false;
    }
  }
  const canChange = ["confirmed", "awaiting_approval"].includes(data.status),
    started = Date.parse(data.start_at) <= Date.now();
  if (!visible) return <CommandState op={op} check={check} />;
  return (
    <>
      <h3 dir="auto">{data.name}</h3>
      <p>
        {data.email} · {STATUS[data.status]}
      </p>
      <p>{when(data.start_at, data.end_at, zone())}</p>
      <p>
        Booker timezone: {data.timezone} · Hosts:{" "}
        {data.hosts.map((h) => h.name).join(", ")}
      </p>
      <p>{data.location}</p>
      {data.meeting_url && /^https?:\/\//.test(data.meeting_url) && (
        <a href={data.meeting_url} rel="noreferrer" target="_blank">
          Open meeting link
        </a>
      )}
      <p dir="auto">{data.note}</p>
      <dl className="booking-web-facts">
        {data.questions.map((q) => (
          <div key={q.id}>
            <dt dir="auto">{q.label}</dt>
            <dd dir="auto">{data.answers[q.id] || "No answer"}</dd>
          </div>
        ))}
        {Object.entries(data.answers)
          .filter(([id]) => !data.questions.some((q) => q.id === id))
          .map(([id, a]) => (
            <div key={id}>
              <dt>{id}</dt>
              <dd dir="auto">{a}</dd>
            </div>
          ))}
      </dl>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          command("note", note.trim());
        }}
      >
        <Field
          label="Private host note"
          hint="Only hosts can see this. Cancellation and decline reasons are separate."
        >
          <TextArea
            disabled={op.blocked || !fresh}
            maxLength={4000}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              capture("note", e.target.value);
            }}
          />
        </Field>
        <Button type="submit" disabled={op.blocked || !fresh || !noteDirty}>
          Save host note
        </Button>
        <Button
          disabled={op.blocked || !noteDirty}
          onClick={() => {
            setNote(data.host_note);
            capture("note", null);
          }}
        >
          Discard unsaved note
        </Button>
      </form>
      <Field
        label="Reason for cancellation or decline"
        hint="The booker may see this reason."
      >
        <TextArea
          disabled={op.blocked || !fresh}
          maxLength={500}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            capture("reason", e.target.value);
          }}
        />
      </Field>
      <div className="booking-web-actions">
        {data.status === "awaiting_approval" && (
          <>
            <Button
              variant="primary"
              disabled={op.blocked || noteDirty || !fresh}
              onClick={() => command("approve")}
            >
              Approve request
            </Button>
            <Button
              variant="danger"
              disabled={op.blocked || noteDirty || !fresh}
              onClick={() => command("decline", reason.trim())}
            >
              Decline request
            </Button>
          </>
        )}
        {["pending", "awaiting_approval", "confirmed"].includes(
          data.status,
        ) && (
          <Button
            variant="danger"
            disabled={op.blocked || noteDirty || !fresh}
            onClick={() => command("cancel", reason.trim())}
          >
            Cancel meeting
          </Button>
        )}
        {canChange && (
          <Button
            disabled={op.blocked || noteDirty || !fresh}
            onClick={() => setMoving(!moving)}
          >
            {moving ? "Discard move selection" : "Move booking"}
          </Button>
        )}
        {data.status === "confirmed" && started && (
          <Button
            disabled={op.blocked || noteDirty || !fresh}
            onClick={() => command("no-show", !data.no_show)}
          >
            {data.no_show ? "Clear no-show" : "Mark no-show"}
          </Button>
        )}
      </div>
      {moving && (
        <HostMove
          data={data}
          revision={slotsVersion}
          disabled={op.blocked || !fresh || noteDirty}
          onMove={(start) => command("move", start)}
        />
      )}
      <CommandState op={op} check={check} />
      {data.cancel_reason && <p>Cancellation reason: {data.cancel_reason}</p>}
      <details>
        <summary>Booking history and metadata</summary>
        <p>
          Requested {new Date(data.created_at).toLocaleString()} · Updated{" "}
          {new Date(data.updated_at).toLocaleString()} · Moved{" "}
          {data.reschedule_count} times
        </p>
        <ol>
          {data.events.map((e) => (
            <li key={e.id}>
              <strong>{e.kind.replaceAll("_", " ")}</strong> ·{" "}
              {e.actor_name || e.actor} ·{" "}
              {new Date(e.created_at).toLocaleString()}
              <p dir="auto">{e.detail}</p>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
function HostMove({
  data,
  disabled,
  onMove,
  revision,
}: {
  data: BookingDetail;
  revision: number;
  disabled: boolean;
  onMove: (start: string) => void;
}) {
  const [tz, setTz] = useState(zone()),
    [date, setDate] = useState(() => localDateKey(new Date(), zone())),
    [selected, setSelected] = useState(""),
    [custom, setCustom] = useState(""),
    slots = useRead(
      () =>
        isTimeZone(tz)
          ? client.getBookingSlots(data.id, { timezone: tz, date, days: 7 })
          : Promise.reject(new Error("Enter a valid timezone.")),
      [data.id, date, tz, data.start_at, revision],
    );
  useEffect(() => {
    setSelected("");
  }, [revision]);
  const customInstant = custom ? fromDateTimeLocal(custom) : null,
    customValid =
      !custom || (!!customInstant && toDateTimeLocal(customInstant) === custom);
  const target = selected || (customValid ? customInstant || "" : "");
  useExit({ dirty: !!target });
  return (
    <section>
      <h4>Choose another time</h4>
      <SlotRange
        date={date}
        onDate={(v) => {
          setDate(v);
          setSelected("");
        }}
        timezone={tz}
        onZone={(v) => {
          setTz(v);
          setSelected("");
        }}
        disabled={disabled}
      />
      <ReadState read={slots}>
        {slots.data && slots.fresh && isTimeZone(tz) && (
          <Slots
            slots={slots.data.slots.filter((s) => s.start_at !== data.start_at)}
            selected={selected}
            onSelect={(v) => {
              setSelected(v);
              setCustom("");
            }}
            timezone={slots.data.timezone}
            disabled={disabled}
          />
        )}
      </ReadState>
      <Field
        label="Or choose a custom time in your device timezone"
        hint="The server rechecks all host calendars and page hours before moving it."
      >
        <Input
          type="datetime-local"
          value={custom}
          disabled={disabled}
          onChange={(e) => {
            setCustom(e.target.value);
            setSelected("");
          }}
        />
      </Field>
      {!customValid && (
        <p role="alert">
          This local time does not exist in your device timezone. Choose another
          time around the daylight-saving change.
        </p>
      )}
      {target && (
        <p>
          Selected instant:{" "}
          {when(
            target,
            new Date(
              Date.parse(target) +
                Date.parse(data.end_at) -
                Date.parse(data.start_at),
            ).toISOString(),
            selected ? tz : zone(),
          )}
        </p>
      )}
      <Button
        variant="primary"
        disabled={disabled || !target || (!!selected && !slots.fresh)}
        onClick={() => {
          if (target) onMove(target);
        }}
      >
        Move to selected time
      </Button>
    </section>
  );
}
