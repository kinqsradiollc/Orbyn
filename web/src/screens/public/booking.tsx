import { useEffect } from "react";
import { useAccount } from "../../app/account";
import type { ScreenProps } from "../../app/routes";
import { useTitle } from "../../lib/router";
import { PublicFrame } from "./PublicFrame";
import { BookingDomain } from "../booking/shared";
import { PublicBook, PublicInviteBook } from "../booking/public-book";
import { Manage, TokenAction } from "../booking/public-manage";
import { Rsvp, Profile } from "../booking/public-identity";
import "../booking/booking.css";
function decode(raw: string | undefined) {
  if (!raw) return null;
  try {
    const value = decodeURIComponent(raw);
    return value && !/[\x00-\x1f/]/.test(value) ? value : null;
  } catch {
    return null;
  }
}
export default function PublicBookingScreen({ params }: ScreenProps) {
  useTitle("Booking");
  const account = useAccount();
  const path = location.pathname,
    slug = decode(params.slug),
    event = decode(params.event),
    token = decode(params.token),
    handle = decode(params.handle),
    identity = JSON.stringify(params);
  const embed =
    location.pathname.startsWith("/book/") &&
    !!slug &&
    !event &&
    !["manage", "confirm", "cancel"].includes(slug) &&
    new URLSearchParams(location.search).get("embed") === "1";
  useEffect(() => {
    const previous = document.querySelector<HTMLMetaElement>(
        'meta[name="referrer"]',
      ),
      old = previous?.content;
    const referrer = previous || document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    if (!previous) document.head.append(referrer);
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow, noarchive";
    document.head.append(robots);
    return () => {
      robots.remove();
      if (previous) previous.content = old || "";
      else referrer.remove();
    };
  }, []);
  const validToken = (value: string | null) =>
    !!value && /^[A-Za-z0-9_-]{20,64}$/.test(value);
  let body;
  if (path.startsWith("/rsvp/"))
    body = validToken(token) ? (
      <Rsvp token={token!} />
    ) : (
      <p role="alert">This RSVP link is incomplete.</p>
    );
  else if (path.startsWith("/invite/"))
    body = validToken(token) ? (
      <PublicInviteBook token={token!} />
    ) : (
      <p role="alert">This invite link is incomplete.</p>
    );
  else if (path.startsWith("/u/"))
    body = handle ? (
      <Profile handle={handle} />
    ) : (
      <p role="alert">This profile link is incomplete.</p>
    );
  else if (slug && ["confirm", "manage", "cancel"].includes(slug))
    body = !validToken(event) ? (
      <p role="alert">This private booking link is incomplete.</p>
    ) : slug === "manage" ? (
      <Manage token={event!} />
    ) : (
      <TokenAction
        token={event!}
        kind={slug === "confirm" ? "confirm" : "cancel"}
      />
    );
  else
    body =
      slug && !event ? (
        <PublicBook slug={slug} />
      ) : (
        <p role="alert">This booking link is invalid.</p>
      );
  const content = (
    <BookingDomain key={`${account.version}:${identity}`} anonymous>
      <main className="booking-web-public" aria-label="Booking">
        {body}
      </main>
    </BookingDomain>
  );
  return embed ? content : <PublicFrame>{content}</PublicFrame>;
}
