import {
  activityOriginLabel,
  dateLabel,
  deadlineOf,
  groupNotices,
  noticeGroupCount,
  noticeGroupLabel,
  noticeSource,
  type AgentQuestion,
  type Notice,
  type PageMention,
} from "@orbyn/core";
import {
  AlertTriangle,
  AtSign,
  Bell,
  Bot,
  Boxes,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Clock,
  FastForward,
  FileText,
  Hourglass,
  Inbox,
  LayoutTemplate,
  MessageCircleQuestion,
  Pin,
  PinOff,
  Play,
  Timer,
  UserCheck,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../../app/account";
import type { ScreenProps } from "../../app/routes";
import { messageOf, useResource } from "../../lib/resource";
import { navigate, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Empty,
  ErrorNotice,
  IconButton,
  Loading,
  useToast,
} from "../../ui/kit";
import { onNews } from "../calendar/useWorkspace";
import { AskCard } from "../shared-task/sections";
import { refreshPlanner, tasks, useItems } from "../shared-task";
import "./notifications.css";

const POLL_MS = 30_000;

const ICONS: Partial<Record<NonNullable<Notice["kind"]>, LucideIcon>> = {
  reminder: Bell,
  conflict: CalendarClock,
  booking: CalendarCheck,
  rollforward: FastForward,
  at_risk: AlertTriangle,
  deadline: Hourglass,
  rsvp: UserCheck,
  template: LayoutTemplate,
  project: Boxes,
  import: FileText,
  mention: AtSign,
  session: Timer,
  review: Inbox,
  question: MessageCircleQuestion,
  agent: Bot,
  assistant: Bot,
  system: Clock,
};

const pinKey = (user: string) => `orbyn-notifications-pinned:${user}`;

/** Whether this account keeps notifications open on this device. */
export function useNotificationPin() {
  const { user } = useAccount();
  const id = user?.id ?? "";
  const [state, setState] = useState({ id: "", pinned: false });
  useEffect(() => {
    if (!id) return;
    let pinned = false;
    try {
      pinned = localStorage.getItem(pinKey(id)) === "1";
    } catch {
      // Without storage it stays off.
    }
    setState({ id, pinned });
  }, [id]);
  const set = (pinned: boolean) => {
    setState({ id, pinned });
    try {
      if (pinned) localStorage.setItem(pinKey(id), "1");
      else localStorage.removeItem(pinKey(id));
    } catch {
      // Kept for this visit.
    }
  };
  return { pinned: state.id === id && state.pinned, set };
}

/** Follows the server: polled, and at once when news arrives. */
function useNotices() {
  const read = useResource(() => client.listNotifications(), []);
  const reload = useRef(read.reload);
  reload.current = read.reload;
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void reload.current();
    }, POLL_MS);
    const stop = onNews((news) => {
      if (news.kind === "changed") void reload.current();
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  }, []);
  return read;
}

