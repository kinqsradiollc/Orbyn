import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Clock,
  Globe,
  MailCheck,
  MapPin,
  Orbit,
  ShieldCheck,
  Video,
} from "lucide-react";
import {
  localDateKey,
  type BookingQuestion,
  type BookingReceipt,
  type BusyInterval,
  type HttpError,
  type PublicBookingPage,
} from "@orbyn/core";
import { client } from "../../lib/api";
import {
  deviceTimeZone,
  errorText,
  minutesLabel,
  timeZones,
} from "../../lib/planning";
import { Message, accentStyle, whenLabel } from "./bookingUi";
import { ManageBooking } from "./ManageBooking";
import { SlotPicker } from "./SlotPicker";
import { useNoIndex } from "../../hooks/useNoIndex";
import "./booking.css";

type Props = {
  path: string;
  /** Absent in the native desktop app, which has no homepage. */
  onHome?: () => void;
};

/** Paths under /book/ that are links from emails, never page slugs. */
const LINKS = new Set(["confirm", "cancel", "manage"]);

/**
 * Public booking pages, no sign-in: `/book/:slug` to pick a time,
 * `/book/confirm/:token` from the confirmation email,
 * `/book/manage/:token` to move or cancel, and `/book/cancel/:token` from
 * older emails.
 */
export function PublicBooking({ path, onHome }: Props) {
  // Booking and manage links are private to whoever has them.
  useNoIndex();
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const [, first, token] = parts;
  return (
    <div className="public-page">
      <header className="public-nav">
        {onHome ? (
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onHome();
            }}
          >
            <Orbit /> orbyn<span>•</span>
          </a>
        ) : (
          <span className="brand">
            <Orbit /> orbyn<span>•</span>
          </span>
        )}
      </header>
      <main className="public-main">
        {first === "confirm" && token ? (
          <Confirm token={token} />
        ) : first === "cancel" && token ? (
          <Cancel token={token} />
        ) : first === "manage" && token ? (
          <ManageBooking token={token} />
        ) : first && !LINKS.has(first) ? (
          <BookPage slug={first} />
        ) : (
          <Message
            title="This booking link isn't complete."
            body="Check the link and try again."
          />
        )}
      </main>
      <footer>Scheduling by Orbyn · your details go only to the host.</footer>
    </div>
  );
}

const Required = () => (
  <span className="required-mark" aria-hidden="true">
    {" "}
    *
  </span>
);

