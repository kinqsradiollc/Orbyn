import { SettingsSection } from "./SettingsSection";
import { Mail, MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../../components/Popover";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { useSettingsRead } from "./useSettingsRead";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";

/** Email-to-task: a private address that turns mail into tasks. */
export function EmailToTask(props: { report: (e: unknown) => void }) {
  return <EmailToTaskBody key={session.get()} {...props} />;
}
function EmailToTaskBody({ report }: { report: (e: unknown) => void }) {
  const reading = useSettingsRead(() => client.getInbox(), report);
  const inbox = reading.data;
  const { ask } = useConfirm();
  const action = useAction(report);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const latest = useRef(inbox);
  latest.current = inbox;

  const rotate = () =>
    void action.run(async () => {
      if (!inbox?.configured || !reading.current()) return;
      if (
        inbox.address &&
        !(await ask({
          title: "Replace email address?",
          body: "Mail sent to your current address will stop creating tasks.",
          confirmLabel: "Replace address",
          cancelLabel: "Keep address",
        }))
      )
        return;
      if (
        !reading.current() ||
        latest.current?.address !== inbox.address ||
        !latest.current?.configured
      )
        return;
      const saved = await client.rotateInbox();
      reading.commit(saved);
      return "Email-to-task address ready.";
    });
  const disable = () =>
    void action.run(async () => {
      if (
        !reading.current() ||
        !(await ask({
          title: "Turn off email-to-task?",
          body: "Mail sent to this address will stop creating tasks.",
          confirmLabel: "Turn off",
          cancelLabel: "Keep enabled",
        })) ||
        !reading.current()
      )
        return;
      if (!inbox?.address || latest.current?.address !== inbox.address)
        throw new Error("The address changed. Review it and try again.");
      await client.disableInbox();
      reading.commit((previous) =>
        previous ? { ...previous, address: null } : previous,
      );
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
      <p className="muted small">Send from your account email.</p>

      {reading.failed && (
        <p className="connection-recovery" role="alert">
          Couldn't load email-to-task.{" "}
          <button
            className="text-button"
            disabled={reading.loading}
            onClick={() => void reading.reload()}
          >
            Retry address
          </button>
        </p>
      )}
      {inbox === null ? (
        reading.failed ? null : (
          <p className="muted">Loading address…</p>
        )
      ) : !inbox.configured ? (
        <p className="muted">An admin needs to enable inbound mail first.</p>
      ) : inbox.address ? (
        <ul className="settings-list">
          <li>
            <div className="settings-list-main">
              <strong className="selectable">{inbox.address}</strong>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={action.pending || reading.loading || reading.failed}
              onClick={() =>
                void action.run(async () => {
                  if (!reading.current() || !inbox.address) return;
                  await navigator.clipboard.writeText(inbox.address);
                  return "Address copied.";
                })
              }
            >
              Copy
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Email-to-task options"
              aria-haspopup="dialog"
              aria-expanded={!!menu}
              disabled={action.pending || reading.loading || reading.failed}
              onClick={(event) =>
                setMenu(event.currentTarget.getBoundingClientRect())
              }
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          </li>
        </ul>
      ) : (
        <button
          className="secondary"
          disabled={action.pending || reading.loading || reading.failed}
          onClick={rotate}
        >
          Enable
        </button>
      )}
      <details className="connection-details">
        <summary>How email becomes tasks</summary>
        <p className="muted small">
          The subject becomes the title and the body becomes notes. Use your
          account email as the sender.
        </p>
      </details>
      {menu && (
        <Popover
          anchor={menu}
          label="Email-to-task options"
          width={220}
          onClose={() => setMenu(null)}
        >
          <button
            type="button"
            disabled={action.pending || reading.loading || reading.failed}
            onClick={() => {
              setMenu(null);
              rotate();
            }}
          >
            Replace address
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={action.pending || reading.loading || reading.failed}
            onClick={() => {
              setMenu(null);
              disable();
            }}
          >
            Turn off
          </button>
        </Popover>
      )}
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}
