import type { User } from "@orbyn/core";

type Props = {
  user: User | null;
  busy: boolean;
  onEmailReminders: (checked: boolean) => void;
};

export function SettingsView({ user, busy, onEmailReminders }: Props) {
  return (
    <section className="card settings-card">
      <h2>Your account</h2>
      <p>
        {user?.name} · {user?.email}
      </p>
      <hr />
      <h2>Stay in the loop</h2>
      <label className="preference">
        <span>
          <strong>Email reminders</strong>
          <small>
            Receive a reminder before your tasks and events are due.
          </small>
        </span>
        <input
          type="checkbox"
          checked={user?.email_reminders || false}
          disabled={busy}
          onChange={(e) => onEmailReminders(e.target.checked)}
        />
      </label>
      <p className="muted">
        Mobile push notifications can be enabled in the Orbyn mobile app. Each
        item has its own reminder timing.
      </p>
      <hr />
      <h2>AI provider</h2>
      <p className="muted">
        Your server administrator configures the provider URL, API key, and
        model. Keys stay on the backend.
      </p>
    </section>
  );
}
