import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  X,
} from "lucide-react";
import {
  DEFAULT_BOOKER_REMINDERS,
  dateLabel,
  fromDateTimeLocal,
  sameDay,
  startOfDay,
  type OpenInvite,
  type OpenInviteStatus,
  type Team,
  type TeamMember,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { copyText, minutesLabel, plural, spanLabel } from "../../lib/planning";
import { addDays, timeLabel } from "../calendar/dates";
import { RemindersField } from "./RemindersField";
import "./booking-w3.css";
import { DateField } from "../../components/DateField";

const STATUS_TEXT: Record<OpenInviteStatus, string> = {
  open: "Open",
  booked: "Booked",
  expired: "Expired",
  cancelled: "Withdrawn",
};
const LENGTHS = [15, 20, 30, 45, 60, 90, 120];
/** Co-hosts an invite can have. */
const MAX_CO_HOSTS = 10;

type Win = { start: Date; end: Date };

const shortDay = (d: Date) =>
  d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const windowText = (w: Win) =>
  `${shortDay(w.start)}, ${spanLabel(w.start.toISOString(), w.end.toISOString())}`;

/** Overlapping or touching windows become one. */
function merge(list: Win[]): Win[] {
  const out: Win[] = [];
  for (const w of [...list].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  )) {
    const last = out[out.length - 1];
    if (last && w.start.getTime() <= last.end.getTime())
      last.end = new Date(Math.max(last.end.getTime(), w.end.getTime()));
    else out.push({ start: new Date(w.start), end: new Date(w.end) });
  }
  return out;
}

type Props = {
  user: User | null;
  /** Co-hosts come from the people in your teams. */
  teams: Team[];
  report: (e: unknown) => void;
};

/**
 * Open invites: a private link offering a few hand-picked windows; the
 * person it goes to picks a time inside them when you (and any co-hosts)
 * are free, and it's booked at once.
 */
