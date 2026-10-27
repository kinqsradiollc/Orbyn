import {
  type Booking,
  type BookingDetail,
  type BookingPage,
  type BookingPageInput,
  type BookingPageUpdate,
  type BookingReceipt,
  type BookingRequest,
  type BookingStats,
  type InviteBookingRequest,
  type ManagedBooking,
  type MeetingSlot,
  type MemberAvailability,
  type OpenInvite,
  type OpenInviteInput,
  type PublicBookingPage,
  type PublicInvite,
  type RsvpView,
  type UserAvailability,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

/** Busy times of up to 10 people you share a team with (at most 31 days). */

export function callAvailability(
  this: OrbynClient,
  userIds: string[],
  from: string,
  to: string,
) {
  const q = new URLSearchParams({ user_ids: userIds.join(","), from, to });
  return this.request<UserAvailability[]>(`/availability?${q}`);
}

// ---- invitations (public: the invitee's private link) ----

export function callGetRsvp(this: OrbynClient, token: string) {
  return this.request<RsvpView>(`/rsvp/${encodeURIComponent(token)}`, {
    anonymous: true,
  });
}

export function callAnswerRsvp(
  this: OrbynClient,
  token: string,
  status: "accepted" | "declined" | "tentative",
) {
  return this.request<RsvpView>(`/rsvp/${encodeURIComponent(token)}`, {
    method: "POST",
    body: { status },
    anonymous: true,
  });
}

// ---- team time ----

export function callTeamAvailability(
  this: OrbynClient,
  teamId: string,
  from: string,
  to: string,
) {
  const q = new URLSearchParams({ from, to });
  return this.request<MemberAvailability[]>(
    `/teams/${teamId}/availability?${q}`,
  );
}

export function callSuggestMeetingTimes(
  this: OrbynClient,
  teamId: string,
  params: { from: string; to: string; duration: number; user_ids?: string[] },
) {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    duration: String(params.duration),
  });
  if (params.user_ids?.length) q.set("user_ids", params.user_ids.join(","));
  return this.request<MeetingSlot[]>(`/teams/${teamId}/suggest?${q}`);
}

// ---- booking pages ----

export function callListBookingPages(this: OrbynClient) {
  return this.request<BookingPage[]>("/booking-pages");
}

export function callCreateBookingPage(
  this: OrbynClient,
  input: BookingPageInput,
) {
  return this.request<BookingPage>("/booking-pages", {
    method: "POST",
    body: input,
  });
}

