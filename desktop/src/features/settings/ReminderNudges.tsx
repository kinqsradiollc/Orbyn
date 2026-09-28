import { useEffect, useState } from "react";
import type { ReminderNudgeSettings } from "@orbyn/core";
import { client } from "../../lib/api";
import { DateField } from "../../components/DateField";
import { OutcomeNote, useAction } from "../../components/Outcome";

/** Channels and local quiet hours for personal reminders. */
export function ReminderNudges({
  report,
}: {
  report: (error: unknown) => void;
}) {
  const [value, setValue] = useState<ReminderNudgeSettings | null>(null);
  const action = useAction(report);
  useEffect(() => {
    void client.reminderNudgeSettings().then(setValue, report);
  }, [report]);
  if (!value) return <p className="muted">Loading reminders…</p>;
  return (
    <section className="agents-rules night-shift">
      <h3>Reminder nudges</h3>
      <p className="muted">
        A reminder when your own work needs attention, with no AI request. At
        most three a day, and one per thing in 24 hours.
      </p>
      <form
        className="agents-identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            setValue(await client.updateReminderNudgeSettings(value));
            return "Reminders saved.";
          });
        }}
      >
        {(["enabled", "chat", "push", "email"] as const).map((key) => (
          <label className="settings-field" key={key}>
            <span>
              {
                {
                  enabled: "Send reminder nudges",
                  chat: "Private Reminders chat",
                  push: "Push notifications",
                  email: "Email overdue work and underbooked deadlines",
                }[key]
              }
            </span>
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={value[key]}
              disabled={action.pending}
              onChange={(event) =>
                setValue({ ...value, [key]: event.target.checked })
              }
            />
          </label>
        ))}
        {(["quiet_start", "quiet_end"] as const).map((key) => (
          <div className="settings-field" key={key}>
            <label htmlFor={`nudge-${key}`}>
              {key === "quiet_start" ? "Quiet hours start" : "Quiet hours end"}
            </label>
            <DateField
              id={`nudge-${key}`}
              type="time"
              value={value[key]}
              onChange={(event) =>
                setValue({ ...value, [key]: event.target.value })
              }
            />
          </div>
        ))}
        <p className="muted">
          Times use your planning time zone. Stop reminders for one thing from
          its Reminders chat card.
        </p>
        <div className="button-row start">
          <button className="primary" disabled={action.pending}>
            Save reminders
          </button>
        </div>
        <OutcomeNote outcome={action.outcome} />
      </form>
    </section>
  );
}