function NoticeRow({
  notice: n,
  markRead,
  reload,
  pending,
  run,
}: {
  notice: Notice;
  markRead: (notice: Notice) => void;
  reload: () => void;
  pending: string | null;
  run: (notice: Notice, fn: () => Promise<void>) => Promise<string>;
}) {
  const items = useItems();
  const [error, setError] = useState("");
  const Icon = ICONS[n.kind ?? "reminder"] ?? Bell;
  const go = (to: string) => {
    if (!n.read) markRead(n);
    navigate(to);
  };
  const act = (fn: () => Promise<void>) => {
    setError("");
    void run(n, fn).then(setError);
  };
  const bookingId = n.kind === "booking" ? n.ref : undefined;
  const eventId = n.kind === "rsvp" ? n.item_id : undefined;
  const source = (n.kind ?? "reminder") === "reminder" ? noticeSource(n) : null;
  const reminderId = source?.kind === "item" ? source.id : null;
  const docId =
    (n.kind === "import" || n.kind === "mention") && n.ref?.startsWith("doc:")
      ? n.ref.slice(4).split(":")[0]
      : undefined;
  const openEvent = (id: string) => {
    if (!n.read) markRead(n);
    tasks.open(id);
  };
  const main = () => {
    if (bookingId) go(`/app/booking?open=${encodeURIComponent(bookingId)}`);
    else if (eventId) openEvent(eventId);
    else if (docId) go(`/app/doc/${docId}`);
    else markRead(n);
  };
  const planIt = () => {
    const item = items.find((i) => i.id === n.item_id);
    const until = item ? deadlineOf(item) : null;
    const query = new URLSearchParams({ plan: "notice", include: n.item_id! });
    if (until) query.set("until", until);
    go(`/app/calendar?${query}`);
  };
  const action = (
    label: string,
    icon: LucideIcon,
    onClick: () => void,
    busy = false,
  ) => {
    const Glyph = icon;
    return (
      <Button disabled={busy} onClick={onClick}>
        <Glyph aria-hidden="true" /> {label}
      </Button>
    );
  };
  const blocked = pending !== null;
  const mine = pending === n.id;
  return (
    <li className={`nt-row${n.read ? " is-read" : ""}`}>
      <button className="nt-main" onClick={main}>
        <Icon aria-hidden="true" />
        <span className="nt-text">
          <span className="nt-title" dir="auto">
            {n.title}
          </span>
          {n.body && (
            <span className="nt-body" dir="auto">
              {n.body}
            </span>
          )}
          <small>
            {dateLabel(n.created_at)}
            {n.via_agent
              ? ` · ${activityOriginLabel({ via_agent: n.via_agent })}`
              : ""}
            {n.read ? " · Read" : ""}
          </small>
        </span>
        {!n.read && (
          <span className="nt-dot">
            <span className="sr-only">Unread</span>
          </span>
        )}
      </button>
      <div className="nt-actions">
        {reminderId &&
          action("Open task or event", FileText, () => openEvent(reminderId))}
        {n.kind === "conflict" &&
          n.ref &&
          !n.read &&
          action(
            mine ? "Moving…" : "Reschedule",
            CalendarClock,
            () =>
              act(async () => {
                await client.rescheduleBlock(n.ref!);
                await refreshPlanner(true).catch(() => undefined);
                reload();
              }),
            blocked,
          )}
        {n.kind === "session" &&
          n.ref &&
          n.item_id &&
          action(
            mine ? "Starting…" : "Start",
            Play,
            () =>
              act(async () => {
                // Over or moved: focus still starts on the task.
                await client
                  .startSession(n.ref!.split(":")[0], "reminder")
                  .catch(() => undefined);
                const task =
                  items.find((i) => i.id === n.item_id) ??
                  (await client.getItem(n.item_id!));
                tasks.focus(task);
              }),
            blocked,
          )}
        {n.kind === "template" &&
          n.ref &&
          action("Review", LayoutTemplate, () =>
            go(`/app/projects?template=${encodeURIComponent(n.ref!)}`),
          )}
        {n.kind === "assistant" &&
          n.ref?.startsWith("conversation:") &&
          action("Open conversation", Bot, () => {
            const [, destination, entry] = n.ref!.split(":");
            navigate(
              `/app/assistant?conversation=${encodeURIComponent(destination)}&entry=${encodeURIComponent(entry)}`,
            );
          })}
        {n.kind === "assistant" &&
          n.ref?.startsWith("overnight:") &&
          action("Review Overnight", Bot, () =>
            go(`/app/overnight/${n.ref!.slice("overnight:".length)}`),
          )}
        {(n.kind === "assistant" || n.kind === "reminder_nudge") &&
          n.ref?.startsWith("chat:") &&
          action("Open chat", Bot, () =>
            go(
              `/app/assistant?chat=${encodeURIComponent(n.ref!.split(":")[1])}`,
            ),
          )}
        {n.kind === "review" &&
          n.ref?.startsWith("proposal:") &&
          action("Review", Inbox, () =>
            go(`/app/review/${n.ref!.slice("proposal:".length)}`),
          )}
        {n.kind === "agent" &&
          n.ref?.startsWith("grant:") &&
          action("Open Connected agents", Bot, () => go("/app/agents"))}
        {n.kind === "project" &&
          n.ref &&
          action("Open project", CalendarDays, () =>
            go(`/app/project/${n.ref!.split(":")[0]}`),
          )}
        {n.kind === "rollforward" &&
          action(
            mine ? "Planning…" : "Roll forward",
            FastForward,
            () =>
              act(async () => {
                const plan = await client.rollForward();
                navigate(
                  `/app/calendar?plan_id=${encodeURIComponent(plan.id)}`,
                );
              }),
            blocked,
          )}
        {(n.kind === "at_risk" || n.kind === "deadline") &&
          n.item_id &&
          action("Plan it", Wand2, planIt)}
        {eventId && action("Open event", UserCheck, () => openEvent(eventId))}
        {bookingId &&
          action("Open booking", CalendarCheck, () =>
            go(`/app/booking?open=${encodeURIComponent(bookingId)}`),
          )}
        {n.kind === "booking" &&
          !bookingId &&
          action("Open calendar", CalendarDays, () => go("/app/calendar"))}
      </div>
      {error && (
        <div className="nt-error">
          <ErrorNotice message={error} />
        </div>
      )}
    </li>
  );
}

