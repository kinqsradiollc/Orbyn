import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, Copy, Globe, KeyRound, Plus, Terminal } from "lucide-react";
import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_HIDE_OUTSIDE_TEXT,
  AGENT_SETUP_CLIENTS,
  AGENT_SETUP_LABELS,
  AGENT_SIGN_IN_STEPS,
  agentExpiryText,
  agentSetup,
  isSignInClient,
  type AgentAccess,
  type AgentActivity,
  type AgentGrant,
  type AgentSetupClient,
  type AgentsOverview,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { copyText } from "../../lib/planning";
import { timeAgo } from "../../lib/tasks";
import { openReview } from "../../lib/review";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Select } from "../../components/Select";
import { SettingsSection } from "./SettingsSection";
import "./agents.css";

type Props = {
  report: (e: unknown) => void;
  /** Opens a proposal an agent made in the Review inbox. */
  onOpenReview?: (proposalId: string) => void;
};

/** Short names for the access levels, as tags. */
const ACCESS_TAG: Record<AgentAccess, string> = {
  read: "See",
  suggest: "Suggest",
  write: "Change",
};

const EXPIRY_CHOICES = [7, 30, 90, 365];

/** The app a connection is for, in the list's first column. */
function clientLabel(g: AgentGrant) {
  if (g.kind === "legacy") return "API key";
  if (g.kind === "key") return "Agent key";
  return "Signed in";
}

/** A connection's title in the list. */
function grantTitle(g: AgentGrant) {
  if (g.kind === "legacy") return `API key “${g.name}”`;
  if (g.kind === "key") return `Agent key “${g.name}”`;
  return g.client_name || "An app";
}

/** "Personal, Design team" for a connection's spaces. */
function spacesText(g: AgentGrant) {
  // Old API keys reach every team the person is in, now and later.
  if (g.team_ids === null)
    return g.personal ? "Personal and every team" : "Every team";
  const names = [
    ...(g.personal ? ["Personal"] : []),
    ...g.teams.map((t) => t.name),
  ];
  return names.join(", ") || "No spaces";
}

/** One line of a connection's activity, in words. */
function activityText(a: AgentActivity) {
  const outcome =
    a.outcome === "ok"
      ? ""
      : a.outcome === "denied"
        ? " · refused"
        : a.outcome === "limited"
          ? " · over the limit"
          : a.outcome === "error"
            ? " · failed"
            : ` · ${a.outcome}`;
  return `${a.summary}${outcome}`;
}

/**
 * Settings → Connections → Connected agents: the AI agents let into Orbyn
 * over MCP (agent keys, and old API keys used there), what each did, and how
 * to connect one. Agents see only what their person can.
 */
