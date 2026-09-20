import { CalendarSync } from "lucide-react";

/** How to subscribe to your events from a desktop/phone calendar app. */
export function CalDavNote() {
  const url = `${location.origin.replace(/\/$/, "")}/dav/`;
  return (
    <section className="card settings-card" aria-labelledby="caldav-title">
      <h2 id="caldav-title">
        <CalendarSync size={18} aria-hidden="true" /> Subscribe from a calendar
        app
      </h2>
      <p className="muted">
        Add your Orbyn events to Apple Calendar, Thunderbird or DAVx5 over
        CalDAV (read-only for now). Use your email as the username and a
        personal API key (above) as the password.
      </p>
      <code className="two-factor-secret">{url}</code>
    </section>
  );
}
