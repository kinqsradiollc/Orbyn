import { useConfirm } from "../../components/Confirm";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  MoreHorizontal,
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
import { session } from "../../lib/session";
import { Popover } from "../../components/Popover";
import { useElementWidth } from "../../hooks/useElementWidth";
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
  const pane = useElementWidth();
  const { ask, tell } = useConfirm();
  const [tab, setTab] = useState<Tab>("bookings");
  const [pages, setPages] = useState<BookingPage[] | null>(null);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [view, setView] = useState<ListView>("upcoming");
  const [pageId, setPageId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BookingPage | "new" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const action = useAction(report);
  const scope = useId();
  const [menu, setMenu] = useState<{
    page: BookingPage;
    anchor: DOMRect;
  } | null>(null);
  const [pagesFailed, setPagesFailed] = useState(false);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [statsFailed, setStatsFailed] = useState(false);
  const pagesRequest = useRef(0);
  const statsRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pagesRequest.current++;
      statsRequest.current++;
    };
  }, []);

  const loadPages = async () => {
    const ticket = ++pagesRequest.current;
    const account = session.get();
    setPagesLoading(true);
    setPagesFailed(false);
    try {
      const rows = await client.listBookingPages();
      if (
        !mounted.current ||
        ticket !== pagesRequest.current ||
        account !== session.get()
      )
        return null;
      setPages(rows);
      return rows;
    } catch (e) {
      if (
        mounted.current &&
        ticket === pagesRequest.current &&
        account === session.get()
      ) {
        setPagesFailed(true);
        report(e);
      }
      return null;
    } finally {
      if (
        mounted.current &&
        ticket === pagesRequest.current &&
        account === session.get()
      )
        setPagesLoading(false);
    }
  };
  const loadStats = async (id: string) => {
    const ticket = ++statsRequest.current;
    const account = session.get();
    setStats(null);
    setStatsFailed(false);
    try {
      const next = await client.bookingStats(id || undefined);
      if (
        mounted.current &&
        ticket === statsRequest.current &&
        account === session.get()
      )
        setStats(next);
    } catch (e) {
      if (
        mounted.current &&
        ticket === statsRequest.current &&
        account === session.get()
      ) {
        setStatsFailed(true);
        report(e);
      }
    }
  };

  useEffect(() => {
    setPages(null);
    setEditing(null);
    setEditorOpen(false);
    setPageId("");
    setCopied(null);
    void loadPages().then((rows) => {
      // Nothing to track yet: start where pages are made.
      if (rows && !rows.length && !focus) setTab("pages");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    void loadStats(pageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, user?.id]);
  useEffect(() => {
    if (focus) setTab("bookings");
  }, [focus]);

  useEffect(() => {
    setMenu(null);
  }, [tab, pages, user?.id]);

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

  const remove = async (p: BookingPage) => {
    const account = session.get();
    if (
      !(await ask({
        title: `Delete “${p.title}”? Its link stops working.`,
        body: "Existing bookings stay on your calendar.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    if (!mounted.current || account !== session.get()) return;
    void action.run(async () => {
      await client.deleteBookingPage(p.id);
      if (!mounted.current || account !== session.get()) return "";
      if (pageId === p.id) setPageId("");
      await loadPages();
      await loadStats(pageId === p.id ? "" : pageId);
      return `Deleted “${p.title}”.`;
    });
  };

  const copy = (p: BookingPage) =>
    void copyText(bookingLink(p.slug)).then((ok) => {
      if (ok && mounted.current) setCopied(p.id);
    });

  const openEditor = (page: BookingPage | "new") => {
    setEditing(page);
    setEditorOpen(true);
  };

  const newPage = () => {
    setTab("pages");
    openEditor("new");
  };

  return (
    <div
      ref={pane.ref}
      className={`booking-workspace${pane.width > 0 && pane.width < 900 ? " is-compact" : ""}${pane.width > 0 && pane.width < 700 ? " is-narrow" : ""}${pane.width > 0 && pane.width < 560 ? " is-small" : ""}`}
    >
      {editing && (
        <PageForm
          key={editing === "new" ? "new" : editing.id}
          visible={editorOpen}
          page={editing === "new" ? null : editing}
          user={user}
          teams={teams}
          report={report}
          onClose={() => setEditorOpen(false)}
          onSaved={async () => {
            setEditorOpen(false);
            setEditing(null);
            await loadPages();
          }}
        />
      )}
      {stats && <StatsStrip stats={stats} />}
      {statsFailed && (
        <p className="muted" role="alert">
          Couldn't load booking activity.{" "}
          <button
            className="link-button"
            onClick={() => void loadStats(pageId)}
          >
            Retry
          </button>
        </p>
      )}
      {menu && (
        <Popover
          anchor={menu.anchor}
          label={`${menu.page.title} options`}
          onClose={() => setMenu(null)}
        >
          <button
            onClick={() => {
              const page = menu.page;
              setMenu(null);
              openEditor(page);
            }}
          >
            <Pencil size={15} /> Edit page
          </button>
          <button
            disabled={action.pending}
            onClick={() => {
              const page = menu.page;
              setMenu(null);
              void remove(page);
            }}
          >
            <Trash2 size={15} /> Delete page
          </button>
        </Popover>
      )}
      <div className="tabs" role="tablist" aria-label="Booking">
        <button
          role="tab"
          id={`${scope}-booking-tab-bookings`}
          aria-selected={tab === "bookings"}
          aria-controls={`${scope}-booking-panel`}
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
          id={`${scope}-booking-tab-pages`}
          aria-selected={tab === "pages"}
          aria-controls={`${scope}-booking-panel`}
          className={tab === "pages" ? "active" : ""}
          onClick={() => setTab("pages")}
        >
          <CalendarCheck size={15} aria-hidden="true" /> Pages
        </button>
        <button
          role="tab"
          id={`${scope}-booking-tab-invites`}
          aria-selected={tab === "invites"}
          aria-controls={`${scope}-booking-panel`}
          className={tab === "invites" ? "active" : ""}
          onClick={() => setTab("invites")}
        >
          <CalendarRange size={15} aria-hidden="true" /> Offer times
        </button>
      </div>
      <div
        role="tabpanel"
        id={`${scope}-booking-panel`}
        aria-labelledby={`${scope}-booking-tab-${tab}`}
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
          <OpenInvites user={user} teams={teams} report={report} />
        ) : (
          <>
            <ProfileCard report={report} />
            <section className="card">
              <div className="section-heading">
                <h2>
                  Your booking pages <span>{pages?.length ?? 0}</span>
                </h2>
                {!editorOpen && (
                  <button className="primary" onClick={() => openEditor("new")}>
                    <Plus size={15} /> New booking page
                  </button>
                )}
              </div>
              <OutcomeNote outcome={action.outcome} />
              {pagesFailed && (
                <p className="muted pad" role="alert">
                  Couldn't load booking pages.{" "}
                  <button
                    className="link-button"
                    disabled={pagesLoading}
                    onClick={() => void loadPages()}
                  >
                    Retry
                  </button>
                </p>
              )}
              {pages === null ? (
                pagesLoading ? (
                  <p className="muted pad" role="status">
                    Loading booking pages…
                  </p>
                ) : null
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
                          {p.durations.map(minutesLabel).join(" / ")}
                        </small>
                        <details className="booking-field-help">
                          <summary>Page details</summary>
                          <small>
                            Up to {plural(p.window_days, "day")} ahead
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
                        </details>
                      </div>
                      <div className="booking-page-actions">
                        <button
                          className="secondary"
                          onClick={() => showBookings(p.id, "upcoming")}
                        >
                          <Inbox size={14} /> Bookings
                        </button>
                        {mine && (
                          <button
                            className="icon-button"
                            aria-label={`${p.title} options`}
                            aria-haspopup="dialog"
                            disabled={action.pending}
                            onClick={(event) =>
                              setMenu({
                                page: p,
                                anchor:
                                  event.currentTarget.getBoundingClientRect(),
                              })
                            }
                          >
                            <MoreHorizontal size={16} />
                          </button>
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
    </div>
  );
}

/** Upcoming, waiting, recent, cancelled and missed bookings at a glance. */
function StatsStrip({ stats }: { stats: BookingStats }) {
  return (
    <>
      <div
        className="stats booking-stats booking-stats-primary"
        role="group"
        aria-label="Summary"
      >
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
              : ""}
          </small>
        </div>
      </div>
      <details className="booking-field-help booking-activity">
        <summary>Booking activity</summary>
        <div
          className="stats booking-stats booking-stats-secondary"
          role="group"
          aria-label="Booking activity"
        >
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
      </details>
    </>
  );
}
