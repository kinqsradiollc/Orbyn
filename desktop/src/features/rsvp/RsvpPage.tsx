import { useEffect, useState } from "react";
import {
  CalendarClock,
  Clock,
  Globe,
  MapPin,
  Orbit,
  Repeat,
  UserRound,
  Video,
} from "lucide-react";
import {
  describeRrule,
  type AttendeeStatus,
  type HttpError,
  type RsvpView,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { useNoIndex } from "../../hooks/useNoIndex";
import { deviceTimeZone, errorText } from "../../lib/planning";
import { Message } from "../booking/bookingUi";
import "../booking/booking.css";
import "./rsvp.css";

type Props = {
  path: string;
  /** Absent in the native desktop app, which has no homepage. */
  onHome?: () => void;
};

type Answer = "accepted" | "tentative" | "declined";
const ANSWERS: { id: Answer; label: string }[] = [
  { id: "accepted", label: "Accept" },
  { id: "tentative", label: "Maybe" },
  { id: "declined", label: "Decline" },
];
const STATUS_TEXT: Record<AttendeeStatus, string> = {
  needs_action: "not yet",
  accepted: "going",
  tentative: "maybe",
  declined: "not going",
};

/** "Tuesday, September 22, 9:00 AM – 10:00 AM" (or dates for all-day events). */
function whenText(v: RsvpView) {
  const start = new Date(v.start_at);
  if (v.all_day) {
    // Whole days are dates in the event's own zone; the end is exclusive.
    const day = (d: Date) =>
      d.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: v.timezone,
      });
    const last = v.end_at ? new Date(Date.parse(v.end_at) - 1) : start;
    const first = day(start);
    const final = day(last);
    return first === final ? `${first}, all day` : `${first} – ${final}`;
  }
  const date = start.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return v.end_at
    ? `${date}, ${time(start)} – ${time(new Date(v.end_at))}`
    : `${date}, ${time(start)}`;
}

/**
 * The invitation behind an email link, `/rsvp/:token`, no sign-in: what,
 * when (in the viewer's time zone), where, and Accept / Maybe / Decline.
 * Opening the page never answers; only the buttons do.
 */
export function RsvpPage({ path, onHome }: Props) {
  useNoIndex();
  const token = decodeURIComponent(path.split("/").filter(Boolean)[1] ?? "");
  const suggested = new URLSearchParams(window.location.search).get("r");
  const [view, setView] = useState<RsvpView | null>(null);
  const [missing, setMissing] = useState(!token);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Answer | null>(null);
  const [answered, setAnswered] = useState<Answer | null>(null);

  useEffect(() => {
    document.title = "Invitation · Orbyn";
    if (!token) return;
    let alive = true;
    client.getRsvp(token).then(
      (v) => {
        if (!alive) return;
        setView(v);
        document.title = `${v.title} · Invitation · Orbyn`;
      },
      (e) => {
        if (!alive) return;
        if ((e as HttpError).status === 404) setMissing(true);
        else setError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [token]);

  const answer = async (status: Answer) => {
    setPending(status);
    setError("");
    try {
      setView(await client.answerRsvp(token, status));
      setAnswered(status);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  };

  const zone = deviceTimeZone();
  const hinted = ANSWERS.find((a) => a.id === suggested);

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
        {missing ? (
          <Message
            title="This invitation link isn't valid."
            body="The event may have been cancelled, or the link is incomplete."
          />
        ) : !view ? (
          error ? (
            <Message title="Couldn't load the invitation." body={error} />
          ) : (
            <p className="muted" role="status">
              Loading the invitation…
            </p>
          )
        ) : (
          <section
            className="public-card rsvp-card fade-up"
            aria-labelledby="rsvp-title"
          >
            <p className="eyebrow">YOU&apos;RE INVITED</p>
            <h1 id="rsvp-title">{view.title}</h1>
            <ul className="rsvp-facts">
              <li>
                <UserRound size={16} aria-hidden="true" /> From {view.organizer}
              </li>
              <li>
                <Clock size={16} aria-hidden="true" /> {whenText(view)}
              </li>
              {view.rrule && (
                <li>
                  <Repeat size={16} aria-hidden="true" />{" "}
                  {describeRrule(view.rrule)}
                </li>
              )}
              {!view.all_day && (
                <li>
                  <Globe size={16} aria-hidden="true" /> Times in{" "}
                  {zone.replaceAll("_", " ")}
                </li>
              )}
              {view.location && (
                <li>
                  <MapPin size={16} aria-hidden="true" /> {view.location}
                </li>
              )}
              {view.meeting_url && (
                <li>
                  <Video size={16} aria-hidden="true" />{" "}
                  <a href={view.meeting_url} target="_blank" rel="noreferrer">
                    Meeting link
                  </a>
                </li>
              )}
            </ul>
            <p className="rsvp-for">
              <CalendarClock size={14} aria-hidden="true" /> For{" "}
              {view.name || view.email}
              {view.status !== "needs_action" &&
                ` · Your answer: ${STATUS_TEXT[view.status]}`}
            </p>
            {hinted && view.status === "needs_action" && !answered && (
              <p className="muted">
                You chose “{hinted.label}” in the email. Confirm it below.
              </p>
            )}
            <div className="rsvp-answers" role="group" aria-label="Your answer">
              {ANSWERS.map((a) => (
                <button
                  key={a.id}
                  className={view.status === a.id ? "primary" : "secondary"}
                  aria-pressed={view.status === a.id}
                  autoFocus={a.id === hinted?.id}
                  disabled={!!pending}
                  onClick={() => void answer(a.id)}
                >
                  {pending === a.id ? "Sending…" : a.label}
                </button>
              ))}
            </div>
            {answered && (
              <p className="inline-outcome ok" role="status">
                Thanks, the organizer has been told. You can change your answer
                here any time.
              </p>
            )}
            {error && (
              <p className="inline-outcome fail" role="alert">
                {error}
              </p>
            )}
          </section>
        )}
      </main>
      <footer>
        Invitation by Orbyn · your answer goes only to the organizer.
      </footer>
    </div>
  );
}