export function OpenInvites({ user, teams, report }: Props) {
  const { ask, tell } = useConfirm();
  const [invites, setInvites] = useState<OpenInvite[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const action = useAction(report);

  const load = () =>
    client.listOpenInvites().then(setInvites, (e) => {
      setInvites([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = (inv: OpenInvite) =>
    void copyText(inv.url).then((ok) => ok && setCopied(inv.id));
  const withdraw = async (inv: OpenInvite) => {
    if (
      !(await ask({
        title: `Withdraw “${inv.title}”? Its link stops working${inv.booking ? " and the booking is cancelled" : ""}.`,
      }))
    )
      return;
    void action.run(async () => {
      await client.cancelOpenInvite(inv.id);
      await load();
      return `Withdrew “${inv.title}”.`;
    });
  };

  return (
    <>
      {creating && (
        <InviteForm
          user={user}
          teams={teams}
          report={report}
          onClose={() => setCreating(false)}
          onCreated={(inv) => {
            setCreating(false);
            void load();
            void copyText(inv.url).then((ok) => ok && setCopied(inv.id));
            action.setOutcome({
              ok: true,
              text: "Your link is ready and copied. Send it to the person you're meeting.",
            });
          }}
        />
      )}
      <section className="card">
        <div className="section-heading">
          <h2>
            Offered times <span>{invites?.length ?? 0}</span>
          </h2>
          {!creating && (
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Offer times
            </button>
          )}
        </div>
        <p className="muted pad invite-lead">
          Pick a few windows and send one private link. The time they choose is
          booked straight away.
        </p>
        <OutcomeNote outcome={action.outcome} />
        {invites === null ? (
          <p className="muted pad">Loading your invites…</p>
        ) : !invites.length ? (
          <EmptyState
            icon={CalendarRange}
            title="No offered times yet."
            body="Offer a few times to one person, without a booking page."
          />
        ) : (
          invites.map((inv) => (
            <article key={inv.id} className="booking-page-row">
              <div className="booking-page-main">
                <strong>
                  {inv.title}
                  <span className="chip">{STATUS_TEXT[inv.status]}</span>
                </strong>
                <small>
                  {minutesLabel(inv.duration)} ·{" "}
                  {plural(inv.windows.length, "window")}
                  {inv.windows[0] &&
                    ` from ${shortDay(new Date(inv.windows[0].start_at))}`}
                  {inv.co_hosts.length > 0 &&
                    ` · with ${inv.co_hosts.map((h) => h.name).join(", ")}`}
                  {inv.status === "open" &&
                    ` · link works until ${dateLabel(inv.expires_at)}`}
                </small>
                {inv.booking && (
                  <small>
                    Booked by {inv.booking.name} ({inv.booking.email}) ·{" "}
                    {dateLabel(inv.booking.start_at)}
                  </small>
                )}
                <span className="booking-link">
                  <code>{inv.url}</code>
                  <button className="link-button" onClick={() => copy(inv)}>
                    <Copy size={12} />{" "}
                    {copied === inv.id ? "Copied" : "Copy link"}
                  </button>
                </span>
              </div>
              <div className="booking-page-actions">
                {(inv.status === "open" || inv.status === "booked") && (
                  <button
                    className="secondary"
                    disabled={action.pending}
                    onClick={() => withdraw(inv)}
                  >
                    <X size={14} /> Withdraw
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </>
  );
}

/**
 * A new open invite: what, how long, where, the windows, who else must be
 * free, reminders and expiry.
 */
function InviteForm({
  user,
  teams,
  report,
  onClose,
  onCreated,
}: {
  user: User | null;
  teams: Team[];
  report: (e: unknown) => void;
  onClose: () => void;
  onCreated: (invite: OpenInvite) => void;
}) {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [windows, setWindows] = useState<Win[]>([]);
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [coHosts, setCoHosts] = useState<string[]>([]);
  const [people, setPeople] = useState<TeamMember[] | null>(null);
  const [reminders, setReminders] = useState<number[]>([
    ...DEFAULT_BOOKER_REMINDERS,
  ]);
  const [expires, setExpires] = useState("");
  const action = useAction(report);

  // Co-hosts: anyone you share a team with.
  useEffect(() => {
    if (!teams.length) {
      setPeople([]);
      return;
    }
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
      () => alive && setPeople([]),
    );
    return () => {
      alive = false;
    };
  }, [teams, user?.id]);

  const toggleCoHost = (id: string) =>
    setCoHosts((ids) =>
      ids.includes(id)
        ? ids.filter((x) => x !== id)
        : ids.length >= MAX_CO_HOSTS
          ? ids
          : [...ids, id],
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = !windows.length
      ? "Mark at least one window when you're free."
      : windows.length > 20
        ? "Up to 20 windows."
        : !windows.some(
              (w) => w.end.getTime() - w.start.getTime() >= duration * 60_000,
            )
          ? "Make at least one window as long as the meeting."
          : "";
    if (problem) {
      action.setOutcome({ ok: false, text: problem });
      return;
    }
    const expiresAt = expires ? fromDateTimeLocal(expires) : null;
    void action.run(async () => {
      onCreated(
        await client.createOpenInvite({
          title: title.trim(),
          duration,
          windows: windows.map((w) => ({
            start_at: w.start.toISOString(),
            end_at: w.end.toISOString(),
          })),
          location: location.trim(),
          meeting_url: meetingUrl.trim(),
          co_host_ids: coHosts,
          remind_before_minutes: reminders,
          ...(expiresAt ? { expires_at: expiresAt } : {}),
        }),
      );
    });
  };

  return (
    <section className="card booking-form-card" aria-labelledby="invite-form">
      <div className="section-heading">
        <h2 id="invite-form">Offer times</h2>
        <button
          className="icon-button"
          aria-label="Close form"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form className="settings-form invite-form" onSubmit={submit}>
        <div className="settings-grid">
          <div className="settings-field wide">
            <label htmlFor="inv-title">What&apos;s it for?</label>
            <input
              id="inv-title"
              required
              autoFocus
              maxLength={120}
              placeholder="Coffee catch-up"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="inv-length">Length</label>
            <Select
              id="inv-length"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </Select>
          </div>
          <div className="settings-field">
            <label htmlFor="inv-expires">Link works until (optional)</label>
            <DateField
              id="inv-expires"
              type="datetime-local"
              value={expires}
              aria-describedby="inv-expires-hint"
              onChange={(e) => setExpires(e.target.value)}
            />
            <small id="inv-expires-hint" className="field-hint">
              At the latest, the end of the last window.
            </small>
          </div>
          <div className="settings-field">
            <label htmlFor="inv-location">Location (optional)</label>
            <input
              id="inv-location"
              maxLength={300}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="inv-link">Meeting link (optional)</label>
            <input
              id="inv-link"
              type="url"
              maxLength={500}
              pattern="https?://\S+"
              placeholder="https://"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
            />
          </div>
        </div>
        <h3 className="settings-subtitle">When you&apos;re free</h3>
        <WindowPicker value={windows} onChange={setWindows} />
        {people && people.length > 0 && (
          <fieldset className="check-group">
            <legend>Co-hosts (optional)</legend>
            <div className="check-grid">
              {people.map((p) => (
                <label key={p.user_id} className="check-line">
                  <input
                    type="checkbox"
                    checked={coHosts.includes(p.user_id)}
                    disabled={
                      !coHosts.includes(p.user_id) &&
                      coHosts.length >= MAX_CO_HOSTS
                    }
                    onChange={() => toggleCoHost(p.user_id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <small className="field-hint">
              Everyone you add must also be free at the time picked, and gets
              the event on their calendar. Up to {MAX_CO_HOSTS}.
            </small>
          </fieldset>
        )}
        <RemindersField value={reminders} onChange={setReminders} />
        <div className="settings-footer">
          <button className="primary" disabled={action.pending}>
            {action.pending ? "Creating…" : "Create link"}
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

const WP_START = 7;
const WP_END = 21;
const WP_STEP = 30;
const ROWS = ((WP_END - WP_START) * 60) / WP_STEP;
const CELL_PX = 18;

/**
 * Windows on a week grid: drag down a day (mouse, pen or finger) to mark a
 * window, 7 AM to 9 PM in half-hour steps; × removes one. The form under it
 * adds one by typing.
 */
function WindowPicker({
  value,
  onChange,
}: {
  value: Win[];
  onChange: (next: Win[]) => void;
}) {
  const today = startOfDay(new Date());
  const [first, setFirst] = useState(today);
  const days = Array.from({ length: 7 }, (_, n) => addDays(first, n));
  const [drag, setDrag] = useState<{
    day: number;
    from: number;
    to: number;
  } | null>(null);
  const [addDay, setAddDay] = useState(() => dayInput(today));
  const [addFrom, setAddFrom] = useState("09:00");
  const [addTo, setAddTo] = useState("12:00");
  const [addError, setAddError] = useState("");
  const latest = useRef({ drag, value, onChange, days });
  latest.current = { drag, value, onChange, days };
  const dragging = drag !== null;
  const now = Date.now();

  const at = (day: Date, index: number) =>
    new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      WP_START,
      index * WP_STEP,
    );

  // Letting go anywhere adds the window being dragged out; a cancelled
  // touch (the browser took over) drops it.
  useEffect(() => {
    if (!dragging) return;
    const up = () => {
      const { drag: d, value: v, onChange: change, days: ds } = latest.current;
      setDrag(null);
      if (!d) return;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to) + 1;
      change(
        merge([...v, { start: at(ds[d.day], lo), end: at(ds[d.day], hi) }]),
      );
    };
    const cancel = () => setDrag(null);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    return () => {
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [dragging]);

  /**
   * Follow the pointer to the cell under it. Touch keeps its events on the
   * first cell, so the cell is found by position rather than by hover.
   */
  const follow = (e: PointerEvent<HTMLDivElement>) => {
    const d = latest.current.drag;
    if (!d) return;
    const cell = (
      document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    )?.closest<HTMLElement>("[data-cell]");
    if (!cell || Number(cell.dataset.day) !== d.day) return;
    if (cell.classList.contains("is-past")) return;
    const index = Number(cell.dataset.cell);
    if (index !== d.to) setDrag({ ...d, to: index });
  };

  const addTyped = () => {
    const [y, m, d] = addDay.split("-").map(Number);
    const [fh, fm] = addFrom.split(":").map(Number);
    const [th, tm] = addTo.split(":").map(Number);
    const start = new Date(y, m - 1, d, fh, fm);
    const end = new Date(y, m - 1, d, th, tm);
    if (!(end > start)) return setAddError("A window ends after it starts.");
    if (end.getTime() <= now) return setAddError("That time has passed.");
    setAddError("");
    onChange(merge([...value, { start, end }]));
  };

  const lastDay = addDays(today, 83);
  return (
    <div className="window-picker-wrap">
      <div className="wp-toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous week"
          disabled={first <= today}
          onClick={() => setFirst(addDays(first, -7))}
        >
          <ChevronLeft size={17} />
        </button>
        <strong>
          {shortDay(days[0])} – {shortDay(days[6])}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Next week"
          disabled={first >= lastDay}
          onClick={() => setFirst(addDays(first, 7))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div
        className="window-picker"
        style={{ "--wp-cell": CELL_PX + "px" } as never}
        aria-hidden="true"
      >
        <div className="wp-head">
          <span />
          {days.map((d) => (
            <span key={d.toISOString()}>
              {d.toLocaleDateString([], { weekday: "short" })} {d.getDate()}
            </span>
          ))}
        </div>
        <div className="wp-body" onPointerMove={follow}>
          <div className="wp-hours">
            {Array.from({ length: ROWS / 2 }, (_, h) => (
              <span key={h}>{timeLabel(at(days[0], h * 2))}</span>
            ))}
          </div>
          {days.map((day, n) => {
            const draft =
              drag?.day === n
                ? {
                    lo: Math.min(drag.from, drag.to),
                    hi: Math.max(drag.from, drag.to) + 1,
                  }
                : null;
            return (
              <div key={day.toISOString()} className="wp-col">
                {Array.from({ length: ROWS }, (_, i) => {
                  const past = at(day, i + 1).getTime() <= now;
                  return (
                    <div
                      key={i}
                      data-day={n}
                      data-cell={i}
                      className={"wp-cell" + (past ? " is-past" : "")}
                      onPointerDown={(e) => {
                        if (past || e.button !== 0) return;
                        e.preventDefault();
                        setDrag({ day: n, from: i, to: i });
                      }}
                    />
                  );
                })}
                {value
                  .filter((w) => sameDay(w.start, day))
                  .map((w) => {
                    const top =
                      ((w.start.getHours() * 60 +
                        w.start.getMinutes() -
                        WP_START * 60) /
                        WP_STEP) *
                      CELL_PX;
                    const height =
                      ((w.end.getTime() - w.start.getTime()) /
                        60_000 /
                        WP_STEP) *
                      CELL_PX;
                    return (
                      <div
                        key={w.start.toISOString()}
                        className="wp-window"
                        style={{
                          top: Math.max(0, top),
                          height: Math.max(CELL_PX, height),
                        }}
                      >
                        {timeLabel(w.start)} – {timeLabel(w.end)}
                        <button
                          type="button"
                          tabIndex={-1}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onChange(value.filter((x) => x !== w))}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })}
                {draft && (
                  <div
                    className="wp-window is-draft"
                    style={{
                      top: draft.lo * CELL_PX,
                      height: (draft.hi - draft.lo) * CELL_PX,
                    }}
                  >
                    {timeLabel(at(day, draft.lo))} –{" "}
                    {timeLabel(at(day, draft.hi))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="wp-add" role="group" aria-label="Add a window">
        <label>
          Day
          <DateField
            type="date"
            value={addDay}
            min={dayInput(today)}
            onChange={(e) => setAddDay(e.target.value)}
          />
        </label>
        <label>
          From
          <DateField
            type="time"
            value={addFrom}
            onChange={(e) => setAddFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <DateField
            type="time"
            value={addTo}
            onChange={(e) => setAddTo(e.target.value)}
          />
        </label>
        <button type="button" className="secondary" onClick={addTyped}>
          <Plus size={13} /> Add window
        </button>
      </div>
      {addError && (
        <small className="field-hint" role="alert">
          {addError}
        </small>
      )}
      {value.length > 0 ? (
        <ul className="chip-list wp-list" aria-label="Windows">
          {value.map((w) => (
            <li key={w.start.toISOString()} className="chip">
              {windowText(w)}
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${windowText(w)}`}
                onClick={() => onChange(value.filter((x) => x !== w))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">
          Drag down a day on the grid, or add a window above.
        </p>
      )}
    </div>
  );
}

/** "YYYY-MM-DD" of a local date, for date inputs. */
function dayInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
