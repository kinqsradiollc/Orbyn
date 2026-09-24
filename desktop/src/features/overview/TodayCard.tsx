import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Play,
  Sun,
  Timer,
  type LucideIcon,
} from "lucide-react";
import {
  todayIsCurrent,
  todayRowWords,
  unfinishedHeading,
  unfinishedWhen,
  type TodayList,
  type TodayRow,
} from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import "./today.css";

/** Late tasks shown before "Show all". */
const LATE_SHOWN = 5;
/** Where "Dismiss" on a Not finished row is remembered, on this browser. */
const DISMISSED_KEY = "orbyn-today-dismissed";

const readDismissed = (): string[] => {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(DISMISSED_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
};

/** "Thu 24 Sep" for a YYYY-MM-DD day. */
const dayName = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const ICONS: Record<string, LucideIcon> = {
  event: CalendarDays,
  session: Timer,
  today: CalendarClock,
  late: AlertTriangle,
};

type Props = {
  today: TodayList | null;
  /** Opens a task or event. */
  onOpen: (itemId: string) => void;
  /** Starts focus mode on a task. */
  onFocus: (itemId: string) => void;
  /** Plans time for a task, looking ahead as far as its deadline. */
  onPlanIt: (itemId: string) => void;
  /** A plan for an unfinished session's work. */
  onPlanAgain: (blockId: string) => void;
  onOpenCalendar: () => void;
  /** "Plan my day" in the calendar. */
  onPlanDay: () => void;
  /** Every late task, in My tasks. */
  onShowLate: () => void;
};

/**
 * Today, planned and due in one list (GET /today): the day's events, your
 * sessions, tasks due today and late ones in time order, a task both planned
 * and due as one row with two chips, and the sessions you didn't finish
 * yesterday with Plan again and Dismiss.
 */
export function TodayCard({
  today,
  onOpen,
  onFocus,
  onPlanIt,
  onPlanAgain,
  onOpenCalendar,
  onPlanDay,
  onShowLate,
}: Props) {
  const [allLate, setAllLate] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  // The list moves on at midnight; words like "past" follow the clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const current = today && todayIsCurrent(today, now) ? today : null;
  const rows = current?.rows ?? [];
  const onDay = rows.filter((r) => r.due !== "late" || r.at);
  const late = rows.filter((r) => r.due === "late" && !r.at);
  const lateShown = allLate ? late : late.slice(0, LATE_SHOWN);
  // Late tasks the list names (some sit at their session today).
  const lateListed = rows.filter((r) => r.due === "late").length;
  const moreLate = current ? current.late_total - lateListed : 0;
  const unfinished = (current?.unfinished ?? []).filter(
    (u) => !dismissed.includes(u.block_id),
  );

  const dismiss = (blockId: string) => {
    // Only ids still listed are kept, so the list doesn't grow for ever.
    const listed = new Set(current?.unfinished.map((u) => u.block_id));
    const next = [...dismissed.filter((id) => listed.has(id)), blockId];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private windows can refuse storage; it's hidden for this visit.
    }
  };

  const row = (r: TodayRow) => {
    const words = todayRowWords(r, now);
    const past =
      r.past ||
      (!!r.end_at && r.kind !== "task" && Date.parse(r.end_at) <= +now);
    const Icon =
      ICONS[r.kind === "task" ? (r.due === "late" ? "late" : "today") : r.kind];
    const warn =
      r.kind === "task" &&
      (r.due === "late" || words.chips.some((c) => c.tone === "warn"));
    return (
      <li
        key={r.key}
        className={
          "today-row" +
          ` is-${r.kind}` +
          (past ? " is-past" : "") +
          (warn ? " is-warn" : "")
        }
      >
        <span className="today-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <span className={"today-lead" + (words.lead ? "" : " is-empty")}>
          {words.lead}
        </span>
        <span className="today-main">
          {r.item_id ? (
            <button
              type="button"
              className="today-title"
              onClick={() => onOpen(r.item_id!)}
              aria-label={`Open ${r.title}`}
            >
              {r.title}
            </button>
          ) : (
            <span className="today-title">{r.title}</span>
          )}
          {(words.meta || words.chips.length > 0) && (
            <span className="today-facts">
              {words.meta && (
                <small
                  className={
                    r.after_deadline ? "today-meta is-late" : "today-meta"
                  }
                >
                  {words.meta}
                </small>
              )}
              {words.chips.map((c) => (
                <span key={c.text} className={`plan-chip is-${c.tone}`}>
                  {c.text}
                </span>
              ))}
            </span>
          )}
        </span>
        {r.action === "focus" && r.item_id && (
          <button
            type="button"
            className="text-button today-action"
            onClick={() => onFocus(r.item_id!)}
            aria-label={`Start focus on ${r.title}`}
          >
            <Play size={13} aria-hidden="true" /> Start focus
          </button>
        )}
        {r.action === "plan" && r.item_id && (
          <button
            type="button"
            className="text-button today-action"
            onClick={() => onPlanIt(r.item_id!)}
            aria-label={`Plan time for ${r.title}`}
          >
            Plan it
          </button>
        )}
      </li>
    );
  };

  const empty = current && !rows.length && !unfinished.length;
  return (
    <section
      className="card overview-section today-card"
      aria-labelledby="overview-today"
    >
      <div className="section-heading">
        <div>
          <h2 id="overview-today">
            <Sun size={17} aria-hidden="true" className="heading-icon" />
            Today{current ? ` · ${dayName(current.day)}` : ""}
          </h2>
          {!current && <p className="section-hint">Gathering your day…</p>}
        </div>
      </div>
      {empty ? (
        <EmptyState
          icon={Sun}
          title="A little breathing room."
          body="Nothing planned or due today."
        >
          <button className="text-button" onClick={onPlanDay}>
            Plan my day <ArrowRight size={14} />
          </button>
        </EmptyState>
      ) : (
        <>
          {onDay.length + late.length > 0 && (
            <ul className="today-list" aria-label="Today, in time order">
              {onDay.map(row)}
              {lateShown.map(row)}
            </ul>
          )}
          {(late.length > LATE_SHOWN || moreLate > 0) && (
            <div className="today-more">
              {late.length > LATE_SHOWN && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAllLate(!allLate)}
                >
                  {allLate
                    ? "Show fewer late tasks"
                    : `Show ${late.length - LATE_SHOWN} more late`}
                </button>
              )}
              {current && moreLate > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={onShowLate}
                >
                  All {current.late_total} late tasks{" "}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {current && unfinished.length > 0 && (
            <div className="today-unfinished">
              <h3>
                {unfinishedHeading({ unfinished })}{" "}
                <span>{unfinished.length}</span>
              </h3>
              <ul className="today-list is-unfinished">
                {unfinished.map((u) => (
                  <li key={u.block_id} className="today-row is-unfinished">
                    <span className="today-main">
                      <button
                        type="button"
                        className="today-title"
                        onClick={() => onOpen(u.item_id)}
                        aria-label={`Open ${u.title}`}
                      >
                        {u.title}
                      </button>
                      <span className="today-facts">
                        <small className="today-meta">
                          {unfinishedWhen(u)}
                        </small>
                      </span>
                    </span>
                    <span className="today-buttons">
                      <button
                        type="button"
                        className="text-button today-action"
                        onClick={() => onPlanAgain(u.block_id)}
                        aria-label={`Plan ${u.title} again`}
                      >
                        Plan again
                      </button>
                      <button
                        type="button"
                        className="text-button today-action is-quiet"
                        onClick={() => dismiss(u.block_id)}
                        aria-label={`Dismiss ${u.title}`}
                      >
                        Dismiss
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="today-footer">
        <button type="button" className="text-button" onClick={onOpenCalendar}>
          Open calendar <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
