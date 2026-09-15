import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Globe,
  MailCheck,
  MapPin,
  Orbit,
  Video,
} from "lucide-react";
import {
  addDays,
  localDateKey,
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
import "./booking.css";

type Props = {
  path: string;
  /** Absent in the native desktop app, which has no homepage. */
  onHome?: () => void;
};

/**
 * Public booking pages, no sign-in: `/book/:slug` to pick a time,
 * `/book/confirm/:token` from the confirmation email, and
 * `/book/cancel/:token` to cancel.
 */
export function PublicBooking({ path, onHome }: Props) {
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
        ) : first ? (
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

function Message({
  title,
  body,
  tone = "info",
}: {
  title: string;
  body: string;
  tone?: "info" | "ok";
}) {
  return (
    <section
      className={"public-card public-message fade-up is-" + tone}
      role="status"
    >
      {tone === "ok" ? <CircleCheck size={30} /> : <CalendarCheck size={30} />}
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}

const whenLabel = (start: string, end: string, timeZone: string) => {
  const s = new Date(start);
  const day = s.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  });
  const t = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
  return `${day}, ${t(s)} – ${t(new Date(end))}`;
};

/** Lengths to try when the link doesn't say which one to show first. */
const COMMON = [30, 60, 15, 45, 20, 90, 120, 10, 25, 50, 75, 180, 240];

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
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  /** What the shown page was loaded for, to skip a repeat request. */
  const loadedFor = useRef("");

  useEffect(() => {
    let alive = true;
    const key = `${duration}|${date}|${tz}|${reloads}`;
    if (loadedFor.current === key) return;
    const fetchPage = (d: number) =>
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
        if (duration) {
          const next = await fetchPage(duration);
          if (!alive) return;
          loadedFor.current = key;
          setPage(next);
          return;
        }
        // The page's lengths come with the page, which needs a length to ask
        // for: try the one in the link, then common ones.
        const fromLink = Number(
          new URLSearchParams(location.search).get("duration"),
        );
        const tries = [...new Set([fromLink, ...COMMON])].filter(
          (n) => n >= 5 && n <= 480,
        );
        for (const t of tries) {
          try {
            const next = await fetchPage(t);
            if (!alive) return;
            loadedFor.current = `${t}|${date}|${tz}|${reloads}`;
            setPage(next);
            setDuration(t);
            return;
          } catch (e) {
            if ((e as HttpError).status !== 422) throw e;
          }
        }
        throw new Error(
          "This booking page couldn't be loaded. Ask the host for a new link.",
        );
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

  if (receipt)
    return receipt.needs_confirmation ? (
      <Message
        title="Check your email to confirm"
        body={`We sent a link to ${email}. Open it to confirm ${whenLabel(receipt.start_at, receipt.end_at, tz)}. The time is held for you until then.`}
      />
    ) : (
      <Message
        tone="ok"
        title="You're booked"
        body={`${page?.title ?? "Your booking"} · ${whenLabel(receipt.start_at, receipt.end_at, tz)}. A confirmation is on its way to ${email}.`}
      />
    );

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

  const byDay = new Map<string, BusyInterval[]>();
  for (const s of page.slots) {
    const key = localDateKey(new Date(s.start_at), tz);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const strip = Array.from({ length: 7 }, (_, n) => addDays(date, n));
  const shownDay =
    day && byDay.has(day) ? day : (strip.find((k) => byDay.has(k)) ?? null);
  const times = shownDay ? (byDay.get(shownDay) ?? []) : [];
  const keyLabel = (key: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(key + "T12:00:00Z").toLocaleDateString([], {
      ...opts,
      timeZone: "UTC",
    });
  const zones = timeZones();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slot || !duration) return;
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
      className="public-card booking-public fade-up"
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
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
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
          <button className="primary wide" disabled={sending}>
            {sending ? "Booking…" : "Book this time"}
          </button>
        </form>
      ) : (
        <div className="booking-picker">
          <div className="date-strip-head">
            <button
              type="button"
              className="icon-button"
              aria-label="Earlier days"
              disabled={date <= today}
              onClick={() =>
                setDate(addDays(date, -7) < today ? today : addDays(date, -7))
              }
            >
              <ChevronLeft size={18} />
            </button>
            <strong>
              {keyLabel(strip[0], { month: "long", day: "numeric" })} –{" "}
              {keyLabel(strip[6], { month: "long", day: "numeric" })}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Later days"
              onClick={() => setDate(addDays(date, 7))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="date-strip" role="group" aria-label="Days">
            {strip.map((k) => {
              const count = byDay.get(k)?.length ?? 0;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={shownDay === k}
                  className={shownDay === k ? "active" : ""}
                  disabled={!count}
                  aria-label={`${keyLabel(k, { weekday: "long", month: "long", day: "numeric" })}, ${count} ${count === 1 ? "time" : "times"}`}
                  onClick={() => setDay(k)}
                >
                  <small>{keyLabel(k, { weekday: "short" })}</small>
                  <strong>{keyLabel(k, { day: "numeric" })}</strong>
                </button>
              );
            })}
          </div>
          {loading ? (
            <p className="muted">Finding free times…</p>
          ) : loadError ? (
            <div className="error" role="alert">
              {loadError}
            </div>
          ) : times.length ? (
            <ul className="time-grid" aria-label="Free times">
              {times.map((s) => (
                <li key={s.start_at}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSlot(s)}
                  >
                    {new Date(s.start_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: tz,
                    })}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No free times these days. Try the next week.
            </p>
          )}
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
  return (
    <Message
      tone="ok"
      title="You're booked"
      body={`${whenLabel(state.receipt.start_at, state.receipt.end_at, deviceTimeZone())}. The details are in your email.`}
    />
  );
}

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
