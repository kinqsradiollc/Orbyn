import { useState } from "react";
import { Bell, CalendarCheck, CalendarClock, CalendarDays } from "lucide-react";
import { dateLabel, type Notice } from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { stagger } from "../../lib/motion";

type Props = {
  notices: Notice[];
  onRead: (notice: Notice) => void;
  /** Moves the clashing block in a "conflict" notice to the next free time. */
  onReschedule: (notice: Notice) => Promise<void>;
  onOpenCalendar: () => void;
  /** Opens the bookings inbox on the booking in a "booking" notice's `ref`. */
  onOpenBooking: (bookingId: string) => void;
};

const ICONS = {
  reminder: Bell,
  conflict: CalendarClock,
  booking: CalendarCheck,
} as const;

export function NotificationsView({
  notices,
  onRead,
  onReschedule,
  onOpenCalendar,
  onOpenBooking,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <section className="card">
      {notices.map((n, index) => {
        const Icon = ICONS[n.kind ?? "reminder"] ?? Bell;
        // Booking notices point at a booking (`ref`), not an item.
        const bookingId = n.kind === "booking" ? n.ref : undefined;
        const openBooking = (id: string) => {
          if (!n.read) onRead(n);
          onOpenBooking(id);
        };
        return (
          <div
            className={"notice fade-up stagger " + (n.read ? "read" : "")}
            style={stagger(index)}
            key={n.id}
          >
            <button
              className="notice-main"
              onClick={() => (bookingId ? openBooking(bookingId) : onRead(n))}
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
          body="Reminders, clashes and new bookings will appear here."
        />
      )}
    </section>
  );
}
