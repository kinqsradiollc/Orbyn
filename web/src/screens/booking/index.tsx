import { useEffect, useRef, useState } from "react";
import type { Booking, BookingPage, BookingView } from "@orbyn/core";
import type { ScreenProps } from "../../app/routes";
import { client, getSessionVersion } from "../../lib/session";
import { useNavigate, useSearch, useTitle } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { Button, ErrorNotice, Field, Input, SelectBox } from "../../ui/kit";
import {
  BookingDomain,
  ReadState,
  STATUS,
  saveFile,
  useOwner,
  useRead,
  useLeave,
  validId,
  when,
  zone,
} from "./shared";
import { HostDetail } from "./host-detail";
import { Pages } from "./pages";
import { Invites } from "./invites";
import { ProfileEditor } from "./profile-editor";
import "./booking.css";
export default function BookingScreen(_props: ScreenProps) {
  return (
    <BookingDomain key={getSessionVersion()}>
      <Workspace />
    </BookingDomain>
  );
}
function Workspace() {
  const navigate = useNavigate();
  useTitle("Bookings");
  const own = useOwner(),
    leave = useLeave(),
    search = useSearch(),
    query = new URLSearchParams(search),
    open = query.get("open") || "",
    tab = open
      ? "bookings"
      : ["pages", "invites", "profile"].includes(query.get("tab") || "")
        ? query.get("tab")!
        : "bookings",
    pages = useRead(() => client.listBookingPages()),
    [revision, setRevision] = useState(0),
    [focusVersion, setFocusVersion] = useState(0);
  const changed = () => {
    setRevision((n) => n + 1);
    void pages.reload();
  };
  function focus(id: string) {
    if (id === open)
      void leave().then((ok) => {
        if (ok && own()) setFocusVersion((n) => n + 1);
      });
    else navigate("/app/booking?open=" + encodeURIComponent(id));
  }
  return (
    <div className="booking-web-workspace">
      <header>
        <h1>Bookings</h1>
        <p className="muted">
          Share available time, review requests and manage your meetings.
        </p>
      </header>
      <nav className="booking-web-tabs" aria-label="Booking areas">
        {[
          ["bookings", "Bookings"],
          ["pages", "Booking pages"],
          ["invites", "One-time invites"],
          ["profile", "Public profile"],
        ].map(([id, label]) => (
          <Button
            key={id}
            variant="ghost"
            aria-current={tab === id ? "page" : undefined}
            onClick={() =>
              navigate("/app/booking" + (id === "bookings" ? "" : "?tab=" + id))
            }
          >
            {label}
          </Button>
        ))}
      </nav>
      {pages.error && (
        <ErrorNotice
          message={pages.error}
          onRetry={() => void pages.reload()}
        />
      )}
      {tab === "pages" ? (
        <Pages pages={pages} onChanged={changed} />
      ) : tab === "invites" ? (
        <Invites onChanged={changed} />
      ) : tab === "profile" ? (
        <ProfileEditor />
      ) : (
        <>
          <Inbox
            key="bookings"
            pages={pages.data || []}
            revision={revision}
            onOpen={focus}
          />
          {open && !validId(open) ? (
            <ErrorNotice message="The booking ID in this link is invalid. No other booking was selected." />
          ) : (
            open && (
              <HostDetail
                key={`${open}:${focusVersion}`}
                id={open}
                onChanged={changed}
                onClose={() => navigate("/app/booking", true)}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
function Inbox({
  pages,
  revision,
  onOpen,
}: {
  pages: BookingPage[];
  revision: number;
  onOpen: (id: string) => void;
}) {
  const owned = useOwner(),
    [view, setView] = useState<BookingView>("upcoming"),
    [pageId, setPageId] = useState(""),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState(""),
    [rows, setRows] = useState<Booking[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState(""),
    ticket = useRef(0),
    lock = useRef(false),
    queued = useRef(false),
    latest = useRef({
      view,
      page_id: pageId || undefined,
      q: filter || undefined,
    });
  latest.current = {
    view,
    page_id: pageId || undefined,
    q: filter || undefined,
  };
  const stats = useRead(
    () => client.bookingStats(pageId || undefined),
    [pageId, revision],
  );
  useEffect(() => {
    const t = setTimeout(() => setFilter(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  async function load(reset: boolean) {
    if (!owned()) return;
    if (lock.current) {
      if (reset) queued.current = true;
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const mine = ticket.current;
    try {
      const result = await client.bookings({
        ...latest.current,
        limit: 50,
        offset: reset ? 0 : rows.length,
      });
      if (owned() && mine === ticket.current) {
        setRows((old) =>
          reset
            ? result.rows
            : [
                ...old,
                ...result.rows.filter((r) => !old.some((o) => o.id === r.id)),
              ],
        );
        setTotal(result.total);
      }
    } catch (e) {
      if (owned() && mine === ticket.current)
        setError(messageOf(e, "Could not load bookings."));
    } finally {
      lock.current = false;
      if (owned()) {
        setBusy(false);
        if (queued.current) {
          queued.current = false;
          void load(true);
        }
      }
    }
  }
  useEffect(() => {
    ticket.current++;
    setRows([]);
    void load(true);
  }, [view, pageId, filter, revision]);
  const exportLock = useRef(false);
  async function csv() {
    if (exportLock.current || !owned()) return;
    exportLock.current = true;
    setExporting(true);
    setExportError("");
    try {
      const text = await client.exportBookingsCsv({ ...latest.current });
      if (owned()) saveFile(text, "bookings.csv", "text/csv;charset=utf-8");
    } catch (e) {
      if (owned()) setExportError(messageOf(e, "Could not download the CSV."));
    } finally {
      exportLock.current = false;
      if (owned()) setExporting(false);
    }
  }
  return (
    <section className="booking-web-inbox">
      <h2>Meeting inbox</h2>
      <ReadState read={stats}>
        {stats.data && (
          <>
            <dl className="booking-web-metrics">
              {(
                [
                  "upcoming",
                  "needs_approval",
                  "awaiting_email",
                  "confirmed",
                  "cancelled",
                  "declined",
                  "no_show",
                  "last_30_days",
                ] as const
              ).map((k) => (
                <div key={k}>
                  <dt>{k.replaceAll("_", " ")}</dt>
                  <dd>{stats.data![k]}</dd>
                </div>
              ))}
              <div>
                <dt>Cancellation rate</dt>
                <dd>{Math.round(stats.data.cancellation_rate * 100)}%</dd>
              </div>
            </dl>
            {stats.data.next && (
              <Button onClick={() => onOpen(stats.data!.next!.id)}>
                Open next meeting · {stats.data.next.name}
              </Button>
            )}
            <details>
              <summary>Counts by booking page</summary>
              {stats.data.pages.map((p) => (
                <p key={p.page_id}>
                  {p.title}: {p.upcoming} upcoming · {p.needs_approval} awaiting
                  approval · {p.total} total
                </p>
              ))}
            </details>
          </>
        )}
      </ReadState>
      <div className="booking-web-form-grid">
        <Field label="View">
          <SelectBox
            value={view}
            onChange={(e) => setView(e.target.value as BookingView)}
          >
            {(
              [
                "upcoming",
                "needs_approval",
                "past",
                "cancelled",
                "all",
              ] as const
            ).map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ")}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Booking page">
          <SelectBox value={pageId} onChange={(e) => setPageId(e.target.value)}>
            <option value="">All pages and invites</option>
            {pageId && !pages.some((p) => p.id === pageId) && (
              <option value={pageId}>Selected page unavailable</option>
            )}
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Booker name or email">
          <Input
            maxLength={100}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
      </div>
      <div className="booking-web-actions">
        <Button
          disabled={busy}
          onClick={() => {
            void load(true);
            void stats.reload();
          }}
        >
          Refresh bookings
        </Button>
        <Button busy={exporting} onClick={() => void csv()}>
          Download filtered CSV
        </Button>
      </div>
      {exportError && <ErrorNotice message={exportError} />}
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => void load(rows.length === 0)}
        />
      )}
      {!busy && !error && !rows.length && (
        <p>No bookings match these filters.</p>
      )}
      <ol className="booking-web-rows">
        {rows.map((b) => (
          <li key={b.id}>
            <Button variant="ghost" onClick={() => onOpen(b.id)}>
              <span>
                <strong dir="auto">{b.name}</strong>
                <small>
                  {b.email} · {b.page_title || "One-time invite"}
                </small>
              </span>
              <span>
                {when(b.start_at, b.end_at, zone())}
                <small>
                  {STATUS[b.status]}
                  {b.no_show ? " · No-show" : ""}
                </small>
              </span>
            </Button>
          </li>
        ))}
      </ol>
      <p>
        {rows.length} of {total}
      </p>
      <Button
        busy={busy}
        disabled={rows.length >= total}
        onClick={() => void load(false)}
      >
        Show older bookings
      </Button>
    </section>
  );
}
