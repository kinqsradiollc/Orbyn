import { useEffect, useState } from "react";
import {
  Inbox,
  AlertTriangle,
  Bell,
  Bot,
  CalendarCheck,
  CalendarClock,
  Clock,
  CalendarDays,
  FastForward,
  FileText,
  Hourglass,
  AtSign,
  Play,
  Timer,
  UserCheck,
  Wand2,
  type LucideIcon,
  LayoutTemplate,
  MessageCircleQuestion,
} from "lucide-react";
import {
  activityOriginLabel,
  dateLabel,
  type AgentQuestion,
  type Notice,
  type PageMention,
} from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { stagger } from "../../lib/motion";
import { client } from "../../lib/api";
import { CONCEPT_ICON } from "../../app/concept-icons";
import { onLive } from "../../lib/live";

type Props = {
  notices: Notice[];
  onRead: (notice: Notice) => void;
  /** Moves the clashing block in a "conflict" notice to the next free time. */
  onReschedule: (notice: Notice) => Promise<void>;
  /** Plans unfinished blocks again and shows the plan in the calendar. */
  onRollForward: (notice: Notice) => Promise<void>;
  /** Opens the planner on a preview that includes the notice's task. */
  onPlanIt: (notice: Notice) => void;
  onOpenCalendar: () => void;
  /** Opens an item's details (the event in an "rsvp" notice). */
  onOpenItem: (itemId: string) => void;
  /** Opens the bookings inbox on the booking in a "booking" notice's `ref`. */
  onOpenBooking: (bookingId: string) => void;
  /** Opens a template that is ready to start, for review ("template" notices). */
  onOpenTemplate?: (templateId: string) => void;
  onOpenProject?: (projectId: string) => void;
  /** Opens a page in Docs (an imported file that's ready: "import" notices). */
  onOpenDoc?: (docId: string) => void;
  /** Starts a session from its reminder ("session" notices), in focus mode. */
  onStartSession?: (blockId: string, itemId: string) => Promise<void>;
  /** Opens Review on the proposal in a "review" notice's `ref`. */
  onOpenReview?: (proposalId: string) => void;
  /**
   * Opens Settings at one setting: "agents" for an agent notice about a
   * connection (a big job finished, say), where each change can be undone.
   */
  onOpenSetting?: (id: string) => void;
  /** Reopens a saved assistant chat, including its active run. */
  onOpenChat?: (id: string) => void;
  onOpenOvernight?: () => void;
};

const ICONS: Partial<Record<NonNullable<Notice["kind"]>, LucideIcon>> = {
  reminder: Bell,
  conflict: CalendarClock,
  booking: CalendarCheck,
  rollforward: FastForward,
  at_risk: AlertTriangle,
  deadline: Hourglass,
  rsvp: UserCheck,
  template: LayoutTemplate,
  project: CONCEPT_ICON.project,
  import: FileText,
  mention: AtSign,
  session: Timer,
  review: Inbox,
  question: MessageCircleQuestion,
  agent: Bot,
  assistant: Bot,
  system: Clock,
};

/**
 * Questions your agents asked (ask_person) that wait for you: each choice
 * is a button, and the answer goes straight back to the agent. Re-read when
 * anything changes (a new question, or one answered on the phone).
 */
