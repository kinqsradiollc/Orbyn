import { Select } from "../../components/Select";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Clock,
  Globe,
  MapPin,
  Video,
} from "lucide-react";
import {
  dateLabel,
  localDateKey,
  type BookingReceipt,
  type BusyInterval,
  type HttpError,
  type PublicInvite,
} from "@orbyn/core";
import { client } from "../../lib/api";
import {
  deviceTimeZone,
  errorText,
  minutesLabel,
  timeZones,
} from "../planner/planning";
import { Message, whenLabel } from "./bookingUi";
import { PublicShell } from "./PublicShell";
import { SlotPicker } from "./SlotPicker";

type Props = {
  path: string;
  onHome?: () => void;
};

/** `/invite/:token`: pick one of the times someone offered you. No sign-in. */
export function PublicInvitePage({ path, onHome }: Props) {
  const token = decodeURIComponent(path.split("/").filter(Boolean)[1] ?? "");
  return (
    <PublicShell
      onHome={onHome}
      footer="Scheduling by Orbyn · your details go only to the host."
    >
      {token ? (
        <InviteBook key={token} token={token} />
      ) : (
        <Message
          title="This link isn't complete."
          body="Check the link and try again."
        />
      )}
    </PublicShell>
  );
}

const CLOSED: Record<string, { title: string; body: string }> = {
  booked: {
    title: "This invite has been used",
    body: "A time was already picked from it. Check your email for the booking.",
  },
  expired: {
    title: "This invite has expired",
    body: "Ask whoever sent it for a new link.",
  },
  cancelled: {
    title: "This invite was withdrawn",
    body: "Ask whoever sent it for a new link.",
  },
};

function InviteBook({ token }: { token: string }) {
  const [tz, setTz] = useState(deviceTimeZone);
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<BusyInterval | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError("");
    setMissing(false);
    client.getPublicInvite(token, tz).then(
      (next) => {
        if (!alive) return;
        setInvite(next);
        setLoading(false);
        // Start the strip at the first offered day.
        setDate(
          (d) =>
            d ??
            (next.slots[0]
              ? localDateKey(new Date(next.slots[0].start_at), tz)
              : localDateKey(new Date(), tz)),
        );
      },
      (e) => {
        if (!alive) return;
        setLoading(false);
        if ((e as HttpError).status === 404) setMissing(true);
        else setLoadError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [token, tz, reloads]);

  useEffect(() => {
    document.title = invite
      ? `${invite.title} · Pick a time`
      : "Pick a time · Orbyn";
  }, [invite]);

  if (receipt && invite)
    return (
      <Message
        tone="ok"
        title="You're booked"
        body={`${invite.title} · ${whenLabel(receipt.start_at, receipt.end_at, tz)}. A confirmation with a link to change or cancel it is on its way to ${email}.`}
      >
        {receipt.confirmation_message && (
          <p className="booking-confirmation-message">
            {receipt.confirmation_message}
          </p>
        )}
      </Message>
    );
  if (missing)
    return (
      <Message
        title="This invite link isn't valid."
        body="Check the link, or ask whoever sent it for a new one."
      />
    );
  if (!invite)
    return loading ? (
      <section className="public-card">
        <p className="muted">Loading times…</p>
      </section>
    ) : (
      <Message
        title="Couldn't load this invite"
        body={loadError || "Try again in a moment."}
      >
        <button className="secondary" onClick={() => setReloads((r) => r + 1)}>
          Retry
        </button>
      </Message>
    );
  if (invite.status !== "open") {
    const closed = CLOSED[invite.status] ?? CLOSED.expired;
    return <Message title={closed.title} body={closed.body} />;
  }

  const zones = timeZones();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slot || sending || loading) return;
    setSending(true);
    setFormError("");
    try {
      setReceipt(
        await client.bookInvite(token, {
          start_at: slot.start_at,
          name: name.trim(),
          email: email.trim(),
          note: note.trim(),
          timezone: tz,
        }),
      );
    } catch (err) {
      setFormError(errorText(err));
      const status = (err as HttpError).status;
      if (status === 409 || status === 410) {
        setSlot(null);
        setReloads((r) => r + 1);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="public-card booking-public"
      aria-labelledby="invite-title"
    >
      <div className="booking-intro">
        <span className="eyebrow">Pick a time</span>
        <h1 id="invite-title">{invite.title}</h1>
        <p className="booking-hosts">With {invite.hosts.join(", ")}</p>
        <ul className="booking-facts">
          {invite.location && (
            <li>
              <MapPin size={14} aria-hidden="true" /> {invite.location}
            </li>
          )}
          {invite.has_meeting_link && (
            <li>
              <Video size={14} aria-hidden="true" /> Video link sent after
              booking
            </li>
          )}
          <li>
            <Clock size={14} aria-hidden="true" />{" "}
            {minutesLabel(invite.duration)}
          </li>
          <li>
            <CalendarClock size={14} aria-hidden="true" /> Expires{" "}
            {dateLabel(invite.expires_at)}
          </li>
          <li>
            <Globe size={14} aria-hidden="true" />
            <label>
              <span className="sr-only">Your time zone</span>
              <Select
                value={tz}
                disabled={sending}
                onChange={(e) => {
                  setTz(e.target.value);
                  setSlot(null);
                  setDate(null);
                  setDay(null);
                }}
              >
                {!zones.includes(tz) && <option value={tz}>{tz}</option>}
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </label>
          </li>
        </ul>
      </div>

      {slot ? (
        <form
          className="booking-form-public"
          aria-busy={sending}
          onSubmit={(e) => void submit(e)}
        >
          <fieldset disabled={sending}>
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
              Note (optional)
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
          </fieldset>
        </form>
      ) : (
        <div>
          {invite.slots.length ? (
            <SlotPicker
              tz={tz}
              date={date ?? localDateKey(new Date(), tz)}
              onDateChange={setDate}
              slots={invite.slots}
              loading={loading}
              error={loadError}
              onRetry={() => setReloads((r) => r + 1)}
              onPick={setSlot}
              day={day}
              onDayChange={setDay}
            />
          ) : (
            <p className="muted">
              No offered times are free. Ask the sender for new times.
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
