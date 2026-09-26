import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bot, RefreshCw } from "lucide-react";
import {
  LEGACY_KEY_CLIENT_ID,
  type AdminAgentClient,
  type AdminAgentUsage,
  type AgentLimits,
  type AgentSettings,
  type AgentSettingsUpdate,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { timeAgo } from "../../lib/tasks";
import "./agents-admin.css";

type Report = (e: unknown) => void;

/** The limits, in words, in the order the form shows them. */
const LIMITS: { key: keyof AgentLimits; label: string }[] = [
  { key: "calls_per_minute", label: "Calls a minute, per connection" },
  { key: "search_per_minute", label: "Searches a minute, per connection" },
  { key: "writes_per_minute", label: "Changes a minute, per connection" },
  { key: "writes_per_day", label: "Changes a day, per connection" },
  { key: "calls_per_day", label: "Calls a day, per connection" },
  { key: "concurrent", label: "Calls at once, per connection" },
  { key: "user_per_minute", label: "Calls a minute, per person" },
];

/**
 * Admin → Agents: the switches for outside AI agents (on, changes, apps
 * registering themselves, old API keys), which apps may connect, limits,
 * and use by app. Changes apply within seconds, with no deploy.
 */
export function AdminAgents({ report }: { report: Report }) {
  const { ask } = useConfirm();
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [apps, setApps] = useState<AdminAgentClient[] | null>(null);
  const [usage, setUsage] = useState<AdminAgentUsage | null>(null);
  const [hosts, setHosts] = useState("");
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [maxDays, setMaxDays] = useState("");
  const switches = useAction(report);
  const limitAction = useAction(report);
  const appAction = useAction(report);

  const adopt = (s: AgentSettings) => {
    setSettings(s);
    setHosts(s.allowed_client_hosts.join("\n"));
    setMaxDays(String(s.max_grant_days));
    setLimits(
      Object.fromEntries(
        LIMITS.map(({ key }) => [key, String(s.agent_limits[key])]),
      ),
    );
  };
  const load = useCallback(() => {
    client.adminAgentSettings().then(adopt, report);
    client.adminAgentClients().then(setApps, report);
    client.adminAgentUsage(30).then(setUsage, () => setUsage(null));
  }, [report]);
  useEffect(load, [load]);

  const update = (body: AgentSettingsUpdate, done: string) =>
    client.adminUpdateAgentSettings(body).then((s) => {
      adopt(s);
      return done;
    });

  const toggle = async (
    key: "agents_enabled" | "agents_writes_enabled" | "dcr_enabled",
    on: boolean,
    confirmOff: string,
  ) => {
    if (!on && !(await ask({ title: confirmOff, confirmLabel: "Turn off" })))
      return;
    void switches.run(() =>
      update({ [key]: on }, on ? "Turned on." : "Turned off."),
    );
  };

  const legacyOn =
    !!settings && !settings.blocked_client_ids.includes(LEGACY_KEY_CLIENT_ID);
  const toggleLegacy = async (on: boolean) => {
    if (!settings) return;
    if (
      !on &&
      !(await ask({
        title:
          "Stop old personal API keys from reaching agents? They keep working with the API and CalDAV.",
        confirmLabel: "Turn off",
      }))
    )
      return;
    const blocked = settings.blocked_client_ids.filter(
      (id) => id !== LEGACY_KEY_CLIENT_ID,
    );
    void switches.run(() =>
      update(
        {
          blocked_client_ids: on ? blocked : [...blocked, LEGACY_KEY_CLIENT_ID],
        },
        on
          ? "Old API keys reach agents again."
          : "Old API keys no longer reach agents.",
      ),
    );
  };

  const saveLimits = (e: FormEvent) => {
    e.preventDefault();
    const agent_limits = Object.fromEntries(
      LIMITS.map(({ key }) => [key, Number(limits[key])]),
    ) as AgentLimits;
    if (
      Object.values(agent_limits).some((v) => !Number.isInteger(v) || v < 0) ||
      !Number.isInteger(Number(maxDays)) ||
      Number(maxDays) < 1
    ) {
      limitAction.setOutcome({ ok: false, text: "Use whole numbers." });
      return;
    }
    void limitAction.run(() =>
      update(
        { agent_limits, max_grant_days: Number(maxDays) },
        "Saved. Applies within a few seconds.",
      ),
    );
  };

  const saveHosts = (e: FormEvent) => {
    e.preventDefault();
    const list = hosts
      .split(/[\n,\s]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    void appAction.run(() =>
      update(
        { allowed_client_hosts: list },
        list.length
          ? `Only apps from ${list.join(", ")} can connect now.`
          : "Apps from any website can connect.",
      ),
    );
  };

  const block = async (app: AdminAgentClient, blocked: boolean) => {
    if (!settings) return;
    if (
      blocked &&
      !(await ask({
        title: `Block ${app.name} (${app.host})? Its ${app.connections} connection${app.connections === 1 ? "" : "s"} end at once, and people are told.`,
        confirmLabel: "Block app",
        destructive: true,
      }))
    )
      return;
    const rest = settings.blocked_client_ids.filter((id) => id !== app.id);
    void appAction.run(async () => {
      const done = await update(
        { blocked_client_ids: blocked ? [...rest, app.id] : rest },
        blocked ? `Blocked ${app.name}.` : `${app.name} can connect again.`,
      );
      setApps(await client.adminAgentClients());
      return done;
    });
  };

  if (!settings)
    return (
      <section className="card agents-admin fade-up">
        <p className="muted">Loading agent settings…</p>
      </section>
    );

  return (
    <>
      <section className="card agents-admin fade-up">
        <div className="section-heading">
          <h2>
            <Bot size={16} aria-hidden="true" /> Outside agents
          </h2>
          <button type="button" className="secondary" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <p className="muted agents-admin-lead">
          AI agents people connect to Orbyn over MCP (Claude, ChatGPT, coding
          tools). These switches apply to everyone within a few seconds.
        </p>
        <div className="agents-admin-switches">
          <Switch
            label="Outside agents"
            hint="Off: every agent is refused, and none can sign in."
            on={settings.agents_enabled}
            disabled={switches.pending}
            onChange={(on) =>
              void toggle(
                "agents_enabled",
                on,
                "Turn outside agents off for everyone? Every connected agent stops at once.",
              )
            }
          />
          <Switch
            label="Let agents make changes"
            hint="Off: agents can still read, but every change is refused (for incidents)."
            on={settings.agents_writes_enabled}
            disabled={switches.pending}
            onChange={(on) =>
              void toggle(
                "agents_writes_enabled",
                on,
                "Freeze every agent's changes? Reading keeps working.",
              )
            }
          />
          <Switch
            label="Apps can register themselves"
            hint="For apps without a client metadata document. Limited per address; unused registrations are cleared after a week."
            on={settings.dcr_enabled}
            disabled={switches.pending}
            onChange={(on) =>
              void toggle(
                "dcr_enabled",
                on,
                "Stop apps from registering themselves? Apps that already did keep working.",
              )
            }
          />
          <Switch
            label="Old personal API keys reach agents"
            hint="During their 90 days. They always keep working with the API and CalDAV."
            on={legacyOn}
            disabled={switches.pending}
            onChange={(on) => void toggleLegacy(on)}
          />
        </div>
        <OutcomeNote outcome={switches.outcome} />
      </section>

      <section className="card agents-admin fade-up">
        <div className="section-heading">
          <h2>Apps</h2>
        </div>
        <form className="agents-admin-hosts" onSubmit={saveHosts}>
          <label htmlFor="agents-hosts">
            Only allow apps from these websites
          </label>
          <textarea
            id="agents-hosts"
            rows={3}
            value={hosts}
            placeholder={"Empty: any website.\nclaude.ai\nchatgpt.com"}
            onChange={(e) => setHosts(e.target.value)}
          />
          <button className="secondary" disabled={appAction.pending}>
            Save websites
          </button>
        </form>
        {apps === null ? (
          <p className="muted">Loading apps…</p>
        ) : apps.length ? (
          <div className="table-scroll">
            <table className="agents-admin-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>How it’s known</th>
                  <th>Connections</th>
                  <th>Last used</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id} className={a.blocked ? "is-blocked" : ""}>
                    <td>
                      <strong>{a.name}</strong>
                      <small className="muted">{a.host}</small>
                    </td>
                    <td>
                      {a.kind === "cimd" ? "Its website" : "Registered itself"}
                    </td>
                    <td>{a.connections}</td>
                    <td>
                      {a.last_used_at ? timeAgo(a.last_used_at) : "Never"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={a.blocked ? "link-button" : "danger-text"}
                        disabled={appAction.pending}
                        onClick={() => void block(a, !a.blocked)}
                      >
                        {a.blocked ? "Unblock" : "Block"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No app has signed in yet.</p>
        )}
        <OutcomeNote outcome={appAction.outcome} />
      </section>

      <section className="card agents-admin fade-up">
        <div className="section-heading">
          <h2>Limits</h2>
        </div>
        <form className="agents-admin-limits" onSubmit={saveLimits}>
          <label>
            Longest a connection may last (days)
            <input
              inputMode="numeric"
              value={maxDays}
              onChange={(e) => setMaxDays(e.target.value)}
            />
          </label>
          {LIMITS.map(({ key, label }) => (
            <label key={key}>
              {label}
              <input
                inputMode="numeric"
                value={limits[key] ?? ""}
                onChange={(e) =>
                  setLimits((l) => ({ ...l, [key]: e.target.value }))
                }
              />
            </label>
          ))}
          <div className="agents-admin-save">
            <button className="primary" disabled={limitAction.pending}>
              Save limits
            </button>
            <OutcomeNote outcome={limitAction.outcome} />
          </div>
        </form>
      </section>

      {usage && (
        <section className="card agents-admin fade-up">
          <div className="section-heading">
            <h2>Use by app</h2>
            <small className="muted">Last {usage.days} days</small>
          </div>
          <p className="muted agents-admin-lead">
            People who turned usage analytics off aren’t counted.
          </p>
          {usage.apps.length ? (
            <div className="table-scroll">
              <table className="agents-admin-table">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>People</th>
                    <th>Calls</th>
                    <th>Changes</th>
                    <th>Refused</th>
                    <th>Over limits</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.apps.map((u) => (
                    <tr key={`${u.kind}-${u.app}`}>
                      <td>
                        <strong>{u.app}</strong>
                      </td>
                      <td>{u.people}</td>
                      <td>{u.calls}</td>
                      <td>{u.writes}</td>
                      <td>{u.denied}</td>
                      <td>{u.limited}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No agent use yet.</p>
          )}
        </section>
      )}
    </>
  );
}

function Switch({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="switch-line agents-admin-switch">
      <input
        type="checkbox"
        role="switch"
        className="ai-switch"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        <small>{hint}</small>
      </span>
    </label>
  );
}
