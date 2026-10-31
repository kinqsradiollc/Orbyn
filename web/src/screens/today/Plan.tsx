import {
  SESSION_OUTCOME_LABELS,
  checkInNote,
  shortMinutes,
  statusLabels,
  timeRange,
  todayIsCurrent,
  todayRowWords,
  unfinishedHeading,
  unfinishedWhen,
  type Item,
  type SessionCheckIn,
  type SessionOutcome,
  type TodayList,
  type TodayRow,
} from "@orbyn/core";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Play,
  Sun,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Loading, Pill, useToast } from "../../ui/kit";
import { tasks } from "../shared-task";
import { dayName } from "./dates";

const LATE_SHOWN = 5;
const MORE = [15, 30, 60, 120];
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

const planUntil = (id: string) =>
  navigate(`/app/calendar?plan=${encodeURIComponent(id)}`);

const toneOf = (tone: string) =>
  tone === "warn"
    ? "amber"
    : tone === "ok"
      ? "green"
      : tone === "accent"
        ? "blue"
        : undefined;

/** Sessions shown under a task: its own and any listed apart, once each. */
function sessionsOf(row: TodayRow, source: TodayRow[]) {
  const all = [
    ...row.sessions,
    ...source
      .filter((s) => s.kind === "session" && s.item_id === row.item_id)
      .map((s) => ({
        id: s.block_id ?? s.key,
        start_at: s.start_at!,
        end_at: s.end_at!,
      })),
  ];
  return [...new Map(all.map((s) => [s.id, s])).values()].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
}

