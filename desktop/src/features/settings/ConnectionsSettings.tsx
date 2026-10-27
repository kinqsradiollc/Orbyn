import { SettingsSection } from "./SettingsSection";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { session } from "../../lib/session";
import { apiBase, client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { PortabilitySettings } from "./PortabilitySettings";
import { EmailToTask } from "./EmailToTask";
import { AgentChannels } from "./AgentChannels";
import { ConnectedAgents } from "./ConnectedAgents";
import { ChatDelivery } from "./ChatDelivery";
import { CalDavNote } from "./CalDavNote";
import { timeAgo } from "../tasks/tasks";
import { copyText } from "../planner/planning";
import { CalendarFeedCard, CalendarSubscriptions } from "./CalendarSettings";
import { useSettingsRead } from "./useSettingsRead";
import "./settings-w3.css";

type Props = { report: (e: unknown) => void };

/** Labels for the events we know; newer ones show their name. */
const EVENT_LABELS: Partial<Record<WebhookEvent, string>> = {
  "item.created": "Item created",
  "item.updated": "Item updated",
  "item.completed": "Item completed",
  "item.deleted": "Item deleted",
  "block.scheduled": "Session planned",
  "block.updated": "Session moved",
  "block.deleted": "Session removed",
  "booking.requested": "Booking requested",
  "booking.confirmed": "Booking confirmed",
  "booking.rescheduled": "Booking moved",
  "booking.cancelled": "Booking cancelled",
  "event.starting": "Event starting soon",
  "block.started": "Session started",
  "task.at_risk": "Task at risk",
};

/** A secret shown once, with a copy button. */
function OnceSecret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copying, setCopying] = useState(false);
  const lock = useRef<object | null>(null);
  const alive = useRef(true);
  const shown = useRef(value);
  shown.current = value;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setCopied(false);
    setCopyError("");
    setCopying(false);
  }, [value]);
  const copy = async () => {
    if (lock.current) return;
    const ticket = {};
    lock.current = ticket;
    setCopying(true);
    setCopyError("");
    const ok = await copyText(value);
    if (lock.current !== ticket) return;
    lock.current = null;
    if (!alive.current || shown.current !== value) return;
    setCopying(false);
    setCopied(ok);
    if (!ok) setCopyError("Couldn't copy. Select the key to copy it.");
  };
  return (
    <div className="secret-box" role="status">
      <strong>{label}</strong>
      <div className="secret-row">
        <code>{value}</code>
        <button
          type="button"
          className="secondary"
          disabled={copying}
          onClick={() => void copy()}
        >
          <Copy size={13} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <small>Copy now. This key is shown only once.</small>
      {copyError && <small role="alert">{copyError}</small>}
    </div>
  );
}

/**
 * API keys, webhooks, the calendar feed and subscribed calendars: how other
 * tools work with Orbyn. Nothing here sends data anywhere until the person
 * connects it (a webhook, chat delivery or a feed link).
 */
export function ConnectionsSettings({ report }: Props) {
  return (
    <>
      <SettingsSection className="card settings-card">
        <h2>
          <ShieldCheck size={16} aria-hidden="true" /> Connections
        </h2>
        <p className="muted">Tools, calendars and account access.</p>
        <details className="connection-details">
          <summary>Developer reference</summary>
          <p className="muted">
            <a
              href={`${apiBase}/openapi.yaml`}
              target="_blank"
              rel="noopener noreferrer"
            >
              API reference
            </a>{" "}
            (OpenAPI).
          </p>
        </details>
      </SettingsSection>
      <AgentChannels />
      <ConnectedAgents report={report} />
      <ApiKeys key={session.get()} report={report} />
      <Webhooks key={session.get()} report={report} />
      <CalendarFeedCard report={report} />
      <CalendarSubscriptions report={report} />
      <EmailToTask report={report} />
      <ChatDelivery report={report} />
      <CalDavNote />
      <PortabilitySettings key={session.get()} report={report} />
    </>
  );
}

