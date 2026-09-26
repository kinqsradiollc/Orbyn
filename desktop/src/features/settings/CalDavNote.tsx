import { SettingsSection } from "./SettingsSection";
import { CalendarSync } from "lucide-react";

/** How to subscribe to your events from a desktop/phone calendar app. */
export function CalDavNote() {
  const url = `${location.origin.replace(/\/$/, "")}/dav/`;
  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="caldav-title"
    >
      <h2 id="caldav-title">
        <CalendarSync size={18} aria-hidden="true" /> Subscribe from a calendar
        app
      </h2>
      <p className="muted">
        Show your Orbyn events, read-only, in Apple Calendar, Thunderbird or
        DAVx5, signing in with your email and a personal API key.
      </p>
      <code className="two-factor-secret">{url}</code>
    </SettingsSection>
  );
}
