import { useEffect, useState, type FormEvent } from "react";
import {
  Copy,
  KeyRound,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import {
  WEBHOOK_EVENTS,
  type ApiKey,
  type Webhook,
  type WebhookEvent,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { timeAgo } from "../../lib/tasks";
import { copyText } from "../../lib/planning";
import { CalendarFeedCard, CalendarSubscriptions } from "./CalendarSettings";

type Props = { report: (e: unknown) => void };

/** Labels for the events we know; newer ones show their name. */
const EVENT_LABELS: Partial<Record<WebhookEvent, string>> = {
  "item.created": "Item created",
  "item.updated": "Item updated",
  "item.completed": "Item completed",
  "item.deleted": "Item deleted",
  "block.scheduled": "Time scheduled",
  "booking.requested": "Booking requested",
  "booking.confirmed": "Booking confirmed",
  "booking.rescheduled": "Booking moved",
  "booking.cancelled": "Booking cancelled",
  "event.starting": "Event starting soon",
  "block.started": "Time block started",
  "task.at_risk": "Task at risk",
};

/** A secret shown once, with a copy button. */
function OnceSecret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-box" role="status">
      <strong>{label}</strong>
      <div className="secret-row">
        <code>{value}</code>
        <button
          type="button"
          className="secondary"
          onClick={() => void copyText(value).then(setCopied)}
        >
          <Copy size={13} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <small>Copy it now. For your safety it won&apos;t be shown again.</small>
    </div>
  );
}

/**
 * API keys, webhooks, the calendar feed and subscribed calendars: how other
 * tools work with Orbyn.
 * Everything is served from this server; nothing is sent anywhere else
 * unless you add a webhook.
 */
export function ConnectionsSettings({ report }: Props) {
  return (
    <>
      <section className="card settings-card">
        <h2>
          <ShieldCheck size={16} aria-hidden="true" /> Connections
        </h2>
        <p className="muted">
          Connect scripts, automation tools and other calendar apps. Your data
          stays on this server: keys and links only let those tools reach it
          here, and webhooks send only the events you pick to the address you
          give.
        </p>
      </section>
      <ApiKeys report={report} />
      <Webhooks report={report} />
      <CalendarFeedCard report={report} />
      <CalendarSubscriptions report={report} />
    </>
  );
}

