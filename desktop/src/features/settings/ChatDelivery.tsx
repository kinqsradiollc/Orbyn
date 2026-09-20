import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import type { ChatChannel } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";

const LABEL = { slack: "Slack", discord: "Discord" } as const;

/** Send reminders and the daily digest to a Slack or Discord webhook. */
export function ChatDelivery({ report }: { report: (e: unknown) => void }) {
  const [channel, setChannel] = useState<ChatChannel | null>(null);
  const [kind, setKind] = useState<"slack" | "discord">("slack");
  const [url, setUrl] = useState("");
  const action = useAction(report);

  useEffect(() => {
    client.getChat().then(setChannel, () => setChannel({ kind: null }));
  }, []);

  const connect = () =>
    void action.run(async () => {
      const next = await client.setChat(kind, url.trim());
      setChannel(next);
      setUrl("");
      return `Connected ${LABEL[kind]}.`;
    });
  const test = () =>
    void action.run(async () => {
      await client.testChat();
      return "Sent a test message.";
    });
  const disconnect = () =>
    void action.run(async () => {
      await client.disableChat();
      setChannel({ kind: null });
      return "Disconnected.";
    });

  return (
    <section className="card settings-card" aria-labelledby="chat-title">
      <h2 id="chat-title">
        <MessagesSquare size={18} aria-hidden="true" /> Chat delivery
      </h2>
      <p className="muted">
        Get your daily digest in Slack or Discord. Paste an incoming-webhook URL
        from your workspace or server.
      </p>

      {channel === null ? (
        <p className="muted">Loading…</p>
      ) : channel.kind ? (
        <div className="portability-actions">
          <span className="status-pill active">
            {LABEL[channel.kind]} connected
          </span>
          <button
            className="secondary"
            disabled={action.pending}
            onClick={test}
          >
            Send a test
          </button>
          <button
            className="text-button"
            disabled={action.pending}
            onClick={disconnect}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="settings-grid">
          <label className="settings-field">
            <span className="settings-label">Service</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "slack" | "discord")}
            >
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
            </select>
          </label>
          <label className="settings-field wide">
            <span className="settings-label">Webhook URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                kind === "slack"
                  ? "https://hooks.slack.com/services/…"
                  : "https://discord.com/api/webhooks/…"
              }
            />
          </label>
          <div className="portability-actions">
            <button
              className="secondary"
              disabled={action.pending || !url.trim()}
              onClick={connect}
            >
              Connect
            </button>
          </div>
        </div>
      )}
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}