function AgentQuestions() {
  const [list, setList] = useState<AgentQuestion[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => client.agentQuestions().then(setList, () => {});
    void load();
    return onLive((news) => news.kind === "changed" && void load());
  }, []);
  if (!list.length) return null;
  const answer = (q: AgentQuestion, choice: string) => {
    setPending(q.id);
    setError(null);
    client
      .answerAgentQuestion(q.id, choice)
      .then(
        () => setList((all) => all.filter((x) => x.id !== q.id)),
        (e: Error) => setError(e.message),
      )
      .finally(() => setPending(null));
  };
  return (
    <section className="card agent-questions" aria-labelledby="agent-questions">
      <h2 id="agent-questions">
        <MessageCircleQuestion size={16} aria-hidden="true" /> Your agents ask
      </h2>
      <ul>
        {list.map((q) => (
          <li key={q.id}>
            <strong>{q.question}</strong>
            {q.detail && <p>{q.detail}</p>}
            <small className="muted">
              {q.agent} · {dateLabel(q.created_at)}
              {q.default_choice
                ? ` · “${q.default_choice}” if you don’t answer by ${new Date(
                    q.expires_at,
                  ).toLocaleString([], {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : ""}
            </small>
            <div className="agent-question-choices">
              {q.choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="secondary"
                  disabled={pending === q.id}
                  onClick={() => answer(q, c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
    </section>
  );
}

/**
 * "Mentioned in": the pages that name you, newest first, with the line
 * around the mention. Only pages you can still open are listed.
 */
function MentionedIn({ onOpenDoc }: { onOpenDoc?: (docId: string) => void }) {
  const [list, setList] = useState<PageMention[] | null>(null);
  useEffect(() => {
    client.mentions(20).then(setList, () => setList([]));
  }, []);
  if (!list?.length) return null;
  return (
    <section className="card mentioned-in" aria-labelledby="mentioned-in">
      <h2 id="mentioned-in">
        <AtSign size={16} aria-hidden="true" /> Mentioned in
      </h2>
      <ul>
        {list.slice(0, 6).map((m) => (
          <li key={`${m.doc_id}:${m.block_id}`}>
            <button
              type="button"
              className="mentioned-row"
              onClick={() => onOpenDoc?.(m.doc_id)}
              disabled={!onOpenDoc}
            >
              <strong>{m.title || "Untitled"}</strong>
              {m.quote && <span className="mentioned-quote">{m.quote}</span>}
              <small>
                {m.mentioned_by ? `${m.mentioned_by} · ` : ""}
                {dateLabel(m.created_at)}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotificationsView({
  notices,
  onRead,
  onReschedule,
  onRollForward,
  onPlanIt,
  onOpenCalendar,
  onOpenItem,
  onOpenBooking,
  onOpenTemplate,
  onOpenProject,
  onOpenDoc,
  onStartSession,
  onOpenReview,
  onOpenSetting,
  onOpenChat,
  onOpenOvernight,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <>
      <AgentQuestions />
      <MentionedIn onOpenDoc={onOpenDoc} />
      <section className="card">
        {notices.map((n, index) => {
          const Icon = ICONS[n.kind ?? "reminder"] ?? Bell;
          // Booking notices point at a booking (`ref`), not an item.
          const bookingId = n.kind === "booking" ? n.ref : undefined;
          const openBooking = (id: string) => {
            if (!n.read) onRead(n);
            onOpenBooking(id);
          };
          // Answers to invitations point at the event.
          const eventId = n.kind === "rsvp" ? n.item_id : undefined;
          // An imported file that's ready points at its page ("doc:<id>").
          const docId =
            (n.kind === "import" || n.kind === "mention") &&
            n.ref?.startsWith("doc:")
              ? n.ref.slice(4).split(":")[0]
              : undefined;
          const openEvent = (id: string) => {
            if (!n.read) onRead(n);
            onOpenItem(id);
          };
          /** Runs a notice's action once, marking it read. */
          const act = (fn: () => Promise<void>) => {
            setPending(n.id);
            if (!n.read) onRead(n);
            void fn().finally(() => setPending(null));
          };
          return (
            <div
              className={"notice fade-up stagger " + (n.read ? "read" : "")}
              style={stagger(index)}
              key={n.id}
            >
              <button
                className="notice-main"
                onClick={() =>
                  bookingId
                    ? openBooking(bookingId)
                    : eventId
                      ? openEvent(eventId)
                      : docId && onOpenDoc
                        ? (() => {
                            if (!n.read) onRead(n);
                            onOpenDoc(docId);
                          })()
                        : onRead(n)
                }
              >
                <Icon size={19} />
                <span>
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                  <small>
                    {dateLabel(n.created_at)}
                    {n.via_agent
                      ? ` · ${activityOriginLabel({ via_agent: n.via_agent })}`
                      : ""}
                    {n.read ? " · Read" : ""}
                  </small>
                </span>
                {!n.read && <i aria-label="Unread" />}
              </button>
              {n.kind === "conflict" && n.ref && !n.read && (
                <button
                  className="secondary notice-action"
                  disabled={pending === n.id}
                  onClick={() => {
                    setPending(n.id);
                    void onReschedule(n).finally(() => setPending(null));
                  }}
                >
                  <CalendarClock size={14} />{" "}
                  {pending === n.id ? "Moving…" : "Reschedule"}
                </button>
              )}
              {n.kind === "session" && n.ref && n.item_id && onStartSession && (
                <button
                  className="secondary notice-action"
                  disabled={pending === n.id}
                  onClick={() =>
                    act(() => onStartSession(n.ref!.split(":")[0], n.item_id!))
                  }
                >
                  <Play size={14} /> {pending === n.id ? "Starting…" : "Start"}
                </button>
              )}
              {n.kind === "template" && n.ref && onOpenTemplate && (
                <button
                  className="secondary notice-action"
                  onClick={() => {
                    if (!n.read) onRead(n);
                    onOpenTemplate(n.ref!);
                  }}
                >
                  <LayoutTemplate size={14} /> Review
                </button>
              )}
              {n.kind === "assistant" &&
                n.ref?.startsWith("overnight:") &&
                onOpenOvernight && (
                  <button
                    className="secondary notice-action"
                    onClick={() => {
                      if (!n.read) onRead(n);
                      onOpenOvernight();
                    }}
                  >
                    <Bot size={14} /> Review Overnight
                  </button>
                )}
              {(n.kind === "assistant" || n.kind === "reminder_nudge") &&
                n.ref?.startsWith("chat:") &&
                onOpenChat && (
                  <button
                    className="secondary notice-action"
                    onClick={() => {
                      if (!n.read) onRead(n);
                      onOpenChat(n.ref!.split(":")[1]);
                    }}
                  >
                    <Bot size={14} /> Open chat
                  </button>
                )}
              {n.kind === "review" &&
                n.ref?.startsWith("proposal:") &&
                onOpenReview && (
                  <button
                    className="secondary notice-action"
                    onClick={() => {
                      if (!n.read) onRead(n);
                      onOpenReview(n.ref!.slice("proposal:".length));
                    }}
                  >
                    <Inbox size={14} /> Review
                  </button>
                )}
              {n.kind === "agent" &&
                n.ref?.startsWith("grant:") &&
                onOpenSetting && (
                  <button
                    className="secondary notice-action"
                    onClick={() => {
                      if (!n.read) onRead(n);
                      onOpenSetting("agents");
                    }}
                  >
                    <Bot size={14} /> Open Connected agents
                  </button>
                )}
              {n.kind === "project" && n.ref && onOpenProject && (
                <button
                  className="secondary notice-action"
                  onClick={() => {
                    if (!n.read) onRead(n);
                    onOpenProject(n.ref!.split(":")[0]);
                  }}
                >
                  <CalendarDays size={14} /> Open project
                </button>
              )}
              {n.kind === "rollforward" && (
                <button
                  className="secondary notice-action"
                  disabled={pending === n.id}
                  onClick={() => act(() => onRollForward(n))}
                >
                  <FastForward size={14} />{" "}
                  {pending === n.id ? "Planning…" : "Roll forward"}
                </button>
              )}
              {(n.kind === "at_risk" || n.kind === "deadline") && n.item_id && (
                <button
                  className="secondary notice-action"
                  onClick={() => {
                    if (!n.read) onRead(n);
                    onPlanIt(n);
                  }}
                >
                  <Wand2 size={14} /> Plan it
                </button>
              )}
              {eventId && (
                <button
                  className="secondary notice-action"
                  onClick={() => openEvent(eventId)}
                >
                  <UserCheck size={14} /> Open event
                </button>
              )}
              {bookingId && (
                <button
                  className="secondary notice-action"
                  onClick={() => openBooking(bookingId)}
                >
                  <CalendarCheck size={14} /> Open booking
                </button>
              )}
              {n.kind === "booking" && !bookingId && (
                <button
                  className="secondary notice-action"
                  onClick={() => {
                    if (!n.read) onRead(n);
                    onOpenCalendar();
                  }}
                >
                  <CalendarDays size={14} /> Open calendar
                </button>
              )}
            </div>
          );
        })}
        {!notices.length && (
          <EmptyState
            icon={Bell}
            title="You’re all caught up."
            body="Reminders, answers to invitations, clashes, planner heads-ups and new bookings will appear here."
          />
        )}
      </section>
    </>
  );
}