function ApiKeys({ report }: Props) {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const action = useAction(report);
  const load = () =>
    client.listApiKeys().then(setKeys, (e) => {
      setKeys([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const key = await client.createApiKey(name.trim());
      setFresh(key.key);
      setName("");
      await load();
    });
  };
  const remove = (k: ApiKey) => {
    if (!window.confirm(`Delete “${k.name}”? Anything using it stops working.`))
      return;
    void action.run(async () => {
      await client.deleteApiKey(k.id);
      await load();
      return `Deleted “${k.name}”.`;
    });
  };

  return (
    <section className="card settings-card" aria-labelledby="keys-title">
      <h2 id="keys-title">
        <KeyRound size={16} aria-hidden="true" /> Personal API keys
      </h2>
      <p className="muted">
        A key acts as you. Send it as <code>Authorization: Bearer …</code> to
        this server&apos;s API.
      </p>
      {fresh && <OnceSecret label="Your new API key" value={fresh} />}
      {keys === null ? (
        <p className="muted">Loading keys…</p>
      ) : keys.length ? (
        <ul className="settings-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span className="settings-list-main">
                <strong>{k.name}</strong>
                <small>
                  <code>{k.prefix}…</code> · created {timeAgo(k.created_at)} ·{" "}
                  {k.last_used_at
                    ? `last used ${timeAgo(k.last_used_at)}`
                    : "never used"}
                </small>
              </span>
              <button
                className="danger-text"
                disabled={action.pending}
                onClick={() => remove(k)}
              >
                <Trash2 size={13} /> Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No keys yet.</p>
      )}
      <form className="inline-form settings-subform" onSubmit={create}>
        <input
          aria-label="Key name"
          placeholder="What it's for, like “Zapier”"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" disabled={action.pending || !name.trim()}>
          <Plus size={14} /> Create key
        </button>
      </form>
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}

function Webhooks({ report }: Props) {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["item.created"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const action = useAction(report);
  const load = () =>
    client.listWebhooks().then(setHooks, (e) => {
      setHooks([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!events.length) {
      action.setOutcome({ ok: false, text: "Pick at least one event." });
      return;
    }
    void action.run(async () => {
      const hook = await client.createWebhook({ url: url.trim(), events });
      setSecret(hook.secret);
      setUrl("");
      await load();
    });
  };
  const setActive = (h: Webhook, active: boolean) =>
    void action.run(async () => {
      await client.updateWebhook(h.id, { active });
      await load();
    });
  const test = (h: Webhook) =>
    void action.run(async () => {
      const r = await client.testWebhook(h.id);
      setTests((t) => ({
        ...t,
        [h.id]: r.ok
          ? `Delivered (${r.status}).`
          : `Didn't go through${r.status ? ` (${r.status})` : ""}: ${r.error ?? "no answer"}.`,
      }));
      await load();
    });
  const remove = (h: Webhook) => {
    if (!window.confirm(`Delete the webhook to ${h.url}?`)) return;
    void action.run(async () => {
      await client.deleteWebhook(h.id);
      await load();
      return "Webhook deleted.";
    });
  };

  return (
    <section className="card settings-card" aria-labelledby="hooks-title">
      <h2 id="hooks-title">
        <WebhookIcon size={16} aria-hidden="true" /> Webhooks
      </h2>
      <p className="muted">
        Orbyn posts a signed message to your address when something happens.
        Check the signature with the signing secret.
      </p>
      {secret && <OnceSecret label="Signing secret" value={secret} />}
      {hooks === null ? (
        <p className="muted">Loading webhooks…</p>
      ) : hooks.length ? (
        <ul className="settings-list hook-list">
          {hooks.map((h) => (
            <li key={h.id}>
              <span className="settings-list-main">
                <strong className="hook-url">{h.url}</strong>
                <small>
                  {h.events.map((e) => EVENT_LABELS[e] ?? e).join(", ")}
                </small>
                <small>
                  {h.last_status !== null
                    ? `Last answer ${h.last_status}`
                    : "Nothing sent yet"}
                  {h.last_delivered_at &&
                    ` · delivered ${timeAgo(h.last_delivered_at)}`}
                  {h.last_error && (
                    <span className="hook-error"> · {h.last_error}</span>
                  )}
                </small>
                {tests[h.id] && (
                  <small className="hook-test" role="status">
                    Test: {tests[h.id]}
                  </small>
                )}
              </span>
              <label className="hook-active">
                <span className="sr-only">Send to {h.url}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="ai-switch"
                  checked={h.active}
                  disabled={action.pending}
                  onChange={(e) => setActive(h, e.target.checked)}
                />
              </label>
              <button
                className="link-button"
                disabled={action.pending}
                onClick={() => test(h)}
              >
                <Send size={12} /> Send test
              </button>
              <button
                className="danger-text"
                disabled={action.pending}
                onClick={() => remove(h)}
              >
                <Trash2 size={13} /> Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No webhooks yet.</p>
      )}
      <form className="settings-subform" onSubmit={create}>
        <div className="settings-field">
          <label htmlFor="hook-url">Address</label>
          <input
            id="hook-url"
            type="url"
            required
            maxLength={500}
            placeholder="https://hooks.example.com/orbyn"
            pattern="https?://\S+"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <fieldset className="check-group">
          <legend>Events</legend>
          <div className="check-grid">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="check-line">
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={() =>
                    setEvents((xs) =>
                      xs.includes(ev)
                        ? xs.filter((x) => x !== ev)
                        : [...xs, ev],
                    )
                  }
                />
                {EVENT_LABELS[ev] ?? ev}
              </label>
            ))}
          </div>
        </fieldset>
        <button className="primary" disabled={action.pending || !url.trim()}>
          <Plus size={14} /> Add webhook
        </button>
      </form>
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}