export function callUpdateBookingPage(
  this: OrbynClient,
  id: string,
  input: BookingPageUpdate,
) {
  return this.request<BookingPage>(`/booking-pages/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteBookingPage(this: OrbynClient, id: string) {
  return this.request<void>(`/booking-pages/${id}`, { method: "DELETE" });
}

/** One page's upcoming and recent bookings (older apps; prefer `bookings`). */

export function callListBookings(this: OrbynClient, pageId: string) {
  return this.request<Booking[]>(`/booking-pages/${pageId}/bookings`);
}

export function callCancelBooking(
  this: OrbynClient,
  pageId: string,
  bookingId: string,
) {
  return this.request<{ cancelled: boolean }>(
    `/booking-pages/${pageId}/bookings/${bookingId}/cancel`,
    { method: "POST" },
  );
}

export function callBookingStats(this: OrbynClient, pageId?: string) {
  return this.request<BookingStats>(
    `/bookings/stats${pageId ? `?page_id=${pageId}` : ""}`,
  );
}

/** Free times a host can move a booking to (ignores its own time and notice). */

export function callGetBookingSlots(
  this: OrbynClient,
  id: string,
  params: { date?: string; days?: number; timezone: string },
) {
  const q = new URLSearchParams({ timezone: params.timezone });
  if (params.date) q.set("date", params.date);
  if (params.days) q.set("days", String(params.days));
  return this.request<
    Pick<PublicBookingPage, "timezone" | "duration" | "slots">
  >(`/bookings/${id}/slots?${q}`);
}

export function callGetBooking(this: OrbynClient, id: string) {
  return this.request<BookingDetail>(`/bookings/${id}`);
}

export function callApproveBooking(this: OrbynClient, id: string) {
  return this.request<BookingDetail>(`/bookings/${id}/approve`, {
    method: "POST",
  });
}

export function callDeclineBooking(this: OrbynClient, id: string, reason = "") {
  return this.request<BookingDetail>(`/bookings/${id}/decline`, {
    method: "POST",
    body: { reason },
  });
}

/** Cancel as a host; the booker is emailed with your reason. */

export function callCancelBookingAsHost(
  this: OrbynClient,
  id: string,
  reason = "",
) {
  return this.request<BookingDetail>(`/bookings/${id}/cancel`, {
    method: "POST",
    body: { reason },
  });
}

export function callRescheduleBooking(
  this: OrbynClient,
  id: string,
  startAt: string,
) {
  return this.request<BookingDetail>(`/bookings/${id}/reschedule`, {
    method: "POST",
    body: { start_at: startAt },
  });
}

export function callSetBookingNoShow(
  this: OrbynClient,
  id: string,
  noShow: boolean,
) {
  return this.request<BookingDetail>(`/bookings/${id}/no-show`, {
    method: "PUT",
    body: { no_show: noShow },
  });
}

export function callSetBookingNote(
  this: OrbynClient,
  id: string,
  hostNote: string,
) {
  return this.request<BookingDetail>(`/bookings/${id}/note`, {
    method: "PUT",
    body: { host_note: hostNote },
  });
}

/** Public: a booking from the booker's manage link. */

export function callGetManagedBooking(this: OrbynClient, token: string) {
  return this.request<ManagedBooking>(
    `/book/manage/${encodeURIComponent(token)}`,
    { anonymous: true },
  );
}

/** Public: free times to move a booking to. */

export function callGetRescheduleSlots(
  this: OrbynClient,
  token: string,
  params: { date?: string; days?: number; timezone: string },
) {
  const q = new URLSearchParams({ timezone: params.timezone });
  if (params.date) q.set("date", params.date);
  if (params.days) q.set("days", String(params.days));
  return this.request<
    Pick<PublicBookingPage, "timezone" | "duration" | "slots">
  >(`/book/manage/${encodeURIComponent(token)}/slots?${q}`, {
    anonymous: true,
  });
}

/** Public: move a booking from its manage link. */

export function callRescheduleByToken(
  this: OrbynClient,
  token: string,
  startAt: string,
) {
  return this.request<ManagedBooking>(
    `/book/manage/${encodeURIComponent(token)}/reschedule`,
    { method: "POST", body: { start_at: startAt }, anonymous: true },
  );
}

/** Public: cancel from the manage link. */

export function callCancelByManageToken(
  this: OrbynClient,
  token: string,
  reason = "",
) {
  return this.request<ManagedBooking>(
    `/book/manage/${encodeURIComponent(token)}/cancel`,
    { method: "POST", body: { reason }, anonymous: true },
  );
}

/** Public: a booking page and its free times (no sign-in). Without a
 * `duration`, the page's first length is shown. */

export function callGetPublicBookingPage(
  this: OrbynClient,
  slug: string,
  params: {
    duration?: number;
    date?: string;
    days?: number;
    timezone: string;
  },
) {
  const q = new URLSearchParams({ timezone: params.timezone });
  if (params.duration) q.set("duration", String(params.duration));
  if (params.date) q.set("date", params.date);
  if (params.days) q.set("days", String(params.days));
  return this.request<PublicBookingPage>(
    `/book/${encodeURIComponent(slug)}?${q}`,
    { anonymous: true },
  );
}

/** Public: ask for a time on a booking page. */

export function callBook(
  this: OrbynClient,
  slug: string,
  input: BookingRequest,
) {
  return this.request<BookingReceipt>(`/book/${encodeURIComponent(slug)}`, {
    method: "POST",
    body: input,
    anonymous: true,
  });
}

/** Public: the link from the confirmation email. */

export function callConfirmBooking(this: OrbynClient, token: string) {
  return this.request<BookingReceipt>(
    `/book/confirm/${encodeURIComponent(token)}`,
    {
      method: "POST",
      anonymous: true,
    },
  );
}

/** Public: the cancel link from a booking email. */

export function callCancelBookingByToken(this: OrbynClient, token: string) {
  return this.request<{ cancelled: boolean }>(
    `/book/cancel/${encodeURIComponent(token)}`,
    { method: "POST", anonymous: true },
  );
}

// ---- open invites ----

export function callListOpenInvites(this: OrbynClient) {
  return this.request<OpenInvite[]>("/open-invites");
}

/** A one-off link offering hand-picked windows; its `url` is the link to send. */

export function callCreateOpenInvite(
  this: OrbynClient,
  input: OpenInviteInput,
) {
  return this.request<OpenInvite>("/open-invites", {
    method: "POST",
    body: input,
  });
}

export function callGetOpenInvite(this: OrbynClient, id: string) {
  return this.request<OpenInvite>(`/open-invites/${id}`);
}

/** Withdraw an invite (a booking made from it is cancelled). */

export function callCancelOpenInvite(this: OrbynClient, id: string) {
  return this.request<void>(`/open-invites/${id}`, { method: "DELETE" });
}

/** Public: an open invite and its free times, from its link. */

export function callGetPublicInvite(
  this: OrbynClient,
  token: string,
  timezone: string,
) {
  return this.request<PublicInvite>(
    `/invite/${encodeURIComponent(token)}?${new URLSearchParams({ timezone })}`,
    { anonymous: true },
  );
}

/** Public: pick a time from an open invite (booked at once). */

export function callBookInvite(
  this: OrbynClient,
  token: string,
  input: InviteBookingRequest,
) {
  return this.request<BookingReceipt>(`/invite/${encodeURIComponent(token)}`, {
    method: "POST",
    body: input,
    anonymous: true,
  });
}

export function callSetMeetingBudget(
  this: OrbynClient,
  teamId: string,
  minutes: number | null,
) {
  return this.request<{ meeting_budget_minutes: number | null }>(
    `/teams/${teamId}/attention`,
    { method: "PUT", body: { meeting_budget_minutes: minutes } },
  );
}