/** One of the page's own questions, as the right kind of field. */
function QuestionField({
  question: q,
  value,
  onChange,
}: {
  question: BookingQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  // A few choices read best as radios; longer lists fold into a menu.
  if (q.type === "choice" && q.options.length <= 5)
    return (
      <fieldset className="booking-choice">
        <legend>
          {q.label}
          {q.required && <Required />}
        </legend>
        {q.options.map((o) => (
          <label key={o}>
            <input
              type="radio"
              name={"q-" + q.id}
              value={o}
              checked={value === o}
              required={q.required}
              onChange={() => onChange(o)}
            />
            {o}
          </label>
        ))}
      </fieldset>
    );
  return (
    <label>
      {q.label}
      {q.required && <Required />}
      {q.type === "choice" ? (
        <select
          required={q.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose one</option>
          {q.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : q.type === "long_text" ? (
        <textarea
          rows={3}
          maxLength={2000}
          required={q.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={q.type === "phone" ? "tel" : "text"}
          autoComplete={q.type === "phone" ? "tel" : undefined}
          maxLength={q.type === "phone" ? 40 : 2000}
          required={q.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function BookPage({ slug }: { slug: string }) {
  const [tz, setTz] = useState(deviceTimeZone);
  const today = localDateKey(new Date(), tz);
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState<number | null>(null);
  const [page, setPage] = useState<PublicBookingPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<BusyInterval | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  /** What the shown page was loaded for, to skip a repeat request. */
  const loadedFor = useRef("");

  useEffect(() => {
    let alive = true;
    const key = `${duration}|${date}|${tz}|${reloads}`;
    if (loadedFor.current === key) return;
    const fetchPage = (d?: number) =>
      client.getPublicBookingPage(slug, {
        duration: d,
        date,
        days: 7,
        timezone: tz,
      });
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        // First load: the length in the link, or the page's first length.
        const fromLink = Number(
          new URLSearchParams(location.search).get("duration"),
        );
        let next;
        try {
          next = await fetchPage(duration ?? (fromLink || undefined));
        } catch (e) {
          // A link with a length the page no longer offers: show its default.
          if (duration || (e as HttpError).status !== 422) throw e;
          next = await fetchPage();
        }
        if (!alive) return;
        loadedFor.current = `${next.duration}|${date}|${tz}|${reloads}`;
        setPage(next);
        if (!duration) setDuration(next.duration);
      } catch (e) {
        if (alive) setLoadError(errorText(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, duration, date, tz, reloads]);

  useEffect(() => {
    document.title = page
      ? `${page.title} · Book a time`
      : "Book a time · Orbyn";
  }, [page]);

  if (receipt) {
    const when = whenLabel(receipt.start_at, receipt.end_at, tz);
    if (receipt.needs_confirmation)
      return (
        <Message
          accent={page?.color}
          title="Check your email to confirm"
          body={`We sent a link to ${email}. Open it to confirm ${when}. ${
            receipt.needs_approval
              ? "The host will then confirm the request."
              : "The time is held for you until then."
          }`}
        />
      );
    if (receipt.needs_approval || receipt.status === "awaiting_approval")
      return (
        <Message
          accent={page?.color}
          tone="ok"
          title="Request sent"
          body={`${page?.title ?? "Your request"} · ${when}. The host will confirm this request. We'll email ${email} when they do.`}
        />
      );
    return (
      <Message
        accent={page?.color}
        tone="ok"
        title="You're booked"
        body={`${page?.title ?? "Your booking"} · ${when}. A confirmation is on its way to ${email}.`}
      >
        {receipt.confirmation_message && (
          <p className="booking-confirmation-message">
            {receipt.confirmation_message}
          </p>
        )}
      </Message>
    );
  }

  if (!page)
    return loading ? (
      <section className="public-card">
        <p className="muted">Loading times…</p>
      </section>
    ) : (
      <Message
        title="This page isn't available"
        body={loadError || "Check the link and try again."}
      />
    );

  const zones = timeZones();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slot || !duration) return;
    const missing = page.questions.find(
      (q) => q.required && !answers[q.id]?.trim(),
    );
    if (missing) {
      setFormError(`Please answer “${missing.label}”.`);
      return;
    }
    const given: Record<string, string> = {};
    for (const q of page.questions) {
      const a = answers[q.id]?.trim();
      if (a) given[q.id] = a;
    }
    setSending(true);
    setFormError("");
    try {
      setReceipt(
        await client.book(slug, {
          start_at: slot.start_at,
          duration,
          name: name.trim(),
          email: email.trim(),
          note: note.trim(),
          timezone: tz,
          answers: given,
        }),
      );
    } catch (err) {
      setFormError(errorText(err));
      if ((err as HttpError).status === 409) {
        setSlot(null);
        setReloads((r) => r + 1);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="public-card booking-public booking-accent fade-up"
      style={accentStyle(page.color)}
      aria-labelledby="book-title"
    >
      <div className="booking-intro">
        <span className="eyebrow">BOOK A TIME</span>
        <h1 id="book-title">{page.title}</h1>
        <p className="booking-hosts">With {page.hosts.join(", ")}</p>
        {page.description && <p className="booking-desc">{page.description}</p>}
        <ul className="booking-facts">
          {page.location && (
            <li>
              <MapPin size={14} aria-hidden="true" /> {page.location}
            </li>
          )}
          {page.has_meeting_link && (
            <li>
              <Video size={14} aria-hidden="true" /> Video link sent when you
              book
            </li>
          )}
          {page.requires_approval && (
            <li>
              <ShieldCheck size={14} aria-hidden="true" /> The host confirms
              each request
            </li>
          )}
          <li>
            <Clock size={14} aria-hidden="true" />
            {page.durations.length > 1 ? (
              <span className="segmented" role="group" aria-label="Length">
                {page.durations.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={duration === d}
                    className={duration === d ? "active" : ""}
                    onClick={() => {
                      setDuration(d);
                      setSlot(null);
                    }}
                  >
                    {minutesLabel(d)}
                  </button>
                ))}
              </span>
            ) : (
              minutesLabel(page.durations[0])
            )}
          </li>
          <li>
            <Globe size={14} aria-hidden="true" />
            <label>
              <span className="sr-only">Your time zone</span>
              <select
                value={tz}
                onChange={(e) => {
                  setTz(e.target.value);
                  setSlot(null);
                }}
              >
                {!zones.includes(tz) && <option value={tz}>{tz}</option>}
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </li>
        </ul>
      </div>

      {slot ? (
        <form className="booking-form-public" onSubmit={(e) => void submit(e)}>
          <button
            type="button"
            className="text-button"
            onClick={() => setSlot(null)}
          >
            <ArrowLeft size={14} /> Pick another time
          </button>
          <p className="booking-chosen">
            <strong>{whenLabel(slot.start_at, slot.end_at, tz)}</strong>
          </p>
          <label>
            Your name
            <Required />
            <input
              required
              autoFocus
              maxLength={120}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email
            <Required />
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {page.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id] ?? ""}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
            />
          ))}
          <label>
            Anything to share? (optional)
            <textarea
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {formError && (
            <div className="error" role="alert">
              {formError}
            </div>
          )}
          {page.requires_approval && (
            <p className="booking-approval-note">
              <ShieldCheck size={14} aria-hidden="true" /> The host will confirm
              this request.
            </p>
          )}
          <button className="primary wide" disabled={sending}>
            {sending
              ? "Sending…"
              : page.requires_approval
                ? "Request this time"
                : "Book this time"}
          </button>
        </form>
      ) : (
        <div>
          <SlotPicker
            tz={tz}
            date={date}
            onDateChange={setDate}
            slots={page.slots}
            loading={loading}
            error={loadError}
            onPick={setSlot}
            day={day}
            onDayChange={setDay}
          />
          {formError && (
            <div className="error" role="alert">
              {formError}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Confirm({ token }: { token: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "done"; receipt: BookingReceipt }
    | { kind: "error"; text: string }
  >({ kind: "loading" });
  const started = useRef(false);
  useEffect(() => {
    document.title = "Confirm your booking · Orbyn";
    if (started.current) return;
    started.current = true;
    client.confirmBooking(token).then(
      (receipt) => setState({ kind: "done", receipt }),
      (e) => setState({ kind: "error", text: errorText(e) }),
    );
  }, [token]);
  if (state.kind === "loading")
    return (
      <section className="public-card">
        <p className="muted">Confirming your booking…</p>
      </section>
    );
  if (state.kind === "error")
    return <Message title="We couldn't confirm that" body={state.text} />;
  const { receipt } = state;
  const when = whenLabel(receipt.start_at, receipt.end_at, deviceTimeZone());
  if (receipt.status === "awaiting_approval" || receipt.needs_approval)
    return (
      <Message
        tone="ok"
        title="Email confirmed"
        body={`${when}. The host will confirm this request. We'll email you when they do.`}
      />
    );
  return (
    <Message
      tone="ok"
      title="You're booked"
      body={`${when}. The details are in your email.`}
    >
      {receipt.confirmation_message && (
        <p className="booking-confirmation-message">
          {receipt.confirmation_message}
        </p>
      )}
    </Message>
  );
}

/** The separate cancel link from older emails. */
function Cancel({ token }: { token: string }) {
  const [state, setState] = useState<"ask" | "sending" | "done">("ask");
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "Cancel your booking · Orbyn";
  }, []);
  if (state === "done")
    return (
      <Message
        tone="ok"
        title="Your booking is cancelled"
        body="The host has been told. You can close this page."
      />
    );
  return (
    <section className="public-card public-message fade-up">
      <MailCheck size={30} />
      <h1>Cancel this booking?</h1>
      <p>The host will see that the time is free again.</p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <button
        className="primary"
        disabled={state === "sending"}
        onClick={() => {
          setState("sending");
          setError("");
          client.cancelBookingByToken(token).then(
            () => setState("done"),
            (e) => {
              setError(errorText(e));
              setState("ask");
            },
          );
        }}
      >
        {state === "sending" ? "Cancelling…" : "Yes, cancel it"}
      </button>
    </section>
  );
}
