import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
import { SettingsEditor } from "./SettingsEditor";

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
  const [pending, setPending] = useState(false);
  const [secretUnsaved, setSecretUnsaved] = useState(false);
  const close = () => {
    if (!pending && !secretUnsaved) onClose();
  };
  return (
    <SettingsEditor
      title={`Inbox · ${grant.client_name || grant.name}`}
      pending={pending}
      closeDisabled={secretUnsaved}
      onClose={close}
    >
      <InboxBody
        key={grant.id}
        grant={grant}
        report={report}
        onClose={close}
        onPendingChange={setPending}
        onSecretUnsaved={setSecretUnsaved}
      />
    </SettingsEditor>
  );
}

function InboxBody({
  grant,
  report,
  onClose,
  onPendingChange,
  onSecretUnsaved,
}: {
  grant: AgentGrant;
  report: (e: unknown) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  onSecretUnsaved: (unsaved: boolean) => void;
}) {
  const [settings, setSettings] = useState<AgentInboxSettings | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedSecret, setSavedSecret] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const reportRef = useRef(report);
  reportRef.current = report;
  const action = useAction(report);
  useEffect(() => {
    onPendingChange(action.pending);
    return () => onPendingChange(false);
  }, [action.pending, onPendingChange]);
  useEffect(() => {
    onSecretUnsaved(!!secret && !savedSecret);
    return () => onSecretUnsaved(false);
  }, [secret, savedSecret, onSecretUnsaved]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setLoading(true);
    client
      .agentInbox(grant.id)
      .then(
        (s) => {
          if (!live) return;
          setSettings(s);
          setUrl(s.wake_url ?? "");
        },
        (e) => {
          if (live) {
            setFailed(true);
            reportRef.current(e);
          }
        },
      )
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [grant.id, retry]);

  const toggle = (kind: AgentInboxKind, on: boolean) => {
    if (!settings || loading || failed || action.pending) return;
    const muted = on
      ? settings.muted.filter((k) => k !== kind)
      : [...settings.muted, kind];
    void action.run(async () => {
      const previous = settings;
      setSettings({ ...settings, muted });
      try {
        const next = await client.setAgentInboxMutes(grant.id, muted);
        if (mounted.current) setSettings(next);
      } catch (error) {
        if (mounted.current) setSettings(previous);
        throw error;
      }
    });
  };

  const saveWake = (e: FormEvent) => {
    e.preventDefault();
    const next = url.trim();
    if (!next || loading || failed || action.pending) return;
    void action.run(async () => {
      const made = await client.setAgentWake(grant.id, next);
      if (!mounted.current) return;
      setSettings(made.settings);
      setSecret(made.secret);
      setCopied(false);
      setSavedSecret(false);
      return "Wake address saved.";
    });
  };

  const testWake = () =>
    !loading &&
    !failed &&
    void action.run(async () => {
      const r = await client.testAgentWake(grant.id);
      if (!r.ok) throw new Error(r.error ?? "The address didn’t answer.");
      try {
        const next = await client.agentInbox(grant.id);
        if (mounted.current) setSettings(next);
      } catch {
        if (mounted.current) setFailed(true);
      }
      return `The address answered ${r.status}.`;
    });

  const removeWake = () =>
    !loading &&
    !failed &&
    void action.run(async () => {
      const next = await client.clearAgentWake(grant.id);
      if (!mounted.current) return;
      setSettings(next);
      setUrl("");
      setSecret(null);
      return "Wake address removed.";
    });

  if (!settings)
    return (
      <div className="agents-tools-edit">
        {failed ? (
          <>
            <p className="error" role="alert">
              Couldn't load agent inbox.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </>
        ) : (
          <p className="muted" role="status">
            Loading…
          </p>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  return (
    <div className="agents-tools-edit agents-trust agents-inbox">
      <p className="muted">
        From this agent's allowed spaces ·{" "}
        {settings.unread
          ? `${settings.unread} ${settings.unread === 1 ? "thing waits" : "things wait"} for it now.`
          : "Inbox empty."}
      </p>
      {loading && settings && (
        <p className="muted" role="status">
          Refreshing inbox…
        </p>
      )}
      {failed && (
        <div>
          <p role="alert">Couldn't refresh inbox status.</p>
          <button
            type="button"
            className="secondary"
            disabled={action.pending || loading}
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <fieldset
        className="agents-trust-list"
        disabled={action.pending || loading || failed}
      >
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
                disabled={action.pending || loading || failed}
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
          <label htmlFor={`wake-${grant.id}`}>Wake URL</label>
          <div className="agents-wake-row">
            <input
              id={`wake-${grant.id}`}
              type="url"
              inputMode="url"
              placeholder="https://"
              maxLength={500}
              value={url}
              disabled={action.pending || loading || failed}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              className="primary"
              disabled={action.pending || loading || failed || !url.trim()}
            >
              Save
            </button>
          </div>
          <small className="muted">
            Scheduled agents get a signed count and link, never item contents,
            at most every {AGENT_WAKE_MINUTES} minutes.
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
                  void copyText(secret).then((ok) => {
                    if (!mounted.current) return;
                    setCopied(ok);
                    if (!ok)
                      action.setOutcome({
                        ok: false,
                        text: "Couldn't copy. Select and copy the secret manually.",
                      });
                  })
                }
              >
                <Copy size={13} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <small>
              Check the X-Orbyn-Signature header with it. Copy it now: it won’t
              be shown again.
            </small>
            {!savedSecret && (
              <button
                type="button"
                className="secondary"
                onClick={() => setSavedSecret(true)}
              >
                I've saved the secret
              </button>
            )}
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
              disabled={action.pending || loading || failed}
              onClick={testWake}
            >
              Test
            </button>
            <button
              type="button"
              className="danger-text"
              disabled={action.pending || loading || failed}
              onClick={removeWake}
            >
              Remove
            </button>
          </div>
        )}
      </form>
      <OutcomeNote outcome={action.outcome} />
      <div className="agents-tools-actions">
        <button
          type="button"
          className="secondary"
          disabled={action.pending || (!!secret && !savedSecret)}
          onClick={onClose}
        >
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
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false);
  const request = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  const [kind, setKind] = useState<AgentInboxKind | "">("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    kind: AgentInboxKind | "";
    text: string;
  } | null>(null);
  const action = useAction(report);

  const load = useCallback(async () => {
    const epoch = ++request.current;
    setLoading(true);
    try {
      const value = await client.agentRules();
      if (mounted.current && epoch === request.current) {
        setRules(value);
        setFailed(false);
      }
    } catch (error) {
      if (mounted.current && epoch === request.current) {
        setFailed(true);
        reportRef.current(error);
      }
    } finally {
      if (mounted.current && epoch === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [load]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || action.pending || loading || failed) return;
    void action.run(async () => {
      const saved = await client.addAgentRule({
        kind: kind || null,
        text: text.trim(),
      });
      if (!mounted.current) return;
      setRules((all) => [...(all ?? []), saved]);
      setText("");
      setKind("");
      setAdding(false);
      return "Rule added.";
    });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.text.trim() || action.pending || loading || failed)
      return;
    const d = editing;
    void action.run(async () => {
      const saved = await client.updateAgentRule(d.id, {
        kind: d.kind || null,
        text: d.text.trim(),
      });
      if (!mounted.current) return;
      setRules((all) =>
        (all ?? []).map((item) => (item.id === saved.id ? saved : item)),
      );
      setEditing(null);
      return "Rule saved.";
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
    if (!mounted.current || action.pending || loading || failed) return;
    void action.run(async () => {
      await client.deleteAgentRule(r.id);
      if (!mounted.current) return;
      setRules((all) => (all ?? []).filter((item) => item.id !== r.id));
      return "Rule removed.";
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
      disabled={action.pending || loading || failed}
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

  const blocked = action.pending || loading || failed;
  const editor = editing !== null || adding;
  return (
    <div className="agents-rules">
      <div className="section-heading">
        <h3>Standing rules</h3>
        <button
          type="button"
          className="secondary"
          disabled={
            blocked || rules === null || rules.length >= MAX_AGENT_RULES
          }
          onClick={() => setAdding(true)}
        >
          Add rule
        </button>
      </div>
      {failed && (
        <div>
          <p role="alert">Couldn't load rules.</p>
          <button
            type="button"
            className="secondary"
            disabled={action.pending || loading}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}
      {rules === null && !failed ? (
        <p className="muted" role="status">
          Loading rules…
        </p>
      ) : rules?.length ? (
        <ul className="agents-rules-list">
          {rules.map((r) => (
            <li key={r.id}>
              <span className="agents-tag">{ruleKindText(r.kind)}</span>
              <span className="agents-rule-text">{r.text}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Edit ${r.text}`}
                disabled={blocked}
                onClick={() =>
                  setEditing({ id: r.id, kind: r.kind ?? "", text: r.text })
                }
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${r.text}`}
                disabled={blocked}
                onClick={() => void remove(r)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : rules && !failed ? (
        <p className="muted">No rules yet.</p>
      ) : null}
      {editor && (
        <SettingsEditor
          title={editing ? "Edit rule" : "Add rule"}
          pending={action.pending}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        >
          <form onSubmit={editing ? save : add}>
            <fieldset disabled={blocked}>
              <label className="settings-field">
                <span className="settings-label">Applies to</span>
                {kindSelect(
                  "standing-rule-kind",
                  editing?.kind ?? kind,
                  (value) =>
                    editing
                      ? setEditing({ ...editing, kind: value })
                      : setKind(value),
                )}
              </label>
              <label className="settings-field">
                <span className="settings-label">Rule</span>
                <textarea
                  rows={3}
                  required
                  maxLength={500}
                  value={editing?.text ?? text}
                  onChange={(event) =>
                    editing
                      ? setEditing({ ...editing, text: event.target.value })
                      : setText(event.target.value)
                  }
                />
              </label>
            </fieldset>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={action.pending}
                onClick={() => {
                  setEditing(null);
                  setAdding(false);
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={blocked || !(editing?.text ?? text).trim()}
              >
                {editing ? "Save rule" : "Add rule"}
              </button>
            </div>
            <OutcomeNote outcome={action.outcome} />
          </form>
        </SettingsEditor>
      )}
      {!editor && <OutcomeNote outcome={action.outcome} />}
    </div>
  );
}
