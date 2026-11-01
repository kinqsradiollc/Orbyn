import type {
  BookingDetail,
  BookingPage,
  ManagedBooking,
  Profile,
  RsvpView,
} from "@orbyn/core";
import { client } from "../../lib/session";
const fresh = {
  fresh: true,
  headers: { "X-Orbyn-Consistency": "primary" },
} as const;
/** Same typed routes as the client methods, with explicit causal readback. */
export const inspectBooking = (id: string) =>
  client.request<BookingDetail>(`/bookings/${encodeURIComponent(id)}`, fresh);
export const inspectPages = () =>
  client.request<BookingPage[]>("/booking-pages", fresh);
export const inspectProfile = () =>
  client.request<Profile>("/me/profile", fresh);
export const inspectManaged = (token: string) =>
  client.request<ManagedBooking>(`/book/manage/${encodeURIComponent(token)}`, {
    ...fresh,
    anonymous: true,
  });
export const inspectRsvp = (token: string) =>
  client.request<RsvpView>(`/rsvp/${encodeURIComponent(token)}`, {
    ...fresh,
    anonymous: true,
  });
