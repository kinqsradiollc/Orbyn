import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarCheck,
  ChevronDown,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type {
  Booking,
  BookingPage,
  BookingPageInput,
  Team,
  TeamMember,
  User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { copyText, minutesLabel, plural, spanLabel } from "../../lib/planning";
import "./booking.css";

type Props = {
  user: User | null;
  teams: Team[];
  report: (e: unknown) => void;
};

type Draft = Required<Omit<BookingPageInput, "co_hosts">> & {
  co_hosts: { user_id: string; required: boolean }[];
};

const LENGTHS = [15, 20, 30, 45, 60, 90, 120];
const blank = (): Draft => ({
  slug: "",
  title: "",
  description: "",
  durations: [30],
  window_days: 14,
  min_notice_minutes: 240,
  buffer_minutes: 0,
  max_per_day: null,
  location: "",
  meeting_url: "",
  active: true,
  co_hosts: [],
});
const draftFrom = (p: BookingPage): Draft => ({
  slug: p.slug,
  title: p.title,
  description: p.description,
  durations: p.durations,
  window_days: p.window_days,
  min_notice_minutes: p.min_notice_minutes,
  buffer_minutes: p.buffer_minutes,
  max_per_day: p.max_per_day,
  location: p.location,
  meeting_url: p.meeting_url,
  active: p.active,
  co_hosts: p.hosts
    .filter((h) => h.user_id !== p.owner_id)
    .map((h) => ({ user_id: h.user_id, required: h.required })),
});
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** The public address of a booking page. */
export const bookingLink = (slug: string) =>
  location.protocol === "file:"
    ? `/book/${slug}`
    : `${window.location.origin}/book/${slug}`;

/**
 * Booking pages: a public page where people pick a time that fits you (and
 * any co-hosts), plus the bookings each page has taken.
 */
export function BookingView({ user, teams, report }: Props) {
  const [pages, setPages] = useState<BookingPage[] | null>(null);
  const [editing, setEditing] = useState<BookingPage | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const action = useAction(report);

  const load = () =>
    client.listBookingPages().then(setPages, (e) => {
      setPages([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = (p: BookingPage) => {
    if (!window.confirm(`Delete “${p.title}”? Its link stops working.`)) return;
    void action.run(async () => {
      await client.deleteBookingPage(p.id);
      await load();
      return `Deleted “${p.title}”.`;
    });
  };

  const copy = (p: BookingPage) =>
    void copyText(bookingLink(p.slug)).then((ok) => ok && setCopied(p.id));

  return (
    <>
      {editing && (
        <PageForm
          key={editing === "new" ? "new" : editing.id}
          page={editing === "new" ? null : editing}
          user={user}
          teams={teams}
          report={report}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      <section className="card">
        <div className="section-heading">
          <h2>
            Your booking pages <span>{pages?.length ?? 0}</span>
          </h2>
          {!editing && (
            <button className="primary" onClick={() => setEditing("new")}>
              <Plus size={15} /> New booking page
            </button>
          )}
        </div>
        <OutcomeNote outcome={action.outcome} />
        {pages === null ? (
          <p className="muted pad">Loading booking pages…</p>
        ) : !pages.length ? (
          <EmptyState
            icon={CalendarCheck}
            title="No booking pages yet."
            body="Share a link and let people pick a time that fits your calendar."
          />
        ) : (
          pages.map((p) => {
            const mine = p.owner_id === user?.id;
            return (
              <article key={p.id} className="booking-page-row">
                <div className="booking-page-main">
                  <strong>
                    {p.title}
                    <span
                      className={
                        "status-pill " + (p.active ? "active" : "disabled")
                      }
                    >
                      {p.active ? "Taking bookings" : "Off"}
                    </span>
                  </strong>
                  <small>
                    {p.durations.map(minutesLabel).join(" / ")} · up to{" "}
                    {plural(p.window_days, "day")} ahead
                    {p.hosts.length > 1 &&
                      ` · with ${p.hosts
                        .filter((h) => h.user_id !== user?.id)
                        .map((h) => h.name)
                        .join(", ")}`}
                  </small>
                  <span className="booking-link">
                    <code>{bookingLink(p.slug)}</code>
                    <button className="link-button" onClick={() => copy(p)}>
                      <Copy size={12} />{" "}
                      {copied === p.id ? "Copied" : "Copy link"}
                    </button>
                    {location.protocol !== "file:" && (
                      <a
                        className="link-button"
                        href={bookingLink(p.slug)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={12} /> Preview
                      </a>
                    )}
                  </span>
                </div>
                <div className="booking-page-actions">
                  <button
                    className="secondary"
                    aria-expanded={open === p.id}
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                  >
                    <ChevronDown size={14} /> Bookings
                  </button>
                  {mine && (
                    <>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${p.title}`}
                        onClick={() => setEditing(p)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${p.title}`}
                        disabled={action.pending}
                        onClick={() => remove(p)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
                {open === p.id && <Bookings page={p} report={report} />}
              </article>
            );
          })
        )}
      </section>
    </>
  );
}

function Bookings({
  page,
  report,
}: {
  page: BookingPage;
  report: (e: unknown) => void;
}) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const action = useAction(report);
  const load = () =>
    client.listBookings(page.id).then(setBookings, (e) => {
      setBookings([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const cancel = (b: Booking) => {
    if (!window.confirm(`Cancel ${b.name}'s booking? They'll get an email.`))
      return;
    void action.run(async () => {
      await client.cancelBooking(page.id, b.id);
      await load();
      return "Booking cancelled.";
    });
  };

  const upcoming = (bookings ?? []).filter(
    (b) => Date.parse(b.end_at) > Date.now(),
  );
  return (
    <div className="booking-list">
      {bookings === null ? (
        <p className="muted">Loading bookings…</p>
      ) : !upcoming.length ? (
        <p className="muted">No upcoming bookings.</p>
      ) : (
        <ul>
          {upcoming.map((b) => (
            <li key={b.id}>
              <span>
                <strong>
                  {new Date(b.start_at).toLocaleDateString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                  , {spanLabel(b.start_at, b.end_at)}
                </strong>
                <small>
                  {b.name} · {b.email}
                  {b.status === "pending" && " · waiting for them to confirm"}
                </small>
                {b.note && <small className="booking-note">“{b.note}”</small>}
              </span>
              <button
                className="danger-text"
                disabled={action.pending}
                onClick={() => cancel(b)}
              >
                <X size={13} /> Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
      <OutcomeNote outcome={action.outcome} />
    </div>
  );
}

function PageForm({
  page,
  user,
  teams,
  report,
  onClose,
  onSaved,
}: {
  page: BookingPage | null;
  user: User | null;
  teams: Team[];
  report: (e: unknown) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    page ? draftFrom(page) : blank(),
  );
  const [slugTouched, setSlugTouched] = useState(!!page);
  const [people, setPeople] = useState<TeamMember[]>([]);
  const action = useAction(report);

  // Co-hosts come from the people in your teams.
  useEffect(() => {
    let alive = true;
    Promise.all(teams.map((t) => client.getTeam(t.id))).then(
      (details) => {
        if (!alive) return;
        const seen = new Map<string, TeamMember>();
        for (const d of details)
          for (const m of d.members)
            if (m.user_id !== user?.id && !seen.has(m.user_id))
              seen.set(m.user_id, m);
        setPeople(
          [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [teams, user?.id]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const lengths = [...new Set([...LENGTHS, ...draft.durations])].sort(
    (a, b) => a - b,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.durations.length) {
      action.setOutcome({ ok: false, text: "Offer at least one length." });
      return;
    }
    const body: BookingPageInput = {
      ...draft,
      slug: draft.slug.trim().toLowerCase(),
      title: draft.title.trim(),
      description: draft.description.trim(),
      location: draft.location.trim(),
      meeting_url: draft.meeting_url.trim(),
    };
    void action
      .run(async () => {
        if (page) await client.updateBookingPage(page.id, body);
        else await client.createBookingPage(body);
      })
      .then((ok) => ok && void onSaved());
  };

  return (
    <section
      className="card booking-form-card"
      aria-labelledby="booking-form-title"
    >
      <div className="section-heading">
        <h2 id="booking-form-title">
          {page ? "Edit booking page" : "New booking page"}
        </h2>
        <button
          className="icon-button"
          aria-label="Close form"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form className="settings-form booking-form" onSubmit={submit}>
        <div className="settings-grid">
          <div className="settings-field wide">
            <label htmlFor="bp-title">Title</label>
            <input
              id="bp-title"
              required
              autoFocus
              maxLength={120}
              value={draft.title}
              placeholder="Coffee chat"
              onChange={(e) => {
                set("title", e.target.value);
                if (!slugTouched) set("slug", slugify(e.target.value));
              }}
            />
          </div>
          <div className="settings-field wide">
            <label htmlFor="bp-slug">Link</label>
            <div className="field-row slug-row">
              <span className="slug-prefix" aria-hidden="true">
                {bookingLink("")}
              </span>
              <input
                id="bp-slug"
                required
                minLength={3}
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase letters, numbers and single dashes"
                value={draft.slug}
                aria-describedby="bp-slug-hint"
                onChange={(e) => {
                  setSlugTouched(true);
                  set("slug", e.target.value.toLowerCase());
                }}
              />
            </div>
            <small id="bp-slug-hint" className="field-hint">
              Lowercase letters, numbers and single dashes.
            </small>
          </div>
          <div className="settings-field wide">
            <label htmlFor="bp-desc">Description</label>
            <textarea
              id="bp-desc"
              rows={3}
              maxLength={2000}
              value={draft.description}
              placeholder="What the time is for, and anything to bring."
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <fieldset className="settings-field wide check-group">
            <legend>Lengths people can pick (up to 4)</legend>
            <div className="day-toggles">
              {lengths.map((m) => {
                const on = draft.durations.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    className={on ? "active" : ""}
                    disabled={!on && draft.durations.length >= 4}
                    onClick={() =>
                      set(
                        "durations",
                        on
                          ? draft.durations.filter((x) => x !== m)
                          : [...draft.durations, m].sort((a, b) => a - b),
                      )
                    }
                  >
                    {minutesLabel(m)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="settings-field">
            <label htmlFor="bp-window">Days ahead to show</label>
            <input
              id="bp-window"
              type="number"
              min={1}
              max={90}
              required
              value={draft.window_days}
              onChange={(e) => set("window_days", Number(e.target.value))}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="bp-notice">Minimum notice (minutes)</label>
            <input
              id="bp-notice"
              type="number"
              min={0}
              max={20160}
              required
              value={draft.min_notice_minutes}
              aria-describedby="bp-notice-hint"
              onChange={(e) =>
                set("min_notice_minutes", Number(e.target.value))
              }
            />
            <small id="bp-notice-hint" className="field-hint">
              {minutesLabel(draft.min_notice_minutes)} before a booking can
              start.
            </small>
          </div>
          <div className="settings-field">
            <label htmlFor="bp-buffer">Buffer between bookings (min)</label>
            <input
              id="bp-buffer"
              type="number"
              min={0}
              max={120}
              required
              value={draft.buffer_minutes}
              onChange={(e) => set("buffer_minutes", Number(e.target.value))}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="bp-max">Most bookings a day</label>
            <input
              id="bp-max"
              type="number"
              min={1}
              max={50}
              placeholder="No limit"
              value={draft.max_per_day ?? ""}
              onChange={(e) =>
                set(
                  "max_per_day",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </div>
          <div className="settings-field">
            <label htmlFor="bp-location">Location</label>
            <input
              id="bp-location"
              maxLength={300}
              value={draft.location}
              placeholder="Office, a café, a phone call…"
              onChange={(e) => set("location", e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="bp-meeting">Meeting link</label>
            <input
              id="bp-meeting"
              type="url"
              maxLength={500}
              pattern="https?://\S+"
              title="Meeting links start with https://"
              value={draft.meeting_url}
              placeholder="https://"
              onChange={(e) => set("meeting_url", e.target.value)}
            />
          </div>
          <label className="switch-line settings-field wide">
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={draft.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            <span>
              Taking bookings
              <small>Switch off to hide the page without deleting it.</small>
            </span>
          </label>
          <fieldset className="settings-field wide check-group">
            <legend>Co-hosts</legend>
            {!people.length ? (
              <small className="field-hint">
                People in your teams can host with you. Join or make a team to
                add co-hosts.
              </small>
            ) : (
              <ul className="cohost-list">
                {people.map((m) => {
                  const host = draft.co_hosts.find(
                    (h) => h.user_id === m.user_id,
                  );
                  return (
                    <li key={m.user_id}>
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={!!host}
                          disabled={!host && draft.co_hosts.length >= 10}
                          onChange={() =>
                            set(
                              "co_hosts",
                              host
                                ? draft.co_hosts.filter(
                                    (h) => h.user_id !== m.user_id,
                                  )
                                : [
                                    ...draft.co_hosts,
                                    { user_id: m.user_id, required: true },
                                  ],
                            )
                          }
                        />
                        {m.name}
                        <small>{m.email}</small>
                      </label>
                      {host && (
                        <label className="switch-line compact">
                          <input
                            type="checkbox"
                            role="switch"
                            className="ai-switch"
                            checked={host.required}
                            onChange={(e) =>
                              set(
                                "co_hosts",
                                draft.co_hosts.map((h) =>
                                  h.user_id === m.user_id
                                    ? { ...h, required: e.target.checked }
                                    : h,
                                ),
                              )
                            }
                          />
                          <span>
                            {host.required ? "Must be free" : "Optional"}
                          </span>
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        </div>
        <div className="settings-footer">
          <button className="primary" disabled={action.pending}>
            {action.pending ? "Saving…" : page ? "Save page" : "Create page"}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <OutcomeNote outcome={action.outcome} />
        </div>
      </form>
    </section>
  );
}
