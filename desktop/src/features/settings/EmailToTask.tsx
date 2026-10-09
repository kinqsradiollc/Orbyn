import { SettingsSection } from "./SettingsSection";
import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import type { InboxInfo } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";

/** Email-to-task: a private address that turns mail into tasks. */
export function EmailToTask({ report }: { report: (e: unknown) => void }) {
  const [inbox, setInbox] = useState<InboxInfo | null>(null);
  const action = useAction(report);

  useEffect(() => {
    client.getInbox().then(setInbox, () => setInbox(null));
  }, []);

  const rotate = () =>
    void action.run(async () => {
      setInbox(await client.rotateInbox());
      return "Your email-to-task address is ready.";
    });
  const disable = () =>
    void action.run(async () => {
      await client.disableInbox();
      setInbox((i) => (i ? { ...i, address: null } : i));
      return "Email-to-task is off.";
    });

  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="inbox-title"
    >
      <h2 id="inbox-title">
        <Mail size={18} aria-hidden="true" /> Email to task
      </h2>
      <p className="muted">
        Email your private address to create a task. Subject becomes title; body
        becomes notes.
      </p>

      {inbox === null ? (
        <p className="muted">Loading…</p>
      ) : !inbox.configured ? (
        <p className="muted">An admin needs to enable inbound mail first.</p>
      ) : inbox.address ? (
        <>
          <code className="two-factor-secret">{inbox.address}</code>
          <div className="portability-actions">
            <button
              className="secondary"
              disabled={action.pending}
              onClick={rotate}
            >
              New address
            </button>
            <button
              className="text-button"
              disabled={action.pending}
              onClick={disable}
            >
              Turn off
            </button>
          </div>
        </>
      ) : (
        <button
          className="secondary"
          disabled={action.pending}
          onClick={rotate}
        >
          <Mail size={14} /> Turn on email-to-task
        </button>
      )}
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}
