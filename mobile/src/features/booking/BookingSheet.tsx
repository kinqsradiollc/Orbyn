import React, { useCallback, useEffect, useState } from "react";
import type { BookingPage, Team, User } from "@orbyn/core";
import { Sheet } from "../../components/Sheet";
import { BookingDetailView } from "./BookingDetailView";
import { BookingsHome, type BookingFilters } from "./BookingsHome";
import { InviteEditor } from "./Invites";
import { PageEditor } from "./PageEditor";

export { bookingLink } from "./helpers";

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
  const [pageDraft, setPageDraft] = useState<Extract<
    Screen,
    { kind: "page" }
  > | null>(null);
  const [newDraftVersion, setNewDraftVersion] = useState(0);
  const [pageSaved, setPageSaved] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [stack, setStack] = useState<Screen[]>([HOME]);
  const [filters, setFilters] = useState<BookingFilters>(FILTERS);
  const [pages, setPages] = useState<BookingPage[] | null>(null);
  const top = stack[stack.length - 1];
  const push = (screen: Screen) => {
    if (screen.kind === "page") {
      if (!screen.page && pageSaved)
        setNewDraftVersion((version) => version + 1);
      if (
        (screen.page?.id ?? null) !== (pageDraft?.page?.id ?? null) ||
        (!screen.page && pageSaved)
      )
        setPageSaved(false);
      setPageDraft(screen);
    }
    setStack((s) => [...s, screen]);
  };
  const pop = () => {
    if (inviteBusy || pageBusy || detailBusy) return;
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };
  const onPages = useCallback((next: BookingPage[]) => setPages(next), []);
  const patchFilters = (patch: Partial<BookingFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  useEffect(() => {
    setStack([HOME]);
    setPages(null);
    setFilters(FILTERS);
    setPageDraft(null);
    setPageSaved(false);
    setNewDraftVersion((version) => version + 1);
    setPageBusy(false);
    setInviteBusy(false);
    setDetailBusy(false);
  }, [user?.id]);

  useEffect(() => {
    if (visible && bookingId)
      setStack([HOME, { kind: "booking", id: bookingId }]);
  }, [visible, bookingId, user?.id]);

  const close = () => {
    if (inviteBusy || pageBusy || detailBusy) return;
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
      closeDisabled={inviteBusy || pageBusy || detailBusy}
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
      ) : top.kind === "invite" || top.kind === "page" ? null : (
        <BookingDetailView
          key={top.id}
          id={top.id}
          onBusyChange={setDetailBusy}
          pages={pages}
          onPages={onPages}
          // Page counts change with approvals and cancellations.
          onChanged={() => setPages(null)}
        />
      )}
      {pageDraft && (
        <PageEditor
          onBusyChange={setPageBusy}
          key={pageDraft.page?.id ?? `new-${newDraftVersion}`}
          visible={top.kind === "page"}
          page={pageDraft.page}
          user={user}
          teams={teams}
          onSaved={(saved) => {
            setPageSaved(true);
            setPages((list) =>
              list?.some((p) => p.id === saved.id)
                ? list.map((p) => (p.id === saved.id ? saved : p))
                : [...(list ?? []), saved],
            );
          }}
          onDeleted={() => {
            patchFilters({ pageId: null });
            setPages(null);
            setPageDraft(null);
            setPageSaved(false);
            // Completed deletion may leave while user navigation stays locked.
            setStack((screens) =>
              screens.length > 1 ? screens.slice(0, -1) : screens,
            );
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
      )}
      <InviteEditor
        visible={top.kind === "invite"}
        onBusyChange={setInviteBusy}
        teams={teams}
        userId={user?.id}
        onDone={() => {
          patchFilters({ tab: "invites" });
          pop();
        }}
      />
    </Sheet>
  );
}
