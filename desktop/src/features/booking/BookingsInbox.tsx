import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarCheck, Download, Plus, Search } from "lucide-react";
import type {
  Booking,
  BookingPage,
  BookingStats,
  BookingView as ListView,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { dayKey, minutesLabel } from "../../lib/planning";
import { BookingDrawer } from "./BookingDrawer";
import {
  BookingStatusPill,
  DEFAULT_COLOR,
  dayHeading,
  downloadText,
  type BookingFocus,
} from "./bookingUi";

const VIEWS: { id: ListView; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "needs_approval", label: "Needs approval" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];
const EMPTY: Record<ListView, [string, string]> = {
  upcoming: [
    "No upcoming bookings.",
    "New bookings show up here as soon as someone picks a time.",
  ],
  needs_approval: [
    "Nothing waiting for you.",
    "Requests on pages that need your approval show up here.",
  ],
  past: ["No past bookings yet.", "Bookings move here once they're over."],
  cancelled: [
    "No cancelled bookings.",
    "Cancelled, declined and expired bookings show up here.",
  ],
  all: ["No bookings yet.", "Share a booking page and bookings show up here."],
};
const PAGE_SIZE = 50;
/** The most rows the server sends at once. */
const MAX_LIMIT = 200;

type Props = {
  pages: BookingPage[];
  stats: BookingStats | null;
  view: ListView;
  onView: (view: ListView) => void;
  /** "" for every page. */
  pageId: string;
  onPageId: (id: string) => void;
  focus: BookingFocus | null;
  /** After an action: refresh the counts shown outside the inbox. */
  onChanged: () => void;
  onNewPage: () => void;
  report: (e: unknown) => void;
};

/** Every booking across your pages, by status, day and page. */
export function BookingsInbox({
  pages,
  stats,
  view,
  onView,
  pageId,
  onPageId,
  focus,
  onChanged,
  onNewPage,
  report,
}: Props) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [openId, setOpenId] = useState<string | null>(focus?.id ?? null);
  /** Rows to fetch again after an action, so pages from "Load more" stay. */
  const shown = useRef(PAGE_SIZE);
  const filterKey = `${view}|${pageId}|${q}`;
  const loadedKey = useRef("");
  const params = { view, page_id: pageId || undefined, q: q || undefined };

  // Search once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (focus) setOpenId(focus.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  useEffect(() => {
    let alive = true;
    if (loadedKey.current !== filterKey) {
      shown.current = PAGE_SIZE;
      setRows(null);
    }
    client
      .bookings({
        ...params,
        limit: Math.min(MAX_LIMIT, shown.current),
        offset: 0,
      })
      .then(
        (res) => {
          if (!alive) return;
          loadedKey.current = filterKey;
          setRows(res.rows);
          setTotal(res.total);
        },
        (e) => {
          if (!alive) return;
          setRows([]);
          setTotal(0);
          report(e);
        },
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reloads]);

  const loadMore = () => {
    if (!rows) return;
    const key = filterKey;
    setLoadingMore(true);
    client
      .bookings({ ...params, limit: PAGE_SIZE, offset: rows.length })
      .then((res) => {
        if (loadedKey.current !== key) return;
        const next = [...rows, ...res.rows];
        shown.current = next.length;
        setRows(next);
        setTotal(res.total);
      }, report)
      .finally(() => setLoadingMore(false));
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      downloadText("bookings.csv", await client.exportBookingsCsv(params));
    } catch (e) {
      report(e);
    } finally {
      setExporting(false);
    }
  };

  const close = useCallback(() => setOpenId(null), []);
  const changed = useCallback(() => {
    setReloads((r) => r + 1);
    onChanged();
  }, [onChanged]);

  // Consecutive rows on the same local day share a heading; the server's
  // order (soonest first, or latest first for past bookings) is kept.
  const groups: [string, Booking[]][] = [];
  for (const b of rows ?? []) {
    const key = dayKey(new Date(b.start_at));
    const last = groups[groups.length - 1];
    if (last?.[0] === key) last[1].push(b);
    else groups.push([key, [b]]);
  }
  const colors = new Map(pages.map((p) => [p.id, p.color]));

  return (
    <section className="card booking-inbox">
      <div className="section-heading booking-inbox-head">
        <div
          className="segmented booking-views"
          role="tablist"
          aria-label="Bookings to show"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? "active" : ""}
              onClick={() => onView(v.id)}
            >
              {v.label}
              {v.id === "needs_approval" && !!stats?.needs_approval && (
                <span className="count-badge">
                  {stats.needs_approval}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          className="secondary"
          disabled={exporting || !rows?.length}
          onClick={() => void exportCsv()}
        >
          <Download size={14} /> {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      <div className="filter-bar booking-filters">
        <label className="search booking-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search bookings</span>
          <input
            type="search"
            maxLength={100}
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {(pages.length > 1 || pageId) && (
          <label className="filter-select">
            Page
            <select value={pageId} onChange={(e) => onPageId(e.target.value)}>
              <option value="">All pages</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {rows === null ? (
        <p className="muted pad">Loading bookings…</p>
      ) : !rows.length ? (
        !pages.length ? (
          <EmptyState
            icon={CalendarCheck}
            title="No booking pages yet."
            body="Make a booking page and share its link. Bookings show up here."
          >
            <button className="primary" onClick={onNewPage}>
              <Plus size={15} /> New booking page
            </button>
          </EmptyState>
        ) : q ? (
          <EmptyState
            icon={Search}
            title={`No bookings match “${q}”.`}
            body="Try part of a name or an email address."
          />
        ) : (
          <EmptyState
            icon={CalendarCheck}
            title={EMPTY[view][0]}
            body={EMPTY[view][1]}
          />
        )
      ) : (
        <>
          {groups.map(([key, list], i) => (
            <div
              key={`${key}-${i}`}
              role="group"
              aria-labelledby={`booking-day-${key}-${i}`}
            >
              <h3 className="booking-day" id={`booking-day-${key}-${i}`}>
                {dayHeading(key)}
              </h3>
              <ul className="booking-rows">
                {list.map((b) => (
                  <li key={b.id}>
                    <button
                      className={
                        "booking-row" + (openId === b.id ? " active" : "")
                      }
                      onClick={() => setOpenId(b.id)}
                    >
                      <span className="booking-row-time">
                        {new Date(b.start_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        <small>
                          {minutesLabel(
                            (Date.parse(b.end_at) - Date.parse(b.start_at)) /
                              60_000,
                          )}
                        </small>
                      </span>
                      <span className="booking-row-main">
                        <strong>{b.name}</strong>
                        <small>{b.email}</small>
                      </span>
                      <span className="booking-row-page">
                        <i
                          className="list-dot"
                          style={{
                            background: colors.get(b.page_id) ?? DEFAULT_COLOR,
                          }}
                        />
                        <span>{b.page_title}</span>
                      </span>
                      <span className="booking-row-status">
                        <BookingStatusPill status={b.status} />
                        {b.no_show && (
                          <span className="chip is-danger">No-show</span>
                        )}
                        {b.reschedule_count > 0 && (
                          <span className="chip">Moved</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="table-footer">
            <small className="muted">
              Showing {rows.length} of {total}
            </small>
            {rows.length < total && (
              <button
                className="secondary"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </>
      )}

      {/* The drawer sits on the body so the card's motion can't move it. */}
      {openId &&
        createPortal(
          <BookingDrawer
            key={openId}
            id={openId}
            pages={pages}
            report={report}
            onClose={close}
            onChanged={changed}
          />,
          document.body,
        )}
    </section>
  );
}