export function ConnectedAgents({ report, onOpenReview = openReview }: Props) {
  const { ask } = useConfirm();
  const [overview, setOverview] = useState<AgentsOverview | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activity, setActivity] = useState<
    Record<string, AgentActivity[] | null>
  >({});
  const [connecting, setConnecting] = useState(false);
  const connectRef = useRef<HTMLDivElement>(null);
  const action = useAction(report);

  const load = () =>
    client.agents().then(setOverview, (e) => {
      setOverview({ mcp_url: "", legacy_keys_until: null, grants: [] });
      report(e);
    });
  useEffect(() => {
    void load();
    client.listTeams().then(setTeams, () => setTeams([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleActivity = (g: AgentGrant) => {
    if (activity[g.id] !== undefined) {
      setActivity(({ [g.id]: _open, ...rest }) => rest);
      return;
    }
    setActivity((a) => ({ ...a, [g.id]: null }));
    client.agentActivity(g.id).then(
      (list) => setActivity((a) => ({ ...a, [g.id]: list })),
      (e) => {
        setActivity(({ [g.id]: _open, ...rest }) => rest);
        report(e);
      },
    );
  };

  // Take back one change an agent made directly (its activity keeps the
  // steps for 30 days, and refuses if the thing changed since).
  const undo = async (g: AgentGrant, a: AgentActivity) => {
    if (
      !(await ask({
        title: `Undo “${a.summary}”?`,
        body: "Orbyn puts things back as they were before this change. If something changed since, it stays as it is.",
        confirmLabel: "Undo",
      }))
    )
      return;
    await action.run(async () => {
      await client.undoAgentChange(a.id);
      const list = await client.agentActivity(g.id);
      setActivity((all) => ({ ...all, [g.id]: list }));
      return `Undid “${a.summary}”.`;
    });
  };

  const revoke = async (g: AgentGrant) => {
    const legacy = g.kind === "legacy";
    const app = g.kind === "oauth";
    if (
      !(await ask({
        title: legacy
          ? `Disconnect “${g.name}” from agents? It keeps working with the API and CalDAV.`
          : app
            ? `Disconnect ${grantTitle(g)}? It stops working at once, and has to ask you again to reconnect.`
            : `Revoke “${g.name}”? The agent using it stops working at once.`,
        confirmLabel: legacy || app ? "Disconnect" : "Revoke",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.revokeAgent(g.id);
      await load();
      return legacy || app
        ? `Disconnected ${app ? grantTitle(g) : `“${g.name}”`}.`
        : `Revoked “${g.name}”.`;
    });
  };

  const restore = (g: AgentGrant) =>
    void action.run(async () => {
      await client.restoreAgent(g.id);
      await load();
      return `“${g.name}” works again.`;
    });

  const openConnect = () => {
    setConnecting(true);
    window.setTimeout(
      () =>
        connectRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  };

  const grants = overview?.grants ?? [];
  return (
    <SettingsSection
      className="card settings-card agents-card"
      aria-labelledby="agents-title"
      defaultOpen
    >
      <h2 id="agents-title">
        <Bot size={16} aria-hidden="true" /> Connected agents
      </h2>
      <div className="agents-head">
        <p className="muted">
          AI agents you’ve let into Orbyn, like Claude, ChatGPT, Claude Code,
          Codex and Cursor. They can only see what you can, in the spaces you
          choose. Each one uses its own AI: Orbyn sends it only what it asks
          for.
        </p>
        <button type="button" className="primary" onClick={openConnect}>
          <Plus size={14} /> Connect an agent
        </button>
      </div>

      {overview === null ? (
        <p className="muted">Loading connected agents…</p>
      ) : grants.length ? (
        <ul className="agents-list">
          {grants.map((g) => {
            const expiry = agentExpiryText(g.expires_at);
            const open = activity[g.id];
            return (
              <li key={g.id} className="agents-row">
                <span className="agents-client">{clientLabel(g)}</span>
                <span className="agents-icon" aria-hidden="true">
                  {g.kind === "legacy" ? (
                    <KeyRound size={15} />
                  ) : g.kind === "oauth" ? (
                    <Globe size={15} />
                  ) : (
                    <Terminal size={15} />
                  )}
                </span>
                <div className="agents-main">
                  <strong>
                    {grantTitle(g)}
                    {g.client_host && (
                      <span className="agents-host muted">
                        {" "}
                        · {g.client_host}
                      </span>
                    )}
                  </strong>
                  <div className="agents-tags">
                    <span className="agents-tag is-read">See</span>
                    {g.access !== "read" && (
                      <span className="agents-tag is-write">
                        {ACCESS_TAG[g.access]}
                      </span>
                    )}
                    <span className="agents-tag">{spacesText(g)}</span>
                    {g.hide_outside_content && (
                      <span className="agents-tag">Outside content hidden</span>
                    )}
                    {g.suspended_at && (
                      <span className="agents-tag is-late">
                        Paused by Orbyn
                      </span>
                    )}
                    {g.kind === "legacy"
                      ? overview.legacy_keys_until && (
                          <span className="agents-tag is-due">
                            Works here until{" "}
                            {new Date(
                              overview.legacy_keys_until,
                            ).toLocaleDateString([], {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        )
                      : expiry && (
                          <span
                            className={
                              "agents-tag" +
                              (expiry === "Expired" ? " is-late" : " is-due")
                            }
                          >
                            {expiry}
                          </span>
                        )}
                    <span className="agents-tag">
                      {g.last_used_at
                        ? `Used ${timeAgo(g.last_used_at)}`
                        : "Not used yet"}
                    </span>
                  </div>
                  {g.suspended_at && (
                    <p className="muted agents-paused">
                      Orbyn paused it on{" "}
                      {new Date(g.suspended_at).toLocaleDateString([], {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      because it kept going over its limits or asking for things
                      it can’t reach. Check its activity, then restore it or
                      revoke it.
                    </p>
                  )}
                  <div className="agents-acts">
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={open !== undefined}
                      onClick={() => toggleActivity(g)}
                    >
                      Activity
                    </button>
                    {g.suspended_at && (
                      <button
                        type="button"
                        className="link-button"
                        disabled={action.pending}
                        onClick={() => restore(g)}
                      >
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger-text"
                      disabled={action.pending}
                      onClick={() => void revoke(g)}
                    >
                      {g.kind === "key" ? "Revoke" : "Disconnect"}
                    </button>
                  </div>
                  {open !== undefined && (
                    <div className="agents-activity" aria-live="polite">
                      {open === null ? (
                        <p className="muted">Loading activity…</p>
                      ) : open.length ? (
                        <ul>
                          {open.map((a) => (
                            <li key={a.id}>
                              <span className="agents-activity-time">
                                {timeAgo(a.at)}
                              </span>
                              <span>
                                {activityText(a)}
                                {a.undone_at && (
                                  <span className="muted"> · undone</span>
                                )}
                              </span>
                              {a.proposal_id && onOpenReview && (
                                <button
                                  className="link-button"
                                  onClick={() => onOpenReview(a.proposal_id!)}
                                >
                                  Review
                                </button>
                              )}
                              {a.undoable && (
                                <button
                                  className="link-button"
                                  disabled={action.pending}
                                  onClick={() => void undo(g, a)}
                                >
                                  Undo
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">Nothing yet.</p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted agents-empty">
          No agents yet. Connect one below: Claude and ChatGPT sign in with
          Orbyn and ask you what they may do; other apps get an agent key.
          Disconnect any of them at any time.
        </p>
      )}
      {overview &&
        grants.some((g) => g.kind === "legacy") &&
        overview.legacy_keys_until && (
          <p className="muted agents-note">
            Personal API keys still work with agents until{" "}
            {new Date(overview.legacy_keys_until).toLocaleDateString([], {
              day: "numeric",
              month: "long",
            })}
            . Make an agent key to keep your agent working after that.
          </p>
        )}
      <OutcomeNote outcome={action.outcome} />

      <div ref={connectRef}>
        <ConnectAgent
          url={overview?.mcp_url ?? ""}
          teams={teams}
          open={connecting}
          onOpen={() => setConnecting(true)}
          onCreated={() => void load()}
          report={report}
        />
      </div>
    </SettingsSection>
  );
}

/** "Connect an agent": make a key, then the snippet for the chosen app. */
function ConnectAgent({
  url,
  teams,
  open,
  onOpen,
  onCreated,
  report,
}: {
  url: string;
  teams: Team[];
  open: boolean;
  onOpen: () => void;
  onCreated: () => void;
  report: (e: unknown) => void;
}) {
  const [tab, setTab] = useState<AgentSetupClient>("claude");
  const signIn = isSignInClient(tab);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<AgentAccess>("read");
  const [personal, setPersonal] = useState(true);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [hideOutside, setHideOutside] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const action = useAction(report);
  const setup = agentSetup(
    tab,
    url || "https://mcp.orbyn.dev/mcp",
    fresh ?? undefined,
  );

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!personal && !teamIds.length) {
      action.setOutcome({
        ok: false,
        text: "Choose at least one space: Personal or a team.",
      });
      return;
    }
    void action.run(async () => {
      const made = await client.createAgentKey({
        name: name.trim() || `${AGENT_SETUP_LABELS[tab]} key`,
        access,
        personal,
        team_ids: teamIds,
        expires_in_days: days,
        hide_outside_content: hideOutside,
      });
      setFresh(made.key);
      setName("");
      onCreated();
    });
  };

  const copy = (text: string, what: string) =>
    void copyText(text).then((ok) => setCopied(ok ? what : null));

  return (
    <div className="agents-connect">
      <h3>Connect an agent</h3>
      <div className="agents-tabs" role="tablist" aria-label="Which app">
        {AGENT_SETUP_CLIENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={tab === c}
            className={tab === c ? "active" : ""}
            onClick={() => {
              setTab(c);
              setCopied(null);
            }}
          >
            {AGENT_SETUP_LABELS[c]}
          </button>
        ))}
      </div>

      {signIn ? (
        <ol className="agents-steps">
          <li>
            <span className="agents-step-title">{setup.where}</span>
            <div className="agents-snippet">
              <pre>
                <code>{setup.snippet}</code>
              </pre>
              <button
                type="button"
                className="secondary"
                onClick={() => copy(setup.snippet, "snippet")}
              >
                <Copy size={13} /> {copied === "snippet" ? "Copied" : "Copy"}
              </button>
            </div>
          </li>
          {AGENT_SIGN_IN_STEPS[tab as keyof typeof AGENT_SIGN_IN_STEPS].map(
            (step) => (
              <li key={step}>
                <span className="agents-step-title">{step}</span>
              </li>
            ),
          )}
          <li className="agents-step-note">
            <small className="muted">
              No key needed: {AGENT_SETUP_LABELS[tab]} signs in with Orbyn, and
              Orbyn asks you what it may do and in which spaces. Giving it write
              access asks for your password or passkey again.
            </small>
          </li>
        </ol>
      ) : (
        <ol className="agents-steps">
          <li>
            <span className="agents-step-title">Make an agent key</span>
            {fresh ? (
              <div className="secret-box" role="status">
                <strong>Your new agent key</strong>
                <div className="secret-row">
                  <code>{fresh}</code>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => copy(fresh, "key")}
                  >
                    <Copy size={13} /> {copied === "key" ? "Copied" : "Copy"}
                  </button>
                </div>
                <small>
                  Copy it now. For your safety it won’t be shown again. It’s
                  filled in below.
                </small>
                <button
                  type="button"
                  className="link-button agents-another"
                  onClick={() => setFresh(null)}
                >
                  Make another key
                </button>
              </div>
            ) : !open ? (
              <button type="button" className="secondary" onClick={onOpen}>
                <KeyRound size={14} /> Make a key
              </button>
            ) : (
              <form className="agents-form" onSubmit={create}>
                <div className="settings-field">
                  <label htmlFor="agent-key-name">Name</label>
                  <input
                    id="agent-key-name"
                    maxLength={80}
                    placeholder={`Like “MacBook · ${AGENT_SETUP_LABELS[tab]}”`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="agent-key-access">What it may do</label>
                  <Select
                    id="agent-key-access"
                    value={access}
                    onChange={(e) => setAccess(e.target.value as AgentAccess)}
                  >
                    {AGENT_ACCESS.map((a) => (
                      <option key={a} value={a}>
                        {AGENT_ACCESS_LABELS[a].name}
                      </option>
                    ))}
                  </Select>
                  <small className="muted">
                    {AGENT_ACCESS_LABELS[access].blurb}
                    {access !== "read" &&
                      " Risky changes wait for you in Review; you can undo the rest from its activity."}
                  </small>
                </div>
                <fieldset className="check-group">
                  <legend>In these spaces</legend>
                  <div className="check-grid">
                    <label className="check-line">
                      <input
                        type="checkbox"
                        checked={personal}
                        onChange={(e) => setPersonal(e.target.checked)}
                      />
                      Personal
                    </label>
                    {teams.map((t) => (
                      <label key={t.id} className="check-line">
                        <input
                          type="checkbox"
                          checked={teamIds.includes(t.id)}
                          onChange={(e) =>
                            setTeamIds((ids) =>
                              e.target.checked
                                ? [...ids, t.id]
                                : ids.filter((x) => x !== t.id),
                            )
                          }
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="switch-line">
                  <input
                    type="checkbox"
                    role="switch"
                    className="ai-switch"
                    checked={hideOutside}
                    onChange={(e) => setHideOutside(e.target.checked)}
                  />
                  <span>
                    Hide outside content
                    <small>{AGENT_HIDE_OUTSIDE_TEXT}</small>
                  </span>
                </label>
                <div className="settings-field">
                  <label htmlFor="agent-key-days">Lasts</label>
                  <Select
                    id="agent-key-days"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {EXPIRY_CHOICES.map((d) => (
                      <option key={d} value={d}>
                        {d === 365 ? "A year" : `${d} days`}
                      </option>
                    ))}
                  </Select>
                </div>
                <button className="primary" disabled={action.pending}>
                  <KeyRound size={14} /> Make key
                </button>
              </form>
            )}
            <OutcomeNote outcome={action.outcome} />
          </li>
          <li>
            <span className="agents-step-title">{setup.where}</span>
            <div className="agents-snippet">
              <pre>
                <code>{setup.snippet}</code>
              </pre>
              <button
                type="button"
                className="secondary"
                onClick={() => copy(setup.snippet, "snippet")}
              >
                <Copy size={13} /> {copied === "snippet" ? "Copied" : "Copy"}
              </button>
            </div>
            <small className="muted">
              The address is <code>{url || "https://mcp.orbyn.dev/mcp"}</code>.
              Keep the key private, and revoke it here when you stop using the
              agent.
            </small>
          </li>
        </ol>
      )}
    </div>
  );
}
