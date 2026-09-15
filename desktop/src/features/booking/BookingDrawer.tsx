import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Globe,
  History,
  Lock,
  Mail,
  X,
} from "lucide-react";
import {
  dateLabel,
  fromDateTimeLocal,
  localDateKey,
  type BookingDetail,
  type BookingPage,
  type BusyInterval,
  type HttpError,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { deviceTimeZone, errorText, minutesLabel } from "../../lib/planning";
import { timeAgo } from "../../lib/tasks";
import {
  BookingStatusPill,
  DEFAULT_COLOR,
  eventText,
  whenLabel,
} from "./bookingUi";
import { SlotPicker } from "./SlotPicker";

type Props = {
  id: string;
  pages: BookingPage[];
  report: (e: unknown) => void;
  onClose: () => void;
  /** After an action changed the booking: refresh lists and counts. */
  onChanged: () => void;
};

type Step = "decline" | "cancel" | "move" | null;

/** One booking: who, when, their answers, its history, and what to do next. */
export function BookingDrawer({
  id,
  pages,
  report,
  onClose,
  onChanged,
}: Props) {
  const tz = deviceTimeZone();
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState<Step>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const action = useAction(report);
  const noteAction = useAction(report);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const stepRef = useRef(step);
  stepRef.current = step;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let alive = true;
    client.getBooking(id).then(
      (d) => {
        if (!alive) return;
        setDetail(d);
        setNote(d.host_note);
      },
      (e) => {
        if (!alive) return;
        if ((e as HttpError).status === 401) report(e);
        setLoadError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Focus the panel on open; give focus back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Escape backs out of an open step, then closes; Tab stays in the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (stepRef.current) setStep(null);
        else closeRef.current();
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const apply = (
    fn: () => Promise<BookingDetail>,
    done: (d: BookingDetail) => string,
  ) =>
    void action.run(async () => {
      const d = await fn();
      setDetail(d);
      setStep(null);
      setReason("");
      onChanged();
      return done(d);
    });

  const saveNote = () =>
    void noteAction.run(async () => {
      const d = await client.setBookingNote(id, note.trim());
      setDetail(d);
      setNote(d.host_note);
      return "Note saved.";
    });

  const d = detail;
  const now = Date.now();
  const open = d
    ? d.status === "confirmed"
      ? Date.parse(d.end_at) > now
      : d.status === "pending" || d.status === "awaiting_approval"
    : false;
  const started =
    !!d && d.status === "confirmed" && Date.parse(d.start_at) <= now;
  const mine = d ? whenLabel(d.start_at, d.end_at, tz) : "";
  const theirs =
    d && d.timezone && d.timezone !== tz
      ? whenLabel(d.start_at, d.end_at, d.timezone)
      : "";
  const color = pages.find((p) => p.id === d?.page_id)?.color ?? DEFAULT_COLOR;
  const extraAnswers = d
    ? Object.entries(d.answers).filter(
        ([k, v]) => v && !d.questions.some((q) => q.id === k),
      )
    : [];

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panel}
        className="task-drawer booking-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-drawer-title"
        aria-busy={action.pending}
      >
        <header className="drawer-head">
          <div className="drawer-kicker">
            <span>Booking</span>
            {d && <BookingStatusPill status={d.status} />}
            {d?.no_show && <span className="chip is-danger">No-show</span>}
            <button
              ref={closeButton}
              className="icon-button drawer-close"
              aria-label="Close booking panel"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
          <h2 id="booking-drawer-title">{d?.name ?? "Booking"}</h2>
          {d && (
            <div className="drawer-facts booking-drawer-facts">
              <span>
                <CalendarClock size={14} aria-hidden="true" />
                {mine}
              </span>
              {theirs && theirs !== mine && (
                <span className="drawer-fact" title={d.timezone}>
                  <Globe size={14} aria-hidden="true" />
                  {theirs} their time
                </span>
              )}
              <a className="drawer-fact link-button" href={`mailto:${d.email}`}>
                <Mail size={14} aria-hidden="true" />
                {d.email}
              </a>
              <span className="drawer-fact">
                <i className="list-dot" style={{ background: color }} />
                {d.page_title}
              </span>
            </div>
          )}
        </header>

        <div className="drawer-body">
          {!d ? (
            loadError ? (
              <div className="error" role="alert">
                {loadError}
              </div>
            ) : (
              <p className="drawer-hint">Loading booking…</p>
            )
          ) : (
            <>
              {(open || started || action.outcome) && (
                <section className="drawer-section" aria-label="Actions">
                  {step === null && (open || started) && (
                    <div className="booking-actions">
                      {d.status === "awaiting_approval" && (
                        <>
                          <button
                            className="primary"
                            disabled={action.pending}
                            onClick={() =>
                              apply(
                                () => client.approveBooking(d.id),
                                () => "Approved. It's booked.",
                              )
                            }
                          >
                            <Check size={14} /> Approve
                          </button>
                          <button
                            className="secondary"
                            disabled={action.pending}
                            onClick={() => setStep("decline")}
                          >
                            <X size={14} /> Decline
                          </button>
                        </>
                      )}
                      {open && (
                        <button
                          className="secondary"
                          disabled={action.pending}
                          onClick={() => setStep("move")}
                        >
                          <CalendarClock size={14} /> Reschedule
                        </button>
                      )}
                      {open && d.status !== "awaiting_approval" && (
                        <button
                          className="secondary"
                          disabled={action.pending}
                          onClick={() => setStep("cancel")}
                        >
                          <X size={14} /> Cancel booking
                        </button>
                      )}
                      {started && (
                        <label className="switch-line compact">
                          <input
                            type="checkbox"
                            role="switch"
                            className="ai-switch"
                            checked={d.no_show}
                            disabled={action.pending}
                            onChange={(e) => {
                              const on = e.target.checked;
                              apply(
                                () => client.setBookingNoShow(d.id, on),
                                () =>
                                  on
                                    ? "Marked as a no-show."
                                    : "No-show cleared.",
                              );
                            }}
                          />
                          <span>No-show</span>
                        </label>
                      )}
                    </div>
                  )}
                  {(step === "decline" || step === "cancel") && (
                    <div className="booking-step">
                      <label>
                        {step === "decline"
                          ? "Why are you declining? (optional)"
                          : "Why are you cancelling? (optional)"}
                        <textarea
                          autoFocus
                          rows={3}
                          maxLength={500}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <small className="field-hint">
                        {d.name} sees this in their email.
                      </small>
                      <div className="booking-step-actions">
                        <button
                          className="primary is-danger"
                          disabled={action.pending}
                          onClick={() =>
                            step === "decline"
                              ? apply(
                                  () =>
                                    client.declineBooking(d.id, reason.trim()),
                                  () => "Declined. We've let them know.",
                                )
                              : apply(
                                  () =>
                                    client.cancelBookingAsHost(
                                      d.id,
                                      reason.trim(),
                                    ),
                                  () => "Cancelled. We've let them know.",
                                )
                          }
                        >
                          {action.pending
                            ? "Saving…"
                            : step === "decline"
                              ? "Decline request"
                              : "Cancel booking"}
                        </button>
                        <button
                          className="secondary"
                          disabled={action.pending}
                          onClick={() => setStep(null)}
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                  {step === "move" && (
                    <HostReschedule
                      booking={d}
                      pending={action.pending}
                      onBack={() => setStep(null)}
                      onMove={(at) =>
                        apply(
                          () => client.rescheduleBooking(d.id, at),
                          (n) =>
                            `Moved to ${whenLabel(n.start_at, n.end_at, tz)}.`,
                        )
                      }
                    />
                  )}
                  <OutcomeNote outcome={action.outcome} />
                </section>
              )}

              <section className="drawer-section">
                <h3>Details</h3>
                <dl className="booking-dl">
                  <dt>Length</dt>
                  <dd>
                    {minutesLabel(
                      (Date.parse(d.end_at) - Date.parse(d.start_at)) / 60_000,
                    )}
                  </dd>
                  {d.location && (
                    <>
                      <dt>Where</dt>
                      <dd>{d.location}</dd>
                    </>
                  )}
                  {d.meeting_url && (
                    <>
                      <dt>Meeting link</dt>
                      <dd>
                        <a
                          href={d.meeting_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {d.meeting_url}
                        </a>
                      </dd>
                    </>
                  )}
                  <dt>Booked</dt>
                  <dd>{dateLabel(d.created_at)}</dd>
                  {d.reschedule_count > 0 && (
                    <>
                      <dt>Moved</dt>
                      <dd>
                        {d.reschedule_count === 1
                          ? "Once"
                          : `${d.reschedule_count} times`}
                      </dd>
                    </>
                  )}
                  {d.cancel_reason && (
                    <>
                      <dt>
                        {d.status === "declined"
                          ? "Declined because"
                          : "Reason"}
                      </dt>
                      <dd>{d.cancel_reason}</dd>
                    </>
                  )}
                </dl>
              </section>

              {(d.questions.length > 0 || extraAnswers.length > 0) && (
                <section className="drawer-section">
                  <h3>Answers</h3>
                  <dl className="booking-dl">
                    {d.questions.map((q) => (
                      <div key={q.id} className="booking-dl-row">
                        <dt>{q.label}</dt>
                        <dd>
                          {d.answers[q.id] || (
                            <span className="muted">No answer</span>
                          )}
                        </dd>
                      </div>
                    ))}
                    {extraAnswers.map(([k, v]) => (
                      <div key={k} className="booking-dl-row">
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {d.note && (
                <section className="drawer-section">
                  <h3>Their note</h3>
                  <p className="drawer-notes">{d.note}</p>
                </section>
              )}

              <section className="drawer-section">
                <h3>
                  <Lock size={14} aria-hidden="true" /> Private note
                </h3>
                <textarea
                  className="host-note"
                  rows={3}
                  maxLength={4000}
                  value={note}
                  aria-label="Private note"
                  aria-describedby="host-note-hint"
                  placeholder="Only hosts see this."
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="host-note-foot">
                  <button
                    className="secondary"
                    disabled={noteAction.pending || note.trim() === d.host_note}
                    onClick={saveNote}
                  >
                    {noteAction.pending ? "Saving…" : "Save note"}
                  </button>
                  <small id="host-note-hint" className="field-hint">
                    Only hosts see this.
                  </small>
                  <OutcomeNote outcome={noteAction.outcome} />
                </div>
              </section>

              <section className="drawer-section">
                <h3>
                  <History size={14} aria-hidden="true" /> History
                </h3>
                {d.events.length ? (
                  <ol className="booking-timeline">
                    {d.events.map((e) => (
                      <li key={e.id}>
                        <strong>{eventText(e, d.name)}</strong>
                        {e.detail && e.kind !== "no_show" && (
                          <small>{e.detail}</small>
                        )}
                        <time
                          dateTime={e.created_at}
                          title={new Date(e.created_at).toLocaleString()}
                        >
                          {timeAgo(e.created_at)}
                        </time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="drawer-hint">Nothing has happened yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Moving a booking as a host: the page's free times for the same length, or
 * any time the hosts are free.
 */
function HostReschedule({
  booking,
  pending,
  onBack,
  onMove,
}: {
  booking: BookingDetail;
  pending: boolean;
  onBack: () => void;
  onMove: (startAt: string) => void;
}) {
  const tz = deviceTimeZone();
  const length = Math.round(
    (Date.parse(booking.end_at) - Date.parse(booking.start_at)) / 60_000,
  );
  const [date, setDate] = useState(() => localDateKey(new Date(), tz));
  const [slots, setSlots] = useState<BusyInterval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    client
      .getBookingSlots(booking.id, { date, days: 7, timezone: tz })
      .then(
        (p) => {
          if (alive) setSlots(p.slots);
        },
        (e) => {
          if (!alive) return;
          setSlots([]);
          const status = (e as HttpError).status;
          setError(
            status === 404
              ? "The page is switched off, so it can't suggest times. Choose a time below."
              : status === 422
                ? "The page no longer offers this length. Choose a time below."
                : errorText(e),
          );
        },
      )
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [booking.page_slug, length, date, tz]);

  const target = picked ?? (custom ? fromDateTimeLocal(custom) : null);
  const targetLabel = target
    ? whenLabel(
        target,
        new Date(Date.parse(target) + length * 60_000).toISOString(),
        tz,
      )
    : "";

  return (
    <div className="booking-step">
      <p className="drawer-hint booking-step-intro">
        Pick a free time on “{booking.page_title}”, or choose any time below.
      </p>
      <SlotPicker
        tz={tz}
        date={date}
        onDateChange={(next) => {
          setDate(next);
          setPicked(null);
        }}
        slots={slots}
        loading={loading}
        error={error}
        selected={picked}
        onPick={(s) => {
          setPicked(s.start_at);
          setCustom("");
        }}
        exclude={booking.start_at}
      />
      <label className="booking-custom-time">
        Or choose a time
        <input
          type="datetime-local"
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            setPicked(null);
          }}
        />
      </label>
      <small className="field-hint">
        It still has to fit the page's hours and every required host's calendar.
      </small>
      <div className="booking-step-actions">
        <button
          className="primary"
          disabled={!target || pending}
          onClick={() => target && onMove(target)}
        >
          {pending
            ? "Moving…"
            : target
              ? `Move to ${targetLabel}`
              : "Pick a time"}
        </button>
        <button className="secondary" disabled={pending} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
