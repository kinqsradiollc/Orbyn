import { useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { addDays, agendaTitleOn, localDateKey, type Doc } from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../../lib/planning";
import { useConfirm } from "../../components/Confirm";
import { DocEditor } from "./DocEditor";
import "./docs.css";
import { errorText } from "../../lib/errors";

/** How far the arrows go: a year back, two months ahead (as the server). */
const DAYS_BACK = 366;
const DAYS_AHEAD = 62;

/** "Today", "Yesterday", "Tomorrow", or the day's own name. */
function dayName(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return agendaTitleOn(date);
}

/**
 * The agenda, a page a day. Orbyn writes today's each morning (or the first
 * time you open it) from your calendar — your events, the calendars you
 * subscribe to, time set aside, what's due — with the assistant's summary
 * of the day when one is connected. After that it's an ordinary page, so
 * anything you add stays.
 *
 * ‹ and › step to the day before and after, and Today comes back. Another
 * day's page is written only when asked: a past one from the calendar as it
 * stands, a day ahead with what's planned so far. "Rewrite from my
 * calendar" writes today's again, and never touches Notes or anything
 * under it.
 */
export function AgendaView({
  report,
  onItemsChanged,
  userId,
}: {
  report: (e: unknown) => void;
  onItemsChanged: () => void;
  userId?: string;
}) {
  const { ask } = useConfirm();
  const [doc, setDoc] = useState<Doc | null>(null);
  /** The day being looked at, and today, both in your own zone. */
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState(() =>
    localDateKey(new Date(), deviceTimeZone()),
  );
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** Another day's page couldn't be looked up (not the same as "none"). */
  const [dayFailed, setDayFailed] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  /** Bumped on a rewrite, so the editor starts again from the new page. */
  const [edition, setEdition] = useState(0);
  /** Today's page went to Trash from here; Undo on the toast brings it back. */
  const [trashed, setTrashed] = useState(false);

  const load = () => {
    setTrashed(false);
    setFailed(false);
    setDayFailed(false);
    setNote("");
    setLoading(true);
    setDoc(null);
    // The page says it couldn't load; the details go to the console.
    client
      .agendaToday(deviceTimeZone())
      .then(
        (next) => {
          setDoc(next);
          const day =
            next.agenda_date ?? localDateKey(new Date(), deviceTimeZone());
          setDate(day);
          setToday(day);
        },
        (e) => {
          setFailed(true);
          errorText(e, "Today's agenda");
        },
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Left open past midnight, the page on screen becomes yesterday's: the
  // labels, the Today button and Rewrite follow the clock, checked when the
  // window comes back and at each midnight.
  useEffect(() => {
    const check = () => {
      const now = localDateKey(new Date(), deviceTimeZone());
      setToday((was) => (now > was ? now : was));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    let timer: ReturnType<typeof setTimeout>;
    const atMidnight = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 5, 0);
      timer = setTimeout(() => {
        check();
        atMidnight();
      }, next.getTime() - now.getTime());
    };
    atMidnight();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /** Step to another day's page, or to the gap where it would be. */
  const go = (day: string) => {
    if (day === today) return load();
    setTrashed(false);
    setFailed(false);
    setDayFailed(false);
    setNote("");
    setLoading(true);
    // The page on screen goes first, saving anything typed into it.
    setDoc(null);
    setDate(day);
    client
      .agendaOn(day, deviceTimeZone())
      .then(
        (found) => {
          setDoc(found.doc);
          setToday(found.today);
        },
        (e) => {
          setDoc(null);
          setDayFailed(true);
          errorText(e, "That day's agenda");
        },
      )
      .finally(() => setLoading(false));
  };

  const write = () => {
    if (!date) return;
    setWriting(true);
    client
      .writeAgenda(date)
      .then(setDoc, report)
      .finally(() => setWriting(false));
  };

  const rewrite = async () => {
    if (
      !(await ask({
        title: "Rewrite today's agenda?",
        body: "Everything above Notes is written again from your calendar as it is now. Your notes and end-of-day answers stay as they are.",
        confirmLabel: "Rewrite",
      }))
    )
      return;
    setRewriting(true);
    setNote("");
    try {
      const next = await client.rewriteAgenda(deviceTimeZone());
      setDoc(next);
      setEdition((n) => n + 1);
      setNote(
        next.brief
          ? "Rewritten from your calendar, with the assistant's summary."
          : "Rewritten from your calendar.",
      );
    } catch (e) {
      report(e);
    } finally {
      setRewriting(false);
    }
  };

  const onToday = date === today;
  const nav = date && (
    <div className="agenda-nav" role="group" aria-label="Choose a day">
      <button
        type="button"
        className="icon-button"
        aria-label="The day before"
        title="The day before"
        disabled={loading || date <= addDays(today, -DAYS_BACK)}
        onClick={() => go(addDays(date, -1))}
      >
        <ChevronLeft size={16} />
      </button>
      <strong className="agenda-day" aria-live="polite">
        {dayName(date, today)}
      </strong>
      <button
        type="button"
        className="icon-button"
        aria-label="The day after"
        title="The day after"
        disabled={loading || date >= addDays(today, DAYS_AHEAD)}
        onClick={() => go(addDays(date, 1))}
      >
        <ChevronRight size={16} />
      </button>
      {!onToday && (
        <button
          type="button"
          className="secondary agenda-today"
          disabled={loading}
          onClick={() => go(today)}
        >
          Today
        </button>
      )}
    </div>
  );

  if (failed)
    return (
      <p className="muted">
        Today's agenda couldn't be loaded. Try again in a moment.
      </p>
    );
  // Nothing is written again until asked: a fresh copy now would sit beside
  // the one in Trash if that were brought back.
  if (trashed)
    return (
      <div className="agenda-bar">
        <span className="muted">
          {onToday ? "Today's agenda" : "This day's agenda"} is in Trash.
        </span>
        <button
          type="button"
          className="secondary"
          onClick={() => (onToday ? load() : go(date!))}
        >
          <RefreshCw size={14} /> {onToday ? "Write a new one" : "Look again"}
        </button>
      </div>
    );
  if (!date) return <p className="muted">Writing today's agenda…</p>;

  return (
    <>
      <div className="agenda-bar">
        {nav}
        {doc && onToday && (
          <button
            type="button"
            className="secondary"
            disabled={rewriting}
            onClick={() => void rewrite()}
          >
            <RefreshCw size={14} />{" "}
            {rewriting ? "Rewriting…" : "Rewrite from my calendar"}
          </button>
        )}
      </div>
      {doc && (
        <p className="agenda-note muted">
          <Sparkles size={14} aria-hidden="true" /> Written from your calendar,
          including the calendars you subscribe to. Notes are yours: a rewrite
          leaves them alone.
          {note && <strong role="status"> {note}</strong>}
        </p>
      )}
      {loading && !doc ? (
        <p className="muted">Looking for that day's page…</p>
      ) : dayFailed ? (
        <div className="empty agenda-empty" role="alert">
          <CalendarDays size={30} aria-hidden="true" />
          <p>{agendaTitleOn(date)} couldn't be loaded.</p>
          <button type="button" className="secondary" onClick={() => go(date)}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : doc ? (
        <DocEditor
          key={`${doc.id}-${edition}`}
          doc={doc}
          report={report}
          userId={userId}
          onChanged={setDoc}
          onItemsChanged={onItemsChanged}
          // The agenda is one day's page; there is no list to go back to.
          onDeleted={() => {
            setDoc(null);
            setTrashed(true);
          }}
          onUndoDelete={(back) => {
            setTrashed(false);
            setDoc(back);
          }}
        />
      ) : (
        <div className="empty agenda-empty">
          <CalendarDays size={30} aria-hidden="true" />
          <p>
            {date < today
              ? `Nothing was written for ${agendaTitleOn(date)}.`
              : `${agendaTitleOn(date)} isn't written yet.`}
          </p>
          <button
            type="button"
            className="primary"
            disabled={writing}
            onClick={write}
          >
            {writing ? "Writing…" : "Write it from my calendar"}
          </button>
        </div>
      )}
    </>
  );
}
