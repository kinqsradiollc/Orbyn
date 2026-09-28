import { useEffect, useState } from "react";
import { NIGHT_SHIFT_KINDS, type NightShiftSettings } from "@orbyn/core";
import { DateField } from "../../components/DateField";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import "./night-shift.css";

const labels = {
  plan: "Plan tomorrow",
  deadlines: "Deadlines",
  study: "Study",
  meetings: "Meetings",
  tidy: "Tidy up",
  handed: "Tasks handed to me",
  follow_through: "Follow through",
};

/** Personal night window, allowed work, and morning review controls. */
export function NightShift({ report }: { report: (error: unknown) => void }) {
  const [value, setValue] = useState<NightShiftSettings | null>(null);
  const action = useAction(report);
  useEffect(() => {
    void client.nightShiftSettings().then(setValue, report);
  }, [report]);
  if (!value) return <p className="muted">Loading night shift…</p>;
  return (
    <section className="agents-rules night-shift">
      <h3>Night shift</h3>
      <p className="muted">
        Your assistant can work while you’re away. Changes wait for your morning
        review unless you turn that off.
      </p>
      <form
        className="agents-identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            setValue(await client.updateNightShiftSettings(value));
            return "Night shift saved.";
          });
        }}
      >
        <label className="settings-field">
          <span>Work overnight</span>
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={value.enabled}
            onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
          />
        </label>
        <div className="settings-field">
          <label htmlFor="night-start">Start</label>
          <DateField
            id="night-start"
            type="time"
            value={value.start}
            onChange={(e) => setValue({ ...value, start: e.target.value })}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="night-end">End</label>
          <DateField
            id="night-end"
            type="time"
            value={value.end}
            onChange={(e) => setValue({ ...value, end: e.target.value })}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="night-zone">Time zone</label>
          <input
            id="night-zone"
            value={value.timezone}
            onChange={(e) => setValue({ ...value, timezone: e.target.value })}
            required
            placeholder="Australia/Melbourne"
          />
        </div>
        <fieldset>
          <legend>What to work on</legend>
          {NIGHT_SHIFT_KINDS.map((kind) => (
            <label className="settings-field" key={kind}>
              <span>{labels[kind]}</span>
              <input
                type="checkbox"
                checked={value.kinds[kind]}
                onChange={(e) =>
                  setValue({
                    ...value,
                    kinds: { ...value.kinds, [kind]: e.target.checked },
                  })
                }
              />
            </label>
          ))}
        </fieldset>
        <label className="settings-field">
          <span>Wait for my OK in the morning</span>
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={value.wait_for_ok}
            onChange={(e) =>
              setValue({ ...value, wait_for_ok: e.target.checked })
            }
          />
        </label>
        <p className="muted">
          Deletes, publishing, messages to other people, and work that needs
          permission always wait in Review.
        </p>
        <div className="button-row start">
          <button className="primary" disabled={action.pending}>
            Save night shift
          </button>
        </div>
        <OutcomeNote outcome={action.outcome} />
      </form>
    </section>
  );
}
