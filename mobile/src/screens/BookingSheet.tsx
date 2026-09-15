import React, { useCallback, useEffect, useState } from "react";
import type { BookingPage, Team, User } from "@orbyn/core";
import { Sheet } from "../components/Sheet";
import { BookingDetailView } from "./booking/BookingDetailView";
import { BookingsHome, type BookingFilters } from "./booking/BookingsHome";
import { InviteEditor } from "./booking/Invites";
import { PageEditor } from "./booking/PageEditor";

export { bookingLink } from "./booking/helpers";

type Screen =
  | { kind: "home" }
  | { kind: "page"; page: BookingPage | null }
  | { kind: "booking"; id: string }
  | { kind: "invite" };

const TITLES: Record<Exclude<Screen["kind"], "page">, string> = {
  home: "Bookings",
  booking: "Booking",
  invite: "Offer times",
};

const HOME: Screen = { kind: "home" };
const FILTERS: BookingFilters = {
  tab: "bookings",
  view: "upcoming",
  q: "",
  pageId: null,
};

/**
 * Bookings people made through your booking pages, and the pages themselves:
 * links people outside Orbyn use to book time with you (and co-hosts).
 */
export function BookingSheet({
  visible,
  user,
  teams,
  bookingId,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  user: User | null;
  teams: Team[];
  /** Open straight to this booking, e.g. from a notification. */
  bookingId?: string | null;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [stack, setStack] = useState<Screen[]>([HOME]);
  const [filters, setFilters] = useState<BookingFilters>(FILTERS);
  const [pages, setPages] = useState<BookingPage[] | null>(null);
  const top = stack[stack.length - 1];
  const push = (screen: Screen) => setStack((s) => [...s, screen]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const onPages = useCallback((next: BookingPage[]) => setPages(next), []);
  const patchFilters = (patch: Partial<BookingFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (visible && bookingId)
      setStack([HOME, { kind: "booking", id: bookingId }]);
  }, [visible, bookingId]);

  const close = () => {
    setStack([HOME]);
    onClose();
  };
  const title =
    top.kind === "page"
      ? top.page
        ? "Booking page"
        : "New booking page"
      : TITLES[top.kind];

  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={close}
      onBack={stack.length > 1 ? pop : undefined}
      onDismiss={onDismiss}
    >
      {top.kind === "home" ? (
        <BookingsHome
          user={user}
          filters={filters}
          onFilters={patchFilters}
          pages={pages}
          onPages={onPages}
          onOpenPage={(page) => push({ kind: "page", page })}
          onOpenBooking={(b) => push({ kind: "booking", id: b.id })}
          onNewInvite={() => push({ kind: "invite" })}
        />
      ) : top.kind === "invite" ? (
        <InviteEditor
          teams={teams}
          userId={user?.id}
          onDone={() => {
            patchFilters({ tab: "invites" });
            pop();
          }}
        />
      ) : top.kind === "page" ? (
        <PageEditor
          key={top.page?.id ?? "new"}
          page={top.page}
          user={user}
          teams={teams}
          onSaved={(saved) =>
            setPages((list) =>
              list?.some((p) => p.id === saved.id)
                ? list.map((p) => (p.id === saved.id ? saved : p))
                : [...(list ?? []), saved],
            )
          }
          onDeleted={() => {
            patchFilters({ pageId: null });
            pop();
          }}
          onShowBookings={(page) => {
            patchFilters({
              tab: "bookings",
              pageId: page.id,
              view: "upcoming",
            });
            setStack([HOME]);
          }}
        />
      ) : (
        <BookingDetailView
          key={top.id}
          id={top.id}
          pages={pages}
          onPages={onPages}
          // Page counts change with approvals and cancellations.
          onChanged={() => setPages(null)}
        />
      )}
    </Sheet>
  );
}
