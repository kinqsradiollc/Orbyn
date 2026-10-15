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
        <CalendarSync size={16} aria-hidden="true" /> Calendar app
      </h2>
      <p className="muted">
        Read-only events. Sign in with your email and a personal API key.
      </p>
      <code className="two-factor-secret">{url}</code>
    </SettingsSection>
  );
}
