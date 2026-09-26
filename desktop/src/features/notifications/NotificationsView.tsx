import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CalendarClock,
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
} from "lucide-react";
import { dateLabel, type Notice, type PageMention } from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { stagger } from "../../lib/motion";
import { client } from "../../lib/api";

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
  project: CalendarDays,
  import: FileText,
  mention: AtSign,
  session: Timer,
};

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
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <>
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