function NoticeList({
  notices,
  reload,
  limit,
}: {
  notices: Notice[];
  reload: () => void;
  limit?: number;
}) {
  const toast = useToast();
  const [local, setLocal] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const lock = useRef(false);
  const shown = notices.map((n) =>
    local.has(n.id) ? { ...n, read: true } : n,
  );
  const markRead = useCallback(
    (notice: Notice) => {
      if (notice.read) return;
      setLocal((ids) => new Set(ids).add(notice.id));
      client.markNotificationRead(notice.id).then(
        () => reload(),
        (error) => {
          setLocal((ids) => {
            const next = new Set(ids);
            next.delete(notice.id);
            return next;
          });
          toast({
            text: messageOf(error, "Couldn't mark that as read."),
            error: true,
          });
        },
      );
    },
    [reload, toast],
  );
  /** Runs a notice's action once, marking it read. Resolves with any failure. */
  const run = async (notice: Notice, fn: () => Promise<void>) => {
    if (lock.current) return "";
    lock.current = true;
    setPending(notice.id);
    try {
      await fn();
      markRead(notice);
      return "";
    } catch (error) {
      return messageOf(error, "Couldn't complete this action. Try again.");
    } finally {
      lock.current = false;
      setPending(null);
    }
  };
  let left = limit ?? Infinity;
  return (
    <>
      {groupNotices(shown).map((group) => {
        const rows = group.notices.slice(0, Math.max(0, left));
        left -= rows.length;
        if (!rows.length) return null;
        return (
          <section
            key={group.key}
            className="nt-group"
            aria-label={
              group.source
                ? `${noticeGroupLabel(group)} updates`
                : "Notification"
            }
          >
            {group.notices.length > 1 && (
              <h3>
                {noticeGroupLabel(group)} <span>{noticeGroupCount(group)}</span>
              </h3>
            )}
            <ul>
              {rows.map((n) => (
                <NoticeRow
                  key={n.id}
                  notice={n}
                  markRead={markRead}
                  reload={reload}
                  pending={pending}
                  run={run}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** Your agents' questions. An answer goes straight back to the agent. */
function AgentQuestions() {
  const read = useResource<AgentQuestion[]>(() => client.agentQuestions(), []);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const reload = useRef(read.reload);
  reload.current = read.reload;
  useEffect(
    () =>
      onNews((news) => {
        if (news.kind === "changed") void reload.current();
      }),
    [],
  );
  const answer = async (q: AgentQuestion, choice: string) => {
    if (lock.current) return;
    lock.current = true;
    setPending(q.id);
    setError("");
    try {
      await client.answerAgentQuestion(q.id, choice);
      read.set((all) => all?.filter((x) => x.id !== q.id));
    } catch (failure) {
      setError(messageOf(failure, "Couldn't send that answer."));
    } finally {
      lock.current = false;
      setPending(null);
    }
  };
  const list = read.data ?? [];
  if (!list.length && !read.error && !error) return null;
  return (
    <section className="nt-section" aria-labelledby="nt-questions">
      <h2 id="nt-questions">Your agents ask</h2>
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      <ul className="nt-questions">
        {list.map((q) => (
          <li key={q.id}>
            <span className="nt-title" dir="auto">
              {q.question}
            </span>
            {q.detail && (
              <p className="nt-body" dir="auto">
                {q.detail}
              </p>
            )}
            <small>
              {q.agent} · {dateLabel(q.created_at)}
              {q.default_choice
                ? ` · “${q.default_choice}” if you don't answer by ${new Date(
                    q.expires_at,
                  ).toLocaleString([], {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : ""}
            </small>
            <div className="nt-actions">
              {q.choices.map((choice) => (
                <Button
                  key={choice}
                  disabled={pending !== null}
                  onClick={() => void answer(q, choice)}
                >
                  {choice}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {error && <ErrorNotice message={error} />}
    </section>
  );
}

function Asks() {
  const read = useResource(() => client.listAsks(), []);
  const reload = useRef(read.reload);
  reload.current = read.reload;
  useEffect(
    () =>
      onNews((news) => {
        if (news.kind === "changed") void reload.current();
      }),
    [],
  );
  if (read.error && !read.data)
    return (
      <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
    );
  const lists = read.data;
  if (!lists || (!lists.to_me.length && !lists.from_me.length)) return null;
  const group = (title: string, asks: typeof lists.to_me) =>
    asks.length > 0 && (
      <div className="nt-asks">
        <h3>
          {title} <span>{asks.length}</span>
        </h3>
        {asks.map((ask) => (
          <div key={ask.id}>
            <button
              className="nt-title"
              dir="auto"
              onClick={() => tasks.open(ask.item_id)}
            >
              {ask.item_title}
            </button>
            <AskCard
              itemId={ask.item_id}
              onChanged={() => void read.reload()}
            />
          </div>
        ))}
      </div>
    );
  return (
    <section className="nt-section" aria-label="Asks">
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {group("Waiting for your answer", lists.to_me)}
      {group("Waiting on others", lists.from_me)}
    </section>
  );
}

function Mentions() {
  const read = useResource<PageMention[]>(() => client.mentions(20), []);
  const [all, setAll] = useState(false);
  const list = read.data ?? [];
  if (!list.length && !read.error) return null;
  return (
    <section className="nt-section" aria-labelledby="nt-mentions">
      <h2 id="nt-mentions">Mentioned in</h2>
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      <ul className="nt-mentions">
        {list.slice(0, all ? undefined : 6).map((m) => (
          <li key={`${m.doc_id}:${m.block_id}`}>
            <button
              onClick={() =>
                navigate(
                  `/app/doc/${m.doc_id}${m.block_id ? `#${encodeURIComponent(m.block_id)}` : ""}`,
                )
              }
            >
              <span className="nt-title" dir="auto">
                {m.title || "Untitled"}
              </span>
              {m.quote && (
                <span className="nt-body" dir="auto">
                  {m.quote}
                </span>
              )}
              <small>
                {m.mentioned_by ? `${m.mentioned_by} · ` : ""}
                {dateLabel(m.created_at)}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {list.length > 6 && (
        <Button
          variant="ghost"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : "More mentions"}
        </Button>
      )}
    </section>
  );
}

/** Pinned notifications, kept open on Today between visits. */
export function NotificationsPanel() {
  const read = useNotices();
  const list = read.data ?? [];
  const unread = list.filter((n) => !n.read);
  return (
    <section className="nt-panel" aria-labelledby="nt-pinned">
      <header>
        <h2 id="nt-pinned">Notifications</h2>
        <Button variant="ghost" onClick={() => navigate("/app/notifications")}>
          All
        </Button>
      </header>
      {read.error && !read.data && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {read.loading && !read.data && <Loading label="Loading notifications" />}
      {read.data && !unread.length && (
        <p className="muted small">Nothing unread.</p>
      )}
      {unread.length > 0 && (
        <NoticeList
          notices={unread}
          reload={() => void read.reload()}
          limit={4}
        />
      )}
    </section>
  );
}

export default function NotificationsScreen(_: ScreenProps) {
  useTitle("Notifications");
  const read = useNotices();
  const pin = useNotificationPin();
  const notices = read.data ?? [];
  const unread = notices.filter((n) => !n.read).length;
  return (
    <div className="nt">
      <header className="nt-head">
        <h1>
          Notifications{" "}
          {unread > 0 && <span className="nt-unread">{unread} unread</span>}
        </h1>
        <IconButton
          label={
            pin.pinned ? "Unpin notifications" : "Keep notifications on Today"
          }
          aria-pressed={pin.pinned}
          onClick={() => pin.set(!pin.pinned)}
        >
          {pin.pinned ? <PinOff /> : <Pin />}
        </IconButton>
      </header>
      <AgentQuestions />
      <Asks />
      <Mentions />
      <section className="nt-section" aria-label="All notifications">
        {read.error && (
          <ErrorNotice
            message={read.error}
            onRetry={() => void read.reload()}
          />
        )}
        {read.loading && !read.data && (
          <Loading label="Loading notifications" />
        )}
        {read.data && !notices.length && (
          <Empty title="No new notifications">
            <span>Updates will appear here.</span>
          </Empty>
        )}
        <NoticeList notices={notices} reload={() => void read.reload()} />
      </section>
    </div>
  );
}
