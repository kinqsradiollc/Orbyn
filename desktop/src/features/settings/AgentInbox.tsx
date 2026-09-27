import { useEffect, useState, type FormEvent } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import {
  AGENT_INBOX_KINDS,
  AGENT_INBOX_KIND_LABELS,
  AGENT_WAKE_MINUTES,
  MAX_AGENT_RULES,
  type AgentGrant,
  type AgentInboxKind,
  type AgentInboxSettings,
  type AgentRule,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { copyText } from "../../lib/planning";
import { timeAgo } from "../../lib/tasks";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Select } from "../../components/Select";

/**
 * Connected agents → "What it hears" (H0): which kinds of things go to this
 * agent, and the address that wakes it when something happens (for agents
 * that run on a schedule). The wake-up carries only a count and a link.
 */
export function InboxEdit({
  grant,
  report,
  onClose,
}: {
  grant: AgentGrant;
  report: (e: unknown) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<AgentInboxSettings | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const action = useAction(report);

  useEffect(() => {
    client.agentInbox(grant.id).then(
      (s) => {
        setSettings(s);
        setUrl(s.wake_url ?? "");
      },
      (e) => {
        report(e);
        onClose();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant.id]);

  const toggle = (kind: AgentInboxKind, on: boolean) => {
    if (!settings) return;
    const muted = on
      ? settings.muted.filter((k) => k !== kind)
      : [...settings.muted, kind];
    setSettings({ ...settings, muted });
    void action.run(async () => {
      setSettings(await client.setAgentInboxMutes(grant.id, muted));
    });
  };

  const saveWake = (e: FormEvent) => {
    e.preventDefault();
    const next = url.trim();
    if (!next) return;
    void action.run(async () => {
      const made = await client.setAgentWake(grant.id, next);
      setSettings(made.settings);
      setSecret(made.secret);
      setCopied(false);
      return "Saved. Orbyn calls this address when something new is waiting.";
    });
  };

  const testWake = () =>
    void action.run(async () => {
      const r = await client.testAgentWake(grant.id);
      setSettings(await client.agentInbox(grant.id));
      if (!r.ok) throw new Error(r.error ?? "The address didn’t answer.");
      return `The address answered ${r.status}.`;
    });

  const removeWake = () =>
    void action.run(async () => {
      setSettings(await client.clearAgentWake(grant.id));
      setUrl("");
      setSecret(null);
      return "It won’t be woken any more.";
    });

  if (!settings)
    return (
      <div className="agents-tools-edit">
        <p className="muted">Loading…</p>
      </div>
    );
  return (
    <div className="agents-tools-edit agents-trust agents-inbox">
      <p className="muted">
        What happens in Orbyn goes to this agent first, only from the spaces it
        reaches.{" "}
        {settings.unread
          ? `${settings.unread} ${settings.unread === 1 ? "thing waits" : "things wait"} for it now.`
          : "Nothing waits for it now."}
      </p>
      <fieldset className="agents-trust-list">
        <legend>Send to this agent</legend>
        {AGENT_INBOX_KINDS.map((k) => {
          const on = !settings.muted.includes(k);
          return (
            <label
              key={k}
              className="switch-line"
              htmlFor={`inbox-${grant.id}-${k}`}
            >
              <input
                id={`inbox-${grant.id}-${k}`}
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={on}
                disabled={action.pending}
                onChange={(e) => toggle(k, e.target.checked)}
              />
              <span>
                {AGENT_INBOX_KIND_LABELS[k].name}
                <small>{AGENT_INBOX_KIND_LABELS[k].blurb}</small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <form className="agents-wake" onSubmit={saveWake}>
        <div className="settings-field">
          <label htmlFor={`wake-${grant.id}`}>
            Wake this agent when something happens
          </label>
          <div className="agents-wake-row">
            <input
              id={`wake-${grant.id}`}
              type="url"
              inputMode="url"
              placeholder="https://"
              maxLength={500}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              className="primary"
              disabled={action.pending || !url.trim()}
            >
              Save
            </button>
          </div>
          <small className="muted">
            For agents that run on a schedule. Orbyn sends a signed call with
            how many things wait and where to read them, never what they say, at
            most every {AGENT_WAKE_MINUTES} minutes.
          </small>
        </div>
        {secret && (
          <div className="secret-box" role="status">
            <strong>Signing secret</strong>
            <div className="secret-row">
              <code>{secret}</code>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void copyText(secret).then((ok) => setCopied(ok))
                }
              >
                <Copy size={13} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <small>
              Check the X-Orbyn-Signature header with it. Copy it now: it won’t
              be shown again.
            </small>
          </div>
        )}
        {settings.wake_url && (
          <div className="agents-wake-status">
            <span className="muted">
              {settings.wake_last_sent_at
                ? `Last woken ${timeAgo(settings.wake_last_sent_at)}`
                : "Not woken yet"}
              {settings.wake_last_error
                ? ` · ${settings.wake_last_error}`
                : settings.wake_last_status
                  ? ` · answered ${settings.wake_last_status}`
                  : ""}
            </span>
            <button
              type="button"
              className="link-button"
              disabled={action.pending}
              onClick={testWake}
            >
              Test
            </button>
            <button
              type="button"
              className="danger-text"
              disabled={action.pending}
              onClick={removeWake}
            >
              Remove
            </button>
          </div>
        )}
      </form>
      <OutcomeNote outcome={action.outcome} />
      <div className="agents-tools-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** "Everything" or one kind, for a rule. */
const ruleKindText = (k: AgentInboxKind | null) =>
  k ? AGENT_INBOX_KIND_LABELS[k].name : "Everything";

/**
 * Standing rules for all of the person's agents, in plain words ("Always
 * accept bookings from my team"), for everything or one kind of thing.
 * Agents get them with each item in their inbox.
 */
export function AgentRules({ report }: { report: (e: unknown) => void }) {
  const { ask } = useConfirm();
  const [rules, setRules] = useState<AgentRule[] | null>(null);
  const [kind, setKind] = useState<AgentInboxKind | "">("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    kind: AgentInboxKind | "";
    text: string;
  } | null>(null);
  const action = useAction(report);

  const load = () =>
    client.agentRules().then(setRules, (e) => {
      setRules([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void action.run(async () => {
      await client.addAgentRule({ kind: kind || null, text: text.trim() });
      setText("");
      await load();
    });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.text.trim()) return;
    const d = editing;
    void action.run(async () => {
      await client.updateAgentRule(d.id, {
        kind: d.kind || null,
        text: d.text.trim(),
      });
      setEditing(null);
      await load();
    });
  };

  const remove = async (r: AgentRule) => {
    if (
      !(await ask({
        title: `Remove “${r.text}”?`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.deleteAgentRule(r.id);
      await load();
    });
  };

  const kindSelect = (
    id: string,
    value: AgentInboxKind | "",
    onChange: (v: AgentInboxKind | "") => void,
  ) => (
    <Select
      id={id}
      value={value}
      aria-label="Applies to"
      onChange={(e) => onChange(e.target.value as AgentInboxKind | "")}
    >
      <option value="">Everything</option>
      {AGENT_INBOX_KINDS.map((k) => (
        <option key={k} value={k}>
          {AGENT_INBOX_KIND_LABELS[k].name}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="agents-rules">
      <h3>Standing rules</h3>
      <p className="muted">
        Plain rules every agent follows when something reaches it, like “Always
        accept bookings from my team”.
      </p>
      {rules === null ? (
        <p className="muted">Loading…</p>
      ) : rules.length ? (
        <ul className="agents-rules-list">
          {rules.map((r) =>
            editing?.id === r.id ? (
              <li key={r.id}>
                <form className="agents-rule-form" onSubmit={save}>
                  {kindSelect(`rule-kind-${r.id}`, editing.kind, (v) =>
                    setEditing({ ...editing, kind: v }),
                  )}
                  <input
                    aria-label="Rule"
                    maxLength={500}
                    value={editing.text}
                    onChange={(e) =>
                      setEditing({ ...editing, text: e.target.value })
                    }
                  />
                  <button className="primary" disabled={action.pending}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </form>
              </li>
            ) : (
              <li key={r.id}>
                <span className="agents-tag">{ruleKindText(r.kind)}</span>
                <span className="agents-rule-text">{r.text}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Change “${r.text}”`}
                  title="Change"
                  onClick={() =>
                    setEditing({ id: r.id, kind: r.kind ?? "", text: r.text })
                  }
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove “${r.text}”`}
                  title="Remove"
                  disabled={action.pending}
                  onClick={() => void remove(r)}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="muted">No rules yet.</p>
      )}
      {rules && rules.length < MAX_AGENT_RULES && (
        <form className="agents-rule-form" onSubmit={add}>
          {kindSelect("rule-kind-new", kind, setKind)}
          <input
            aria-label="New rule"
            placeholder="Always accept bookings from my team"
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="primary" disabled={action.pending || !text.trim()}>
            Add rule
          </button>
        </form>
      )}
      <OutcomeNote outcome={action.outcome} />
    </div>
  );
}