function PlanRow({
  row,
  source,
  item,
  now,
  zone,
  onFocus,
}: {
  row: TodayRow;
  source: TodayRow[];
  item?: Item;
  now: Date;
  zone: string;
  onFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const words = todayRowWords(row, now, zone);
  const sessions = sessionsOf(row, source);
  const past =
    row.kind !== "task" &&
    (sessions.length
      ? sessions.every((s) => Date.parse(s.end_at) <= +now)
      : row.past || (!!row.end_at && Date.parse(row.end_at) <= +now));
  const action = sessions.some((s) => Date.parse(s.end_at) > +now)
    ? "focus"
    : row.action;
  const late = row.kind === "task" && row.due === "late";
  const warn =
    row.kind === "task" && (late || words.chips.some((c) => c.tone === "warn"));
  const Icon =
    row.kind === "event"
      ? CalendarClock
      : row.kind === "session"
        ? Timer
        : late
          ? AlertTriangle
          : Sun;
  const kind =
    row.kind === "event"
      ? "Event"
      : row.kind === "session"
        ? "Session"
        : "Task";
  return (
    <li
      className={`today-plan-row is-${row.kind}${past ? " is-past" : ""}${warn ? " is-warn" : ""}`}
    >
      <span className="today-plan-time">{words.lead}</span>
      <span className="today-plan-mark" title={kind}>
        <Icon aria-hidden="true" />
        <span className="sr-only">{kind}</span>
      </span>
      <div className="today-plan-main">
        {row.item_id ? (
          <button
            className="today-plan-title"
            dir="auto"
            aria-label={`Open ${row.title}`}
            onClick={() => tasks.open(row.item_id!)}
          >
            {row.title}
          </button>
        ) : (
          <span className="today-plan-title" dir="auto">
            {row.title}
          </span>
        )}
        {(words.meta ||
          words.chips.length > 0 ||
          item?.status === "blocked" ||
          item?.status === "in_progress") && (
          <span className="today-facts">
            {words.meta && (
              <span className={row.after_deadline ? "today-late" : ""}>
                {words.meta}
              </span>
            )}
            {(item?.status === "blocked" || item?.status === "in_progress") && (
              <Pill tone={item.status === "blocked" ? "amber" : "blue"}>
                {statusLabels[item.status]}
              </Pill>
            )}
            {words.chips.map((chip) => (
              <Pill key={chip.text} tone={toneOf(chip.tone)}>
                {chip.text}
              </Pill>
            ))}
          </span>
        )}
        {sessions.length > 0 && (
          <>
            <button
              className="today-disclose"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? (
                <ChevronDown aria-hidden="true" />
              ) : (
                <ChevronRight aria-hidden="true" />
              )}
              {sessions.length === 1
                ? "Planned session"
                : `${sessions.length} planned sessions`}
            </button>
            {open && (
              <ul className="today-sessions">
                {sessions.map((s) => (
                  <li key={s.id}>
                    {timeRange(s.start_at, s.end_at, zone)}
                    {row.deadline_at &&
                    Date.parse(s.end_at) > Date.parse(row.deadline_at)
                      ? " · After the deadline"
                      : ""}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {action === "focus" && row.item_id && (
        <Button
          variant="ghost"
          aria-label={`Start focus on ${row.title}`}
          onClick={() => onFocus(row.item_id!)}
        >
          <Play aria-hidden="true" /> Focus
        </Button>
      )}
      {action === "plan" && row.item_id && (
        <Button
          variant="ghost"
          aria-label={`Plan time for ${row.title}`}
          onClick={() => planUntil(row.item_id!)}
        >
          Plan it
        </Button>
      )}
    </li>
  );
}

const whenText = (s: SessionCheckIn) => {
  const start = new Date(s.start_at);
  const end = new Date(s.end_at);
  const time = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day} ${time(start)} – ${time(end)}`;
};

/**
 * A session that ended waits for an answer. It is never taken as done until
 * someone says so; Done and Need more count its time once, Skip leaves it owed.
 */
function CheckIns({
  rows,
  onChanged,
}: {
  rows: SessionCheckIn[];
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [gone, setGone] = useState<string[]>([]);
  const [said, setSaid] = useState<{
    item: string;
    text: string;
    plan: boolean;
  } | null>(null);
  const lock = useRef(false);
  const answer = async (
    s: SessionCheckIn,
    outcome: SessionOutcome,
    more?: number,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(s.id);
    setError("");
    try {
      const done = await client.checkInSession(s.id, {
        outcome,
        ...(more ? { more_minutes: more } : {}),
      });
      setGone((ids) => [...ids, s.id]);
      setAsking(null);
      setSaid({
        item: s.item_id,
        text: `${s.title}: ${checkInNote(outcome, done.counted_minutes)}`,
        plan: outcome !== "done",
      });
      onChanged();
    } catch (failure) {
      setError(
        `${messageOf(failure, "Couldn't save that.")} Try the check-in again.`,
      );
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
  const left = rows.filter((r) => !gone.includes(r.id));
  if (!left.length && !said && !error) return null;
  return (
    <section className="today-checks" aria-label="Session check-ins">
      {left.length > 0 && (
        <h3>
          How did it go? <span className="today-count">{left.length}</span>
        </h3>
      )}
      {error && <ErrorNotice message={error} />}
      {said && (
        <p className="today-said" role="status" dir="auto">
          <span>{said.text}</span>
          {said.plan && (
            <Button variant="ghost" onClick={() => planUntil(said.item)}>
              Plan it
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSaid(null)}>
            OK
          </Button>
        </p>
      )}
      <ul className="today-check-list">
        {left.map((s) => (
          <li key={s.id}>
            <div className="today-check-main">
              <button
                className="today-plan-title"
                dir="auto"
                onClick={() => tasks.open(s.item_id)}
              >
                {s.title}
              </button>
              <span className="today-facts">
                {whenText(s)} · {shortMinutes(s.minutes)}
                {s.project_name ? ` · ${s.project_name}` : ""}
              </span>
            </div>
            {asking === s.id ? (
              <div
                className="today-check-actions"
                role="group"
                aria-label={`How much more ${s.title} needs`}
              >
                {MORE.map((m) => (
                  <Button
                    key={m}
                    disabled={busy !== null}
                    onClick={() => void answer(s, "more", m)}
                  >
                    +{shortMinutes(m)}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div
                className="today-check-actions"
                role="group"
                aria-label={`How ${s.title} went`}
              >
                <Button
                  disabled={busy !== null}
                  onClick={() => void answer(s, "done")}
                >
                  {SESSION_OUTCOME_LABELS.done}
                </Button>
                <Button
                  disabled={busy !== null}
                  onClick={() => setAsking(s.id)}
                >
                  {SESSION_OUTCOME_LABELS.more}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void answer(s, "skipped")}
                >
                  {SESSION_OUTCOME_LABELS.skipped}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The day in time order. Events, sessions and check-ins stay separate records
 * and a task planned and due is one row with both facts.
 */
export function Plan({
  today,
  loading,
  error,
  items,
  onRetry,
  onChanged,
}: {
  today: TodayList | undefined;
  loading: boolean;
  error: string;
  items: Item[];
  onRetry: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [allLate, setAllLate] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const checks = useResource(() => client.sessionCheckIns(), [today]);
  const current = today && todayIsCurrent(today, now) ? today : null;
  // The list moves on at midnight.
  const stale = !!today && !current;
  useEffect(() => {
    if (stale) onRetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, now]);
  const source = useMemo(() => current?.rows ?? [], [current]);
  const byItem = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const rows = useMemo(() => {
    const taskIds = new Set(
      source.filter((r) => r.kind === "task").map((r) => r.item_id),
    );
    const seen = new Set<string>();
    return source.filter((r) => {
      if (r.kind === "event" || !r.item_id) return true;
      if (r.kind === "session" && taskIds.has(r.item_id)) return false;
      if (seen.has(r.item_id)) return false;
      seen.add(r.item_id);
      return true;
    });
  }, [source]);
  const onDay = rows.filter((r) => r.due !== "late" || r.at);
  const late = rows.filter((r) => r.due === "late" && !r.at);
  const lateListed = rows.filter((r) => r.due === "late").length;
  const moreLate = current ? current.late_total - lateListed : 0;
  const asked = new Set((checks.data ?? []).map((c) => c.id));
  const unfinished = (current?.unfinished ?? []).filter(
    (u) => !dismissed.includes(u.block_id) && !asked.has(u.block_id),
  );

  const focus = (id: string) => {
    const item = byItem.get(id);
    if (item) tasks.focus(item);
    else tasks.open(id);
  };
  const dismiss = (blockId: string) => {
    const listed = new Set(current?.unfinished.map((u) => u.block_id));
    const next = [...dismissed.filter((id) => listed.has(id)), blockId];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Hidden for this visit when the browser refuses storage.
    }
  };
  const again = async (blockId: string) => {
    try {
      const plan = await client.rollForward([blockId]);
      navigate(`/app/calendar?plan_id=${encodeURIComponent(plan.id)}`);
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't make that plan."),
        error: true,
      });
    }
  };
  const empty =
    current && !rows.length && !unfinished.length && !checks.data?.length;
  return (
    <section className="today-section" aria-labelledby="today-plan">
      <header className="today-section-head">
        <h2 id="today-plan">
          Your plan
          {current ? (
            <span className="today-head-note">{dayName(current.day)}</span>
          ) : null}
        </h2>
        <Button variant="ghost" onClick={() => navigate("/app/calendar")}>
          Open calendar
        </Button>
      </header>
      {!today && loading && <Loading label="Loading your plan" />}
      {!today && error && <ErrorNotice message={error} onRetry={onRetry} />}
      {today && !current && <p className="muted">Gathering your day…</p>}
      {empty && (
        <div className="today-quiet">
          <span>Nothing planned or due today.</span>
          <Button
            onClick={() => navigate("/app/calendar?plan=day&days=1&mode=day")}
          >
            Plan my day
          </Button>
        </div>
      )}
      {current && rows.length > 0 && (
        <ul className="today-plan" aria-label="Today, in time order">
          {[...onDay, ...(allLate ? late : late.slice(0, LATE_SHOWN))].map(
            (row) => (
              <PlanRow
                key={row.key}
                row={row}
                source={source}
                item={row.item_id ? byItem.get(row.item_id) : undefined}
                now={now}
                zone={current.timezone}
                onFocus={focus}
              />
            ),
          )}
        </ul>
      )}
      {(late.length > LATE_SHOWN || moreLate > 0) && (
        <div className="today-more">
          {late.length > LATE_SHOWN && (
            <Button variant="ghost" onClick={() => setAllLate(!allLate)}>
              {allLate
                ? "Show fewer late tasks"
                : `Show ${late.length - LATE_SHOWN} more late`}
            </Button>
          )}
          {moreLate > 0 && current && (
            <Button variant="ghost" onClick={() => navigate("/app/tasks")}>
              All {current.late_total} late tasks
            </Button>
          )}
        </div>
      )}
      {current && checks.data && (
        <CheckIns rows={checks.data} onChanged={onChanged} />
      )}
      {checks.error && !checks.data && (
        <ErrorNotice
          message={checks.error}
          onRetry={() => void checks.reload()}
        />
      )}
      {unfinished.length > 0 && (
        <section className="today-checks" aria-label="Unfinished sessions">
          <h3>
            {unfinishedHeading({ unfinished })}{" "}
            <span className="today-count">{unfinished.length}</span>
          </h3>
          <ul className="today-check-list">
            {unfinished.map((u) => (
              <li key={u.block_id}>
                <div className="today-check-main">
                  <button
                    className="today-plan-title"
                    dir="auto"
                    onClick={() => tasks.open(u.item_id)}
                  >
                    {u.title}
                  </button>
                  <span className="today-facts">{unfinishedWhen(u)}</span>
                </div>
                <div className="today-check-actions">
                  <Button
                    aria-label={`Plan ${u.title} again`}
                    onClick={() => void again(u.block_id)}
                  >
                    Plan again
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Dismiss ${u.title}`}
                    onClick={() => dismiss(u.block_id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
