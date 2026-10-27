import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import {
  ArrowLeft,
  CalendarClock,
  CircleCheck,
  Clock,
  Globe,
  MapPin,
  Video,
  X,
} from "lucide-react";
import {
  localDateKey,
  type BusyInterval,
  type HttpError,
  type ManagedBooking,
} from "@orbyn/core";
import { client } from "../../lib/api";
import {
  deviceTimeZone,
  errorText,
  minutesLabel,
  zoneAbbr,
} from "../planner/planning";
import {
  BookingStatusPill,
  Message,
  accentStyle,
  whenLabel,
} from "./bookingUi";
import { SlotPicker } from "./SlotPicker";

type Mode = "view" | "move" | "cancel";

/**
 * `/book/manage/:token`, from the booker's emails: see the booking, move it
 * to another free time, or cancel it. No sign-in.
 */
export function ManageBooking({ token }: { token: string }) {
  const tz = deviceTimeZone();
  const [data, setData] = useState<ManagedBooking | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [mode, setMode] = useState<Mode>("view");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => localDateKey(new Date(), tz));
  const [slots, setSlots] = useState<BusyInterval[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [picked, setPicked] = useState<BusyInterval | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    document.title = "Your booking · Orbyn";
    let alive = true;
    setLoadError("");
    client.getManagedBooking(token).then(
      (next) => {
        if (alive) setData(next);
      },
      (e) => {
        if (alive) setLoadError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [token, loadVersion]);

  useEffect(() => {
    if (mode !== "move") return;
    let alive = true;
    setSlotsLoading(true);
    setPicked(null);
    setSlotsError("");
    client
      .getRescheduleSlots(token, { date, days: 7, timezone: tz })
      .then(
        (r) => {
          if (alive) setSlots(r.slots);
        },
        (e) => {
          if (alive) setSlotsError(errorText(e));
        },
      )
      .finally(() => {
        if (alive) setSlotsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mode, date, token, tz, reloads]);

  if (!data)
    return loadError ? (
      <Message title="Couldn't load your booking" body={loadError}>
        <button
          className="secondary"
          onClick={() => setLoadVersion((v) => v + 1)}
        >
          Retry
        </button>
      </Message>
    ) : (
      <section className="public-card manage-card">
        <p className="muted">Loading your booking…</p>
      </section>
    );

  const { booking: b, page } = data;
  const past = b.status === "confirmed" && Date.parse(b.end_at) <= Date.now();
  const bookAgain = (
    <a className="link-button" href={`/book/${encodeURIComponent(page.slug)}`}>
      Book another time
    </a>
  );

  const move = async () => {
    if (!picked || sending || slotsLoading || slotsError) return;
    setSending(true);
    setError("");
    try {
      const next = await client.rescheduleByToken(token, picked.start_at);
      setData(next);
      setMode("view");
      setPicked(null);
      setDone(
        `Moved to ${whenLabel(next.booking.start_at, next.booking.end_at, tz)}.`,
      );
    } catch (e) {
      setError(errorText(e));
      if ((e as HttpError).status === 409) {
        setPicked(null);
        setReloads((r) => r + 1);
      }
    } finally {
      setSending(false);
    }
  };

  const cancel = async () => {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      setData(await client.cancelByManageToken(token, reason.trim()));
      setMode("view");
      setDone("Your booking is cancelled. The host has been told.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="public-card manage-card booking-accent"
      style={accentStyle(page.color)}
      aria-labelledby="manage-title"
    >
      <span className="eyebrow">Your booking</span>
      <h1 id="manage-title">{page.title}</h1>
      <p className="booking-hosts">With {page.hosts.join(", ")}</p>
      <p className="manage-when">
        <strong>{whenLabel(b.start_at, b.end_at, tz)}</strong>
        <BookingStatusPill status={b.status} />
      </p>
      <ul className="booking-facts">
        <li>
          <Clock size={14} aria-hidden="true" /> {minutesLabel(b.duration)}
        </li>
        {page.location && (
          <li>
            <MapPin size={14} aria-hidden="true" /> {page.location}
          </li>
        )}
        {page.has_meeting_link && (
          <li>
            <Video size={14} aria-hidden="true" /> Video link in your
            confirmation email
          </li>
        )}
        <li>
          <Globe size={14} aria-hidden="true" /> Your time zone ({zoneAbbr(tz)})
        </li>
      </ul>

      {done && (
        <p className="inline-outcome ok" role="status">
          <CircleCheck size={13} />
          <span>{done}</span>
        </p>
      )}

      {b.status === "cancelled" ? (
        <p className="manage-note">This booking is cancelled. {bookAgain}</p>
      ) : b.status === "declined" ? (
        <p className="manage-note">
          The host couldn't take this request. {bookAgain}
        </p>
      ) : b.status === "expired" ? (
        <p className="manage-note">
          This request expired before it was confirmed. {bookAgain}
        </p>
      ) : past ? (
        <p className="manage-note">This booking has passed.</p>
      ) : b.status === "pending" ? (
        <p className="manage-note">
          Open the link in the email we sent you to confirm this booking.
        </p>
      ) : b.status === "awaiting_approval" ? (
        <p className="manage-note">
          Waiting for the host to confirm. We'll email you when they do.
        </p>
      ) : null}

      {mode === "view" && (data.can_reschedule || data.can_cancel) && (
        <>
          <div className="manage-actions">
            {data.can_reschedule && (
              <button
                className="primary"
                onClick={() => {
                  setDone("");
                  setError("");
                  setMode("move");
                }}
              >
                <CalendarClock size={15} /> Move booking
              </button>
            )}
            {data.can_cancel && (
              <button
                className="secondary"
                onClick={() => {
                  setDone("");
                  setError("");
                  setMode("cancel");
                }}
              >
                <X size={15} /> Cancel booking
              </button>
            )}
          </div>
          {!data.can_reschedule && b.status === "confirmed" && (
            <p className="manage-note">
              To change the time, cancel and book again.
            </p>
          )}
        </>
      )}

      {mode === "move" && (
        <BookingActionDialog
          titleId="manage-move-title"
          busy={sending}
          color={page.color}
          onClose={() => {
            setMode("view");
            setPicked(null);
            setError("");
          }}
        >
          <div className="manage-step" aria-busy={sending}>
            <button
              type="button"
              className="text-button"
              disabled={sending}
              onClick={() => {
                setMode("view");
                setPicked(null);
                setError("");
              }}
            >
              <ArrowLeft size={14} /> Keep this time
            </button>
            <h2 id="manage-move-title">Move booking</h2>
            <p className="manage-note">{page.title}</p>
            <fieldset className="booking-pending-fields" disabled={sending}>
              <SlotPicker
                tz={tz}
                date={date}
                onDateChange={(d) => {
                  setDate(d);
                  setPicked(null);
                }}
                slots={slots}
                loading={slotsLoading}
                error={slotsError}
                onRetry={() => setReloads((r) => r + 1)}
                selected={picked?.start_at ?? null}
                onPick={setPicked}
                exclude={b.start_at}
              />
            </fieldset>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {picked && (
              <div className="manage-confirm">
                <p>
                  Move to{" "}
                  <strong>
                    {whenLabel(picked.start_at, picked.end_at, tz)}
                  </strong>
                  ?
                </p>
                <button
                  className="primary"
                  disabled={sending || slotsLoading || Boolean(slotsError)}
                  onClick={() => void move()}
                >
                  {sending ? "Moving…" : "Move booking"}
                </button>
              </div>
            )}
          </div>
        </BookingActionDialog>
      )}

      {mode === "cancel" && (
        <BookingActionDialog
          titleId="manage-cancel-title"
          busy={sending}
          color={page.color}
          onClose={() => {
            setMode("view");
            setError("");
          }}
        >
          <form
            className="manage-step booking-form-public"
            aria-busy={sending}
            onSubmit={(e) => {
              e.preventDefault();
              void cancel();
            }}
          >
            <h2 id="manage-cancel-title">Cancel booking?</h2>
            <p className="booking-chosen">
              {page.title} · {whenLabel(b.start_at, b.end_at, tz)}
            </p>
            <p className="manage-note">
              The host will see that the time is free again.
            </p>
            <label>
              Reason for the host (optional)
              <textarea
                rows={3}
                maxLength={500}
                value={reason}
                disabled={sending}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <div className="manage-actions">
              <button className="primary is-danger" disabled={sending}>
                {sending ? "Cancelling…" : "Cancel booking"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={sending}
                onClick={() => {
                  setMode("view");
                  setError("");
                }}
              >
                Keep booking
              </button>
            </div>
          </form>
        </BookingActionDialog>
      )}
    </section>
  );
}

function BookingActionDialog({
  titleId,
  busy,
  color,
  onClose,
  children,
}: {
  titleId: string;
  busy: boolean;
  color: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      className="modal booking-action-dialog booking-accent"
      style={accentStyle(color)}
      data-modal-focus={focus.id}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
