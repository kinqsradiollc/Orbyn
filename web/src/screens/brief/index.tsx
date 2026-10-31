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
import { useAccount } from "../../app/account";
import { messageOf } from "../../lib/resource";
import { useTitle } from "../../lib/router";
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
import { useLibraryFeed } from "../library/store";
import { deviceTimeZone } from "../shared-task";
import "../library/library.css";
import "./brief.css";

const DAYS_BACK = 60;
const DAYS_AHEAD = 14;

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
  const { user } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();
  const timeZone =
    (user as { timezone?: string } | null)?.timezone || deviceTimeZone();
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
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    setFailed("");
    setDayFailed(false);
    setNote("");
    setLoading(true);
    setDoc(null);
    client
      .agendaToday(deviceTimeZone())
      .then(
        (next) => {
          if (id !== request.current) return;
          setDoc(next);
          const day =
            next.agenda_date ?? localDateKey(new Date(), zone.current);
          setDate(day);
          setToday(day);
        },
        (failure) => {
          if (id === request.current)
            setFailed(messageOf(failure, "Today's brief couldn't be loaded."));
        },
      )
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, []);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);

  // Left open past midnight, today's labels follow the clock.
  useEffect(() => {
    const check = () =>
      setToday((was) => agendaTodayAt(was, new Date(), zone.current));
    let timer: ReturnType<typeof setTimeout>;
    const atMidnight = () => {
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
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
    };
  }, [timeZone]);

  const go = (day: string) => {
    if (loading || busy) return;
    if (day === today) return load();
    const id = ++request.current;
    setFailed("");
    setDayFailed(false);
    setNote("");
    setLoading(true);
    setDoc(null);
    setDate(day);
    client
      .agendaOn(day, deviceTimeZone())
      .then(
        (found) => {
          if (id !== request.current) return;
          setDoc(found.doc);
          setToday(found.today);
        },
        () => {
          if (id === request.current) setDayFailed(true);
        },
      )
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  };
  const write = async () => {
    if (!date) return;
    setBusy(true);
    try {
      setDoc(await client.writeAgenda(date));
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't write this day."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const rewrite = async () => {
    const ok = await confirm({
      title: "Rewrite today's brief?",
      body: "Replaces everything above Notes with your current calendar. Your notes stay.",
      action: "Rewrite",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await client.rewriteAgenda(deviceTimeZone());
      setDoc(next);
      setEdition((n) => n + 1);
      setNote(agendaRewriteFeedback(next));
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't rewrite the brief."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
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
                <Button
                  variant="ghost"
                  disabled={blocked}
                  title={
                    note || "Written from your calendars. Your notes stay."
                  }
                  onClick={() => void rewrite()}
                >
                  <RefreshCw /> Rewrite
                </Button>
              ) : undefined
            }
            onWorkspaceWide={noop}
          />
        </div>
      </div>
    );
  return (
    <div className="brief">
      <div className="brief-bar">{days}</div>
      {loading ? (
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
