import { useEffect, useRef, useState } from "react";
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
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  const mounted = useRef(false);
  const action = useAction(report);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void client.reminderNudgeSettings().then(
      (next) => {
        if (live) setValue(next);
      },
      (error) => {
        if (live) {
          setFailed(true);
          reportRef.current(error);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [retry]);
  if (!value)
    return failed ? (
      <div>
        <p role="alert">Couldn't load reminders.</p>
        <button
          type="button"
          className="secondary"
          onClick={() => setRetry((old) => old + 1)}
        >
          Retry
        </button>
      </div>
    ) : (
      <p className="muted" role="status">
        Loading reminders…
      </p>
    );
  return (
    <section className="agents-rules night-shift">
      <h3>Reminder nudges</h3>
      <p className="muted">
        No AI request. At most three a day, once per item in 24 hours.
      </p>
      <form
        className="agents-identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const next = await client.updateReminderNudgeSettings(value);
            if (mounted.current) setValue(next);
            return "Reminders saved.";
          });
        }}
      >
        {(["enabled", "chat", "push", "email"] as const).map((key) => (
          <label className="settings-field" key={key}>
            <span>
              {
                {
                  enabled: "Reminders",
                  chat: "Private chat",
                  push: "Push notifications",
                  email: "Email",
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
              disabled={action.pending}
              onChange={(event) =>
                setValue({ ...value, [key]: event.target.value })
              }
            />
          </div>
        ))}
        <p className="muted">Quiet hours use your planning time zone.</p>
        <details>
          <summary>Reminder delivery</summary>
          <p className="muted">
            Email covers overdue work and underbooked deadlines. Stop reminders
            for an item from its Reminders chat card.
          </p>
        </details>
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
