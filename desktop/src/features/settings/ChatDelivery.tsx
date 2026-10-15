import { SettingsSection } from "./SettingsSection";
import { SettingsEditor } from "./SettingsEditor";
import { useSettingsRead } from "./useSettingsRead";
import { Select } from "../../components/Select";
import { Popover } from "../../components/Popover";
import { useConfirm } from "../../components/Confirm";
import { useRef, useState } from "react";
import { MessagesSquare, MoreHorizontal } from "lucide-react";
import type { ChatChannel } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { OutcomeNote, useAction } from "../../components/Outcome";

const LABEL = { slack: "Slack", discord: "Discord" } as const;
type Kind = keyof typeof LABEL;

export function ChatDelivery(props: { report: (e: unknown) => void }) {
  return <ChatDeliveryBody key={session.get()} {...props} />;
}

/** Daily digest delivery; the webhook setup lives in a focused editor. */
function ChatDeliveryBody({ report }: { report: (e: unknown) => void }) {
  const reading = useSettingsRead<ChatChannel>(() => client.getChat(), report);
  const channel = reading.data;
  const [kind, setKind] = useState<Kind>("slack");
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const action = useAction(report);
  const { ask } = useConfirm();
  const latest = useRef({ kind, url, channel });
  latest.current = { kind, url, channel };
  const closing = useRef(false);
  const disabled = action.pending || reading.loading || reading.failed;
  const close = async () => {
    if (action.pending || closing.current || !reading.current()) return;
    closing.current = true;
    const draft = latest.current.url;
    try {
      if (
        draft.trim() &&
        !(await ask({
          title: "Discard setup?",
          body: "Your unsaved webhook URL will be removed.",
          confirmLabel: "Discard setup",
          cancelLabel: "Keep editing",
        }))
      )
        return;
      if (!reading.current() || latest.current.url !== draft) return;
      setUrl("");
      setEditing(false);
    } finally {
      closing.current = false;
    }
  };
  const connect = () => {
    if (disabled || closing.current || !url.trim()) return;
    const target = { kind, raw: url, url: url.trim() };
    void action.run(async () => {
      if (!reading.current()) return;
      const next = await client.setChat(target.kind, target.url);
      if (!reading.current()) return;
      reading.commit(next);
      if (
        latest.current.kind === target.kind &&
        latest.current.url === target.raw
      ) {
        setUrl("");
        setEditing(false);
      }
      return `Connected ${LABEL[target.kind]}.`;
    });
  };
  const test = () => {
    setMenu(null);
    void action.run(async () => {
      if (!reading.current()) return;
      await client.testChat();
      if (reading.current()) return "Test sent.";
    });
  };
  const disconnect = () => {
    setMenu(null);
    const target = channel?.kind;
    if (!target || disabled) return;
    void action.run(async () => {
      if (
        !(await ask({
          title: `Disconnect ${LABEL[target]}?`,
          body: "Your daily digest will no longer be sent to this webhook.",
          confirmLabel: "Disconnect",
          cancelLabel: "Keep connected",
          destructive: true,
        }))
      )
        return;
      if (!reading.current() || latest.current.channel?.kind !== target) return;
      await client.disableChat();
      if (!reading.current()) return;
      reading.commit({ kind: null });
      return "Disconnected.";
    });
  };
  const recovery = reading.failed && (
    <p className="connection-recovery" role="alert">
      Couldn't load chat delivery.{" "}
      <button
        type="button"
        className="text-button"
        disabled={reading.loading || action.pending}
        onClick={() => void reading.reload()}
      >
        Retry
      </button>
    </p>
  );
  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="chat-title"
    >
      <h2 id="chat-title">
        <MessagesSquare size={18} aria-hidden="true" /> Chat delivery
      </h2>
      <div
        data-settings-close-guard={
          action.pending || url.trim()
            ? "Finish or discard chat delivery setup before leaving Settings."
            : undefined
        }
      >
        {!editing && recovery}
        {channel === null ? (
          !reading.failed && (
            <p className="muted" role="status">
              Loading chat delivery…
            </p>
          )
        ) : (
          <ul className="settings-list">
            <li>
              <div className="settings-list-main">
                <strong>
                  {channel.kind ? LABEL[channel.kind] : "Not connected"}
                </strong>
                <small>Daily digest</small>
              </div>
              {channel.kind ? (
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled}
                  aria-label="Chat delivery options"
                  aria-haspopup="dialog"
                  aria-expanded={!!menu}
                  onClick={(event) =>
                    setMenu(event.currentTarget.getBoundingClientRect())
                  }
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled}
                  onClick={() => {
                    action.setOutcome(null);
                    setEditing(true);
                  }}
                >
                  Connect
                </button>
              )}
            </li>
          </ul>
        )}
        {!editing && <OutcomeNote outcome={action.outcome} />}
        {action.pending && !editing && (
          <p className="muted small" role="status">
            Updating chat delivery…
          </p>
        )}
      </div>
      {menu && (
        <Popover
          anchor={menu}
          label="Chat delivery options"
          width={220}
          onClose={() => setMenu(null)}
        >
          <button type="button" disabled={disabled} onClick={test}>
            Send test
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={disabled}
            onClick={disconnect}
          >
            Disconnect
          </button>
        </Popover>
      )}
      {editing && (
        <SettingsEditor
          title="Connect chat delivery"
          pending={action.pending}
          onClose={() => void close()}
        >
          {recovery}
          <p className="muted small">
            Your daily digest will be sent to this webhook.
          </p>
          <form
            className="settings-grid"
            onSubmit={(event) => {
              event.preventDefault();
              connect();
            }}
          >
            <label className="settings-field">
              <span className="settings-label">Service</span>
              <Select
                disabled={disabled}
                value={kind}
                onChange={(event) => setKind(event.target.value as Kind)}
              >
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
              </Select>
            </label>
            <label className="settings-field wide">
              <span className="settings-label">Webhook URL</span>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                autoFocus
                disabled={disabled}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…"
              />
            </label>
            <OutcomeNote outcome={action.outcome} />
            <div className="portability-actions">
              <button
                type="submit"
                className="primary"
                disabled={disabled || !url.trim()}
              >
                {action.pending ? "Connecting…" : "Connect"}
              </button>
            </div>
          </form>
        </SettingsEditor>
      )}
    </SettingsSection>
  );
}