function ApiKeys({ report }: Props) {
  const { ask } = useConfirm();
  const reading = useSettingsRead(() => client.listApiKeys(), report);
  const keys = reading.data;
  const [query, setQuery] = useState("");
  const visibleKeys = keys?.filter((key) =>
    key.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const action = useAction(report);
  const load = reading.reload;

  const create = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const key = await client.createApiKey(name.trim());
      if (!reading.current()) return;
      setFresh(key.key);
      setName("");
      await load();
    });
  };
  const remove = (key: ApiKey) =>
    void action.run(async () => {
      if (
        !(await ask({
          title: "Delete API key?",
          body: `${key.name}\nAnything using this key stops working.`,
          confirmLabel: "Delete",
          destructive: true,
        })) ||
        !reading.current()
      )
        return;
      await client.deleteApiKey(key.id);
      await load();
      return "API key deleted.";
    });

  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="keys-title"
    >
      <h2 id="keys-title">
        <KeyRound size={16} aria-hidden="true" /> Personal API keys
      </h2>
      <p className="muted">
        Keys grant access to your tasks, pages and calendar.
      </p>
      {fresh && <OnceSecret label="Your new API key" value={fresh} />}
      <details className="connection-details">
        <summary>Key permissions</summary>
        <p className="muted">
          Keys cannot manage sign-in, settings, other keys or webhooks. Send
          them as <code>Authorization: Bearer …</code>.
        </p>
      </details>
      {keys && keys.length > 0 && (
        <input
          type="search"
          aria-label="Search API keys"
          placeholder="Search keys"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {reading.failed && (
        <p role="alert" className="connection-recovery">
          Couldn't load keys.{" "}
          <button
            type="button"
            className="text-button"
            disabled={reading.loading}
            onClick={() => void load()}
          >
            Retry keys
          </button>
        </p>
      )}
      {keys === null ? (
        reading.failed ? null : (
          <p className="muted">Loading keys…</p>
        )
      ) : keys.length ? (
        <ul className="settings-list connection-collection">
          {visibleKeys?.map((k) => (
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
      {keys?.length && visibleKeys?.length === 0 ? (
        <p className="muted">No matching keys.</p>
      ) : null}
      <details className="connection-details">
        <summary>Create key</summary>
        <form className="inline-form settings-subform" onSubmit={create}>
          <input
            aria-label="Key name"
            disabled={action.pending}
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
      </details>
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}

function Webhooks({ report }: Props) {
  const { ask } = useConfirm();
  const reading = useSettingsRead(() => client.listWebhooks(), report);
  const hooks = reading.data;
  const [query, setQuery] = useState("");
  const visibleHooks = hooks?.filter((hook) =>
    hook.url.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["item.created"]);
  /** Minutes before an event that "event starting soon" is sent. */
  const [lead, setLead] = useState("15");
  const [secret, setSecret] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const action = useAction(report);
  const load = reading.reload;

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!events.length) {
      action.setOutcome({ ok: false, text: "Pick at least one event." });
      return;
    }
    if (
      events.includes("event.starting") &&
      (!lead.trim() ||
        !Number.isInteger(Number(lead)) ||
        Number(lead) < 0 ||
        Number(lead) > 120)
    ) {
      action.setOutcome({
        ok: false,
        text: "Enter 0–120 minutes before the event.",
      });
      return;
    }
    void action.run(async () => {
      const hook = await client.createWebhook({
        url: url.trim(),
        events,
        ...(events.includes("event.starting")
          ? { lead_minutes: Number(lead) }
          : {}),
      });
      if (!reading.current()) return;
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
  const setLeadFor = (h: Webhook, minutes: number) =>
    void action.run(async () => {
      await client.updateWebhook(h.id, { lead_minutes: minutes });
      await load();
      return "Saved.";
    });
  const test = (h: Webhook) =>
    void action.run(async () => {
      const r = await client.testWebhook(h.id);
      if (!reading.current()) return;
      setTests((t) => ({
        ...t,
        [h.id]: r.ok
          ? `Delivered (${r.status}).`
          : `Didn't go through${r.status ? ` (${r.status})` : ""}: ${r.error ?? "no answer"}.`,
      }));
      await load();
    });
  const remove = (hook: Webhook) =>
    void action.run(async () => {
      if (
        !(await ask({
          title: "Delete webhook?",
          body: `${hook.url}\nEvent delivery to this address stops.`,
          confirmLabel: "Delete",
          destructive: true,
        })) ||
        !reading.current()
      )
        return;
      await client.deleteWebhook(hook.id);
      await load();
      return "Webhook deleted.";
    });

  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="hooks-title"
    >
      <h2 id="hooks-title">
        <WebhookIcon size={16} aria-hidden="true" /> Webhooks
      </h2>
      <p className="muted">
        Send selected events to your address, signed with your secret.
      </p>
      {secret && <OnceSecret label="Signing secret" value={secret} />}
      {hooks && hooks.length > 0 && (
        <input
          type="search"
          aria-label="Search webhooks"
          placeholder="Search webhooks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {reading.failed && (
        <p role="alert" className="connection-recovery">
          Couldn't load webhooks.{" "}
          <button
            type="button"
            className="text-button"
            disabled={reading.loading}
            onClick={() => void load()}
          >
            Retry webhooks
          </button>
        </p>
      )}
      {hooks === null ? (
        reading.failed ? null : (
          <p className="muted">Loading webhooks…</p>
        )
      ) : hooks.length ? (
        <ul className="settings-list hook-list connection-collection">
          {visibleHooks?.map((h) => (
            <li key={h.id}>
              <details className="connection-details settings-list-main">
                <summary>
                  <strong className="hook-url">{h.url}</strong>
                  <small>
                    {h.active ? "On" : "Off"} · {h.events.length} events
                  </small>
                </summary>
                <div className="connection-details-body">
                  <small>
                    {h.events.map((e) => EVENT_LABELS[e] ?? e).join(", ")}
                    {h.events.includes("event.starting") &&
                      ` · starts ${h.lead_minutes ?? 15} min before`}
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
                  {h.events.includes("event.starting") && (
                    <WebhookLead
                      key={`${h.id}:${h.lead_minutes}`}
                      hook={h}
                      pending={action.pending}
                      onSave={(minutes) => setLeadFor(h, minutes)}
                    />
                  )}
                  <label className="hook-active">
                    <span>Delivery</span>
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
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No webhooks yet.</p>
      )}
      {hooks?.length && visibleHooks?.length === 0 ? (
        <p className="muted">No matching webhooks.</p>
      ) : null}
      <details className="connection-details">
        <summary>Add webhook</summary>
        <form className="settings-subform" onSubmit={create}>
          <div className="settings-field">
            <label htmlFor="hook-url">Address</label>
            <input
              id="hook-url"
              disabled={action.pending}
              type="url"
              required
              maxLength={500}
              placeholder="https://hooks.example.com/orbyn"
              pattern="https?://\S+"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <fieldset className="check-group" disabled={action.pending}>
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
          {events.includes("event.starting") && (
            <div className="settings-field">
              <label htmlFor="hook-lead">
                “Event starting soon”: minutes before
              </label>
              <input
                id="hook-lead"
                disabled={action.pending}
                type="number"
                min={0}
                max={120}
                value={lead}
                required
                step={1}
                onChange={(e) => setLead(e.target.value)}
              />
            </div>
          )}
          <button className="primary" disabled={action.pending || !url.trim()}>
            <Plus size={14} /> Add webhook
          </button>
        </form>
      </details>
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}

function WebhookLead({
  hook,
  pending,
  onSave,
}: {
  hook: Webhook;
  pending: boolean;
  onSave: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState(String(hook.lead_minutes ?? 15));
  const minutes = Number(draft);
  const valid =
    draft.trim() !== "" &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= 120;
  return (
    <div className="hook-lead">
      <label>
        Minutes before an event{" "}
        <input
          type="number"
          min={0}
          max={120}
          step={1}
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary"
        disabled={pending || !valid || minutes === (hook.lead_minutes ?? 15)}
        onClick={() => onSave(minutes)}
      >
        Save timing
      </button>
      {!valid && <span role="alert">Enter 0–120 minutes.</span>}
    </div>
  );
}
