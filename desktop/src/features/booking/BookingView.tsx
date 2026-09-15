import { useCallback, useEffect, useState } from "react";
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Copy,
  ExternalLink,
  History,
  Hourglass,
  Inbox,
  Pencil,
  Percent,
  Plus,
  Trash2,
  UserX,
} from "lucide-react";
import {
  dateLabel,
  type BookingPage,
  type BookingStats,
  type BookingView as ListView,
  type Team,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { copyText, minutesLabel, plural } from "../../lib/planning";
import { bookingLink, type BookingFocus } from "./bookingUi";
import { BookingsInbox } from "./BookingsInbox";
import { PageForm } from "./PageForm";
import { OpenInvites } from "./OpenInvites";
import { ProfileCard } from "./ProfileCard";
import "./booking.css";

export { bookingLink, type BookingFocus };

type Props = {
  user: User | null;
  teams: Team[];
  report: (e: unknown) => void;
  /** A booking to open, from a notification. */
  focus?: BookingFocus | null;
};

type Tab = "bookings" | "pages" | "invites";

/**
 * Booking pages: a public page where people pick a time that fits you (and
 * any co-hosts), one inbox to track every booking they take, offered times
 * for one person, and your profile page.
 */
export function BookingView({ user, teams, report, focus = null }: Props) {
  const [tab, setTab] = useState<Tab>("bookings");
  const [pages, setPages] = useState<BookingPage[] | null>(null);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [view, setView] = useState<ListView>("upcoming");
  const [pageId, setPageId] = useState("");
  const [editing, setEditing] = useState<BookingPage | "new" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const action = useAction(report);

  const loadPages = () =>
    client.listBookingPages().then(
      (rows) => {
        setPages(rows);
        return rows;
      },
      (e) => {
        setPages([]);
        report(e);
        return [] as BookingPage[];
      },
    );
  const loadStats = (id: string) =>
    client.bookingStats(id || undefined).then(setStats, report);

  useEffect(() => {
    void loadPages().then((rows) => {
      // Nothing to track yet: start where pages are made.
      if (!rows.length && !focus) setTab("pages");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void loadStats(pageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  useEffect(() => {
    if (focus) setTab("bookings");
  }, [focus]);

  // Actions in the inbox change the counts on the stats and page cards.
  const refreshCounts = useCallback(() => {
    void loadStats(pageId);
    void loadPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const showBookings = (id: string, next: ListView) => {
    setPageId(id);
    setView(next);
    setTab("bookings");
  };

  const remove = (p: BookingPage) => {
    if (!window.confirm(`Delete “${p.title}”? Its link stops working.`)) return;
    void action.run(async () => {
      await client.deleteBookingPage(p.id);
      if (pageId === p.id) setPageId("");
      await loadPages();
      await loadStats(pageId === p.id ? "" : pageId);
      return `Deleted “${p.title}”.`;
    });
  };

  const copy = (p: BookingPage) =>
    void copyText(bookingLink(p.slug)).then((ok) => ok && setCopied(p.id));

  const newPage = () => {
    setTab("pages");
    setEditing("new");
  };

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
            await loadPages();
          }}
        />
      )}
      {stats && <StatsStrip stats={stats} />}
      <div className="tabs" role="tablist" aria-label="Booking">
        <button
          role="tab"
          id="booking-tab-bookings"
          aria-selected={tab === "bookings"}
          aria-controls="booking-panel"
          className={tab === "bookings" ? "active" : ""}
          onClick={() => setTab("bookings")}
        >
          <Inbox size={15} aria-hidden="true" /> Bookings
          {!!stats?.needs_approval && (
            <span className="count-badge">
              {stats.needs_approval}
              <span className="sr-only"> need approval</span>
            </span>
          )}
        </button>
        <button
          role="tab"
          id="booking-tab-pages"
          aria-selected={tab === "pages"}
          aria-controls="booking-panel"
          className={tab === "pages" ? "active" : ""}
          onClick={() => setTab("pages")}
        >
          <CalendarCheck size={15} aria-hidden="true" /> Pages
        </button>
        <button
          role="tab"
          id="booking-tab-invites"
          aria-selected={tab === "invites"}
          aria-controls="booking-panel"
          className={tab === "invites" ? "active" : ""}
          onClick={() => setTab("invites")}
        >
          <CalendarRange size={15} aria-hidden="true" /> Offer times
        </button>
      </div>
      <div
        role="tabpanel"
        id="booking-panel"
        aria-labelledby={"booking-tab-" + tab}
      >
        {tab === "bookings" ? (
          <BookingsInbox
            pages={pages ?? []}
            stats={stats}
            view={view}
            onView={setView}
            pageId={pageId}
            onPageId={setPageId}
            focus={focus}
            onChanged={refreshCounts}
            onNewPage={newPage}
            report={report}
          />
        ) : tab === "invites" ? (
          <OpenInvites report={report} />
        ) : (
          <>
            <ProfileCard report={report} />
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
                  // Your own pages, and your teams' pages you manage.
                  const mine = p.can_edit ?? p.owner_id === user?.id;
                  return (
                    <article key={p.id} className="booking-page-row">
                      <div className="booking-page-main">
                        <strong>
                          <i
                            className="list-dot"
                            style={{ background: p.color }}
                            aria-hidden="true"
                          />
                          {p.title}
                          {p.team_name && (
                            <span className="chip">{p.team_name}</span>
                          )}
                          <span
                            className={
                              "status-pill " +
                              (p.active ? "active" : "disabled")
                            }
                          >
                            {p.active ? "Taking bookings" : "Off"}
                          </span>
                          {p.counts.needs_approval > 0 && (
                            <button
                              className="chip is-warn chip-button"
                              onClick={() =>
                                showBookings(p.id, "needs_approval")
                              }
                            >
                              {p.counts.needs_approval} to approve
                            </button>
                          )}
                        </strong>
                        <small>
                          {plural(p.counts.upcoming, "upcoming booking")} ·{" "}
                          {p.durations.map(minutesLabel).join(" / ")} · up to{" "}
                          {plural(p.window_days, "day")} ahead
                          {p.requires_approval && " · needs approval"}
                          {p.hosts.length > 1 &&
                            ` · with ${p.hosts
                              .filter((h) => h.user_id !== user?.id)
                              .map((h) => h.name)
                              .join(", ")}`}
                        </small>
                        <span className="booking-link">
                          <code>{bookingLink(p.slug)}</code>
                          <button
                            className="link-button"
                            onClick={() => copy(p)}
                          >
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
                          onClick={() => showBookings(p.id, "upcoming")}
                        >
                          <Inbox size={14} /> Bookings
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
                    </article>
                  );
                })
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

/** Upcoming, waiting, recent, cancelled and missed bookings at a glance. */
function StatsStrip({ stats }: { stats: BookingStats }) {
  return (
    <div className="stats booking-stats" role="group" aria-label="Summary">
      <div>
        <span>
          <CalendarDays size={15} aria-hidden="true" /> Upcoming
        </span>
        <strong>{stats.upcoming}</strong>
        <small>
          {stats.next
            ? `Next: ${dateLabel(stats.next.start_at)}`
            : "Nothing booked yet"}
        </small>
      </div>
      <div>
        <span>
          <Hourglass size={15} aria-hidden="true" /> Needs approval
        </span>
        <strong>{stats.needs_approval}</strong>
        <small>
          {stats.awaiting_email
            ? `${stats.awaiting_email} awaiting email`
            : "Requests waiting for you"}
        </small>
      </div>
      <div>
        <span>
          <History size={15} aria-hidden="true" /> Last 30 days
        </span>
        <strong>{stats.last_30_days}</strong>
        <small>Bookings made</small>
      </div>
      <div>
        <span>
          <Percent size={15} aria-hidden="true" /> Cancellation rate
        </span>
        <strong>{Math.round(stats.cancellation_rate * 100)}%</strong>
        <small>{plural(stats.cancelled, "cancellation")}</small>
      </div>
      <div>
        <span>
          <UserX size={15} aria-hidden="true" /> No-shows
        </span>
        <strong>{stats.no_show}</strong>
        <small>Marked by hosts</small>
      </div>
    </div>
  );
}
