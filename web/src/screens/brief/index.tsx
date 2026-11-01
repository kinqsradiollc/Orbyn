import {
  addDays,
  agendaRewriteFeedback,
  agendaTitleOn,
  agendaTodayAt,
  localDateKey,
  nextDayStart,
  type Doc,
} from "@orbyn/core";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { useTitle, useBeforeNavigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Empty,
  ErrorNotice,
  IconButton,
  Loading,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { PageScreen } from "../library/page/PageScreen";
import { useLibraryOwner } from "../library/lifetime";
import { useLibraryFeed } from "../library/store";
import { deviceTimeZone } from "../shared-task";
import "../library/library.css";
import "./brief.css";

const DAYS_BACK = 366;
const DAYS_AHEAD = 62;

function dayName(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return agendaTitleOn(date);
}

/** A page a day, written from your calendars, then ordinary to edit. */
export default function BriefScreen() {
  useTitle("Daily brief");
  useLibraryFeed();
  const current = useLibraryOwner();
  const toast = useToast();
  const confirm = useConfirm();
  const [timeZone, setTimeZone] = useState(deviceTimeZone);
  const zone = useRef(timeZone);
  zone.current = timeZone;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState(() => localDateKey(new Date(), timeZone));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState("");
  const [dayFailed, setDayFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [edition, setEdition] = useState(0);
  const [trashed, setTrashed] = useState(false);
  const trashedDay = useRef<{ id: string; date: string | null } | null>(null);
  const selectedDay = useRef(date);
  selectedDay.current = date;
  const selectedDoc = useRef(doc?.id);
  selectedDoc.current = doc?.id;
  const request = useRef(0);
  const mutation = useRef(false);
  const settle = useRef<(() => Promise<boolean>) | null>(null);
  const onSettle = useCallback((next: (() => Promise<boolean>) | null) => {
    settle.current = next;
  }, []);
  useEffect(() => {
    if (!current()) return;
    let live = true;
    void client.getPlannerPrefs().then(
      (prefs) => {
        if (live && current()) setTimeZone(prefs.timezone || deviceTimeZone());
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [current]);
  const latestNote = useRef(note);
  latestNote.current = note;
  const leaving = useRef(false);
  const prepareLeave = useCallback(async () => {
    if (!current() || mutation.current || leaving.current) return false;
    leaving.current = true;
    const openingNote = note,
      openingDoc = selectedDoc.current;
    try {
      if (settle.current && !(await settle.current())) return false;
      if (!current() || mutation.current || selectedDoc.current !== openingDoc)
        return false;
      if (
        openingNote.trim() &&
        !(await confirm({
          title: "Discard this brief feedback?",
          body: "Your saved page stays as it is.",
          action: "Discard feedback",
          danger: true,
        }))
      )
        return false;
      return (
        current() &&
        !mutation.current &&
        selectedDoc.current === openingDoc &&
        latestNote.current === openingNote
      );
    } finally {
      leaving.current = false;
    }
  }, [current, note, confirm]);
  useBeforeNavigate(prepareLeave);
  const load = useCallback(
    async (day?: string) => {
      if (mutation.current || !current()) return;
      mutation.current = true;
      setBusy(true);
      const id = ++request.current;
      try {
        // Flush the embedded editor before replacing it or reading a new day.
        if (settle.current && !(await settle.current())) return;
        if (!current() || id !== request.current) return;
        setFailed("");
        setDayFailed(false);
        setNote("");
        setTrashed(false);
        trashedDay.current = null;
        setLoading(true);
        setDoc(null);
        if (day) setDate(day);
        if (day) {
          const found = await client.agendaOn(day, deviceTimeZone());
          if (!current() || id !== request.current) return;
          setDoc(found.doc);
          setToday(found.today);
        } else {
          const next = await client.agendaToday(deviceTimeZone());
          if (!current() || id !== request.current) return;
          setDoc(next);
          const loadedDay =
            next.agenda_date ?? localDateKey(new Date(), zone.current);
          setDate(loadedDay);
          setToday(loadedDay);
        }
      } catch (failure) {
        if (!current() || id !== request.current) return;
        if (day) setDayFailed(true);
        else setFailed(messageOf(failure, "Today's brief couldn't be loaded."));
      } finally {
        if (id === request.current) mutation.current = false;
        if (current() && id === request.current) {
          setBusy(false);
          setLoading(false);
        }
      }
    },
    [current],
  );
  useEffect(() => {
    load();
    return () => {
      request.current++;
      mutation.current = false;
    };
  }, [load]);

  // Left open past midnight, today's labels follow the clock.
  useEffect(() => {
    const check = () => {
      if (current())
        setToday((was) => agendaTodayAt(was, new Date(), zone.current));
    };
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    let timer: ReturnType<typeof setTimeout>;
    const atMidnight = () => {
      if (!current()) return;
      const now = new Date();
      timer = setTimeout(
        () => {
          check();
          atMidnight();
        },
        nextDayStart(now, zone.current).getTime() + 5_000 - now.getTime(),
      );
    };
    check();
    atMidnight();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [timeZone, current]);

  const go = (day: string) => {
    if (loading) return;
    void load(day === today ? undefined : day);
  };
  const write = async () => {
    if (!date || loading || mutation.current || !current()) return;
    mutation.current = true;
    const id = ++request.current;
    const day = date;
    const owns = () =>
      current() && id === request.current && selectedDay.current === day;
    setBusy(true);
    try {
      const next = await client.writeAgenda(day);
      if (owns()) setDoc(next);
    } catch (failure) {
      if (owns())
        toast({
          text: messageOf(failure, "Couldn't write this day."),
          error: true,
        });
    } finally {
      if (id === request.current) mutation.current = false;
      if (owns()) setBusy(false);
    }
  };
  const rewrite = async () => {
    if (!date || date !== today || loading || mutation.current || !current())
      return;
    mutation.current = true;
    const id = ++request.current;
    const day = date;
    const document = doc?.id;
    const owns = () =>
      current() &&
      id === request.current &&
      selectedDay.current === day &&
      selectedDoc.current === document;
    setBusy(true);
    try {
      const ok = await confirm({
        title: "Rewrite today's brief?",
        body: "Replaces everything above Notes with your current calendar. Your notes and end-of-day answers stay.",
        action: "Rewrite",
      });
      if (!ok || !owns()) return;
      if (settle.current && !(await settle.current())) return;
      if (!owns()) return;
      const next = await client.rewriteAgenda(deviceTimeZone());
      if (!owns()) return;
      setDoc(next);
      setEdition((n) => n + 1);
      setNote(agendaRewriteFeedback(next));
    } catch (failure) {
      if (owns())
        toast({
          text: messageOf(failure, "Couldn't rewrite the brief."),
          error: true,
        });
    } finally {
      if (id === request.current) mutation.current = false;
      if (current() && id === request.current) setBusy(false);
    }
  };
  const onTrashed = useCallback(
    (id: string) => {
      if (!current() || id !== doc?.id || id !== selectedDoc.current) return;
      trashedDay.current = { id, date: selectedDay.current };
      setDoc(null);
      setTrashed(true);
    },
    [current, doc?.id],
  );
  const onRestored = useCallback(
    (restored: Doc) => {
      const previous = trashedDay.current;
      if (
        !current() ||
        previous?.id !== restored.id ||
        previous.date !== selectedDay.current
      )
        return;
      setDoc(restored);
      setTrashed(false);
      trashedDay.current = null;
    },
    [current],
  );
  if (failed)
    return (
      <div className="page">
        <h1>Daily brief</h1>
        <ErrorNotice message={failed} onRetry={load} />
      </div>
    );
  if (!date)
    return (
      <div className="page">
        <h1>Daily brief</h1>
        <Loading label="Writing today's brief" />
      </div>
    );
  const onToday = date === today;
  const blocked = loading || busy;
  const days = (
    <div className="brief-days" role="group" aria-label="Choose a day">
      <IconButton
        label="The day before"
        disabled={blocked || date <= addDays(today, -DAYS_BACK)}
        onClick={() => go(addDays(date, -1))}
      >
        <ChevronLeft />
      </IconButton>
      <strong className="brief-day" aria-live="polite">
        {dayName(date, today)}
      </strong>
      <IconButton
        label="The day after"
        disabled={blocked || date >= addDays(today, DAYS_AHEAD)}
        onClick={() => go(addDays(date, 1))}
      >
        <ChevronRight />
      </IconButton>
      {!onToday && (
        <Button disabled={blocked} onClick={() => go(today)}>
          Today
        </Button>
      )}
    </div>
  );
  if (doc)
    return (
      <div className="lib brief-doc">
        <div className="lib-work">
          <PageScreen
            key={`${doc.id}-${edition}`}
            id={doc.id}
            railToggle={days}
            heading={
              onToday ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={blocked}
                    title="Written from your calendars. Your notes stay."
                    onClick={() => void rewrite()}
                  >
                    <RefreshCw /> Rewrite
                  </Button>
                  {note && (
                    <span className="brief-note small" role="status">
                      {note}
                    </span>
                  )}
                </>
              ) : undefined
            }
            onSettle={onSettle}
            onWorkspaceWide={noop}
            onTrashed={onTrashed}
            onRestored={onRestored}
          />
        </div>
      </div>
    );
  return (
    <div className="brief">
      <div className="brief-bar">{days}</div>
      {trashed ? (
        <Empty
          title={`${onToday ? "Today's" : "This day's"} brief is in Trash`}
        >
          <Button onClick={() => go(date)}>
            {onToday ? "Write a new one" : "Look again"}
          </Button>
        </Empty>
      ) : loading ? (
        <div className="page">
          <Loading label="Loading brief" />
        </div>
      ) : dayFailed ? (
        <div className="page">
          <ErrorNotice
            message={`${agendaTitleOn(date)} couldn't be loaded.`}
            onRetry={() => go(date)}
          />
        </div>
      ) : (
        <Empty
          title={
            date < today
              ? `Nothing was written for ${agendaTitleOn(date)}.`
              : `${agendaTitleOn(date)} isn't written yet.`
          }
        >
          <CalendarDays aria-hidden="true" />
          <Button variant="primary" busy={busy} onClick={() => void write()}>
            Write brief
          </Button>
        </Empty>
      )}
    </div>
  );
}

const noop = () => {};
