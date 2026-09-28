import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Plus,
  Terminal,
} from "lucide-react";
import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_ASK_FIRST,
  AGENT_ASK_FIRST_LABELS,
  AGENT_NEVER,
  AGENT_TRUST,
  AGENT_TRUST_LABELS,
  AGENT_HIDE_OUTSIDE_TEXT,
  AGENT_TOOLSETS,
  AGENT_TOOLSET_LABELS,
  AGENT_SETUP_CLIENTS,
  AGENT_SETUP_LABELS,
  AGENT_SIGN_IN_STEPS,
  agentExpiryText,
  agentInstallLinks,
  agentJobText,
  groupAgentActivity,
  agentSetup,
  isSignInClient,
  type AgentAccess,
  type AgentActivity,
  type AgentActivityLink,
  type AgentAskFirst,
  type AgentJob,
  type AgentGrant,
  type AgentTrust,
  type AgentSetupClient,
  type AgentToolset,
  type AgentsOverview,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { copyText } from "../../lib/planning";
import { timeAgo } from "../../lib/tasks";
import { openReview } from "../../lib/review";
import { openObject } from "../docs/DocLinks";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Select } from "../../components/Select";
import { SettingsSection } from "./SettingsSection";
import { AgentRules, InboxEdit } from "./AgentInbox";
import { AgentWarmStart } from "./AgentContext";
import "./agents.css";

type Props = {
  report: (e: unknown) => void;
  /** Opens a proposal an agent made in the Review inbox. */
  onOpenReview?: (proposalId: string) => void;
};

/** What each access level lets a connection do, as tags. */
const ACCESS_TAG: Record<AgentAccess, string> = {
  read: "Can see",
  suggest: "Can suggest",
  write: "Can make changes",
};

const EXPIRY_CHOICES = [7, 30, 90, 365];

/** Toolsets a connection can have besides core (which every one has). */
const OPTIONAL_TOOLSETS = AGENT_TOOLSETS.filter(
  (t) => t !== "core",
) as AgentToolset[];

/** "Planner, Study" for a connection's toolsets besides core. */
function toolsetsText(g: AgentGrant) {
  const extra = g.toolsets.filter((t) => t !== "core");
  return extra.length
    ? extra.map((t) => AGENT_TOOLSET_LABELS[t].name).join(", ")
    : "Core tools only";
}

/** Choosing toolsets: one checkbox each, with what it adds. */
function ToolsetChoice({
  value,
  onChange,
  bookings,
  idPrefix,
}: {
  value: AgentToolset[];
  onChange: (next: AgentToolset[]) => void;
  /** Bookings can be chosen (not for an app that signed in without them). */
  bookings: boolean;
  idPrefix: string;
}) {
  return (
    <fieldset className="check-group agents-toolsets">
      <legend>Tools</legend>
      <small className="muted">
        {AGENT_TOOLSET_LABELS.core.name} are always on. Add more:
      </small>
      <div className="check-grid">
        {OPTIONAL_TOOLSETS.filter((t) => bookings || t !== "booking").map(
          (t) => (
            <label key={t} className="check-line" htmlFor={`${idPrefix}-${t}`}>
              <input
                id={`${idPrefix}-${t}`}
                type="checkbox"
                checked={value.includes(t)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, t]
                      : value.filter((x) => x !== t),
                  )
                }
              />
              <span>
                {AGENT_TOOLSET_LABELS[t].name}
                <small>{AGENT_TOOLSET_LABELS[t].blurb}</small>
              </span>
            </label>
          ),
        )}
      </div>
    </fieldset>
  );
}

/** Short names for the trust levels, as tags. */
const TRUST_TAG: Record<AgentTrust, string> = {
  full: "Full power",
  ask: "Asks first",
  suggest: "Suggests",
};

/** What "How it acts" is changing: trust, per space, and ask-first items. */
type TrustDraft = {
  id: string;
  trust: AgentTrust;
  /** "personal" or a team id → its own level ("" = same as the default). */
  spaces: Record<string, AgentTrust | "">;
  actsAlone: AgentAskFirst[];
};

/**
 * How a connection acts: its trust, per space where it differs, and which
 * ask-first items it may do alone. Only a connection that may change
 * things can be set to full power or ask; one that suggests stays so.
 */
function TrustEdit({
  grant,
  draft,
  onChange,
  onSave,
  onCancel,
  pending,
}: {
  grant: AgentGrant;
  draft: TrustDraft;
  onChange: (next: TrustDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const changes = grant.access === "write";
  const assistantGrant = grant.kind === "assistant";
  const allowedTrust = AGENT_TRUST.filter(
    (trust) =>
      !assistantGrant ||
      (trust !== "full" &&
        AGENT_TRUST.indexOf(trust) >= AGENT_TRUST.indexOf(grant.trust)),
  );
  const trustChoices = assistantGrant
    ? [...new Set([grant.trust, ...allowedTrust])]
    : AGENT_TRUST;
  const spaces = [
    ...(grant.personal ? [{ id: "personal", name: "Personal" }] : []),
    ...grant.teams,
  ];
  return (
    <div className="agents-tools-edit agents-trust">
      {!changes ? (
        <p className="muted">
          {grant.access === "read"
            ? "It can only read. To let it change things, connect it again and allow changes."
            : "It can only suggest: every change waits in your Review inbox. To give it more, connect it again and allow changes."}
        </p>
      ) : (
        <>
          {assistantGrant && (
            <p className="muted">
              {grant.name} is built in, so it cannot be disconnected. Its trust
              can only be lowered. Protected actions stay ask-first.
            </p>
          )}
          <div className="settings-field">
            <label htmlFor={`trust-${grant.id}`}>How much it does alone</label>
            <Select
              id={`trust-${grant.id}`}
              value={draft.trust}
              onChange={(e) =>
                onChange({ ...draft, trust: e.target.value as AgentTrust })
              }
            >
              {trustChoices.map((t) => (
                <option
                  key={t}
                  value={t}
                  disabled={assistantGrant && t === "full"}
                >
                  {AGENT_TRUST_LABELS[t].name}
                  {assistantGrant && t === "full" ? " · current" : ""}
                </option>
              ))}
            </Select>
            <small className="muted">
              {AGENT_TRUST_LABELS[draft.trust].blurb}
            </small>
          </div>
          {!assistantGrant && spaces.length > 1 && (
            <fieldset className="agents-trust-spaces">
              <legend>In each space</legend>
              {spaces.map((sp) => (
                <div key={sp.id} className="agents-trust-space">
                  <label htmlFor={`trust-${grant.id}-${sp.id}`}>
                    {sp.name}
                  </label>
                  <Select
                    id={`trust-${grant.id}-${sp.id}`}
                    value={draft.spaces[sp.id] ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        spaces: {
                          ...draft.spaces,
                          [sp.id]: e.target.value as AgentTrust | "",
                        },
                      })
                    }
                  >
                    <option value="">
                      Same ({AGENT_TRUST_LABELS[draft.trust].name})
                    </option>
                    {AGENT_TRUST.filter((t) => t !== draft.trust).map((t) => (
                      <option key={t} value={t}>
                        {AGENT_TRUST_LABELS[t].name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </fieldset>
          )}
          {!assistantGrant && draft.trust === "full" && (
            <fieldset className="agents-trust-list">
              <legend>At full power it still asks first about</legend>
              {AGENT_ASK_FIRST.map((k) => {
                const asks = !draft.actsAlone.includes(k);
                return (
                  <label
                    key={k}
                    className="switch-line"
                    htmlFor={`ask-${grant.id}-${k}`}
                  >
                    <input
                      id={`ask-${grant.id}-${k}`}
                      type="checkbox"
                      role="switch"
                      className="ai-switch"
                      checked={asks}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          actsAlone: e.target.checked
                            ? draft.actsAlone.filter((x) => x !== k)
                            : [...draft.actsAlone, k],
                        })
                      }
                    />
                    <span>
                      {AGENT_ASK_FIRST_LABELS[k].name}
                      <small>
                        {asks ? "Asks first" : "Acts alone"} ·{" "}
                        {AGENT_ASK_FIRST_LABELS[k].blurb}
                      </small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </>
      )}
      <small className="muted">Never through an agent: {AGENT_NEVER}</small>
      <div className="agents-tools-actions">
        {changes && (
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={onSave}
          >
            Save
          </button>
        )}
        <button type="button" className="secondary" onClick={onCancel}>
          {changes ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  );
}

/** The app a connection is for, in the list's first column. */
function clientLabel(g: AgentGrant) {
  if (g.kind === "assistant") return "Built in";
  if (g.kind === "legacy") return "API key";
  if (g.kind === "key") return "Agent key";
  return "Signed in";
}

/** A connection's title in the list. */
function grantTitle(g: AgentGrant) {
  if (g.kind === "assistant") return g.name;
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

/** A job in words: what it changed, or its one line (reads, refusals). */
function jobText(g: AgentGrant, job: AgentJob) {
  return job.changes > 0
    ? agentJobText(grantTitle(g), job.kinds)
    : activityText(job.rows[0]);
}

/** " · undone" when all of a job was undone, " · partly undone" for some. */
function undoneText(job: AgentJob) {
  const undone = job.rows.filter((a) => a.undone_at).length;
  if (!undone) return "";
  return undone === job.rows.length ? " · undone" : " · partly undone";
}

/** What a job touched that still opens, each once, at most five. */
function jobLinks(job: AgentJob): AgentActivityLink[] {
  const seen = new Set<string>();
  const out: AgentActivityLink[] = [];
  for (const a of job.rows)
    for (const l of a.links ?? []) {
      const key = `${l.kind}:${l.id}`;
      if (seen.has(key) || out.length >= 5) continue;
      seen.add(key);
      out.push(l);
    }
  return out;
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
  /** The connection whose toolsets are being changed, and the choice so far. */
  const [editing, setEditing] = useState<{
    id: string;
    toolsets: AgentToolset[];
  } | null>(null);
  /** The connection whose trust is being changed, and the choice so far. */
  const [trusting, setTrusting] = useState<TrustDraft | null>(null);
  /** The connection whose inbox choices (kinds, wake-up) are open. */
  const [hearing, setHearing] = useState<string | null>(null);
  /** Jobs in the activity opened to show each change. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleJob = (id: string) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const connectRef = useRef<HTMLDivElement>(null);
  const action = useAction(report);

  const openTrust = (g: AgentGrant) =>
    setTrusting(
      trusting?.id === g.id
        ? null
        : {
            id: g.id,
            trust: g.trust,
            spaces: { ...g.space_trust },
            actsAlone: [...g.acts_alone],
          },
    );

  const saveTrust = (g: AgentGrant) => {
    if (!trusting) return;
    const d = trusting;
    const reach = [
      ...(g.personal ? ["personal"] : []),
      ...g.teams.map((t) => t.id),
    ];
    void action.run(async () => {
      await client.setAgentTrust(d.id, {
        trust: d.trust,
        spaces: Object.fromEntries(
          reach.map((id) => [id, d.spaces[id] ? d.spaces[id] : null]),
        ),
        acts_alone: d.actsAlone,
      });
      setTrusting(null);
      await load();
      return `${grantTitle(g)} now: ${AGENT_TRUST_LABELS[d.trust].name.toLowerCase()}.`;
    });
  };

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

  // Take back a whole job (every step of a plan, or one call's changes):
  // all of it or, if anything changed since, none of it.
  const undoJob = async (g: AgentGrant, job: AgentJob) => {
    const id = job.job;
    if (!id) return;
    const who = grantTitle(g);
    if (
      !(await ask({
        title: `Undo everything ${who} did in this job?`,
        body: "Orbyn puts every change in it back as it was before. If anything changed since, nothing is undone, and you can still undo the changes one by one.",
        confirmLabel: "Undo job",
      }))
    )
      return;
    await action.run(async () => {
      const { undone } = await client.undoAgentJob(g.id, id);
      const list = await client.agentActivity(g.id);
      setActivity((all) => ({ ...all, [g.id]: list }));
      return `Undid ${undone} ${undone === 1 ? "change" : "changes"} ${who} made.`;
    });
  };

  /** A change's own buttons: Review its proposal, Undo it. */
  const rowActions = (g: AgentGrant, a: AgentActivity) => (
    <>
      {a.proposal_id && onOpenReview && (
        <button
          type="button"
          className="link-button"
          onClick={() => onOpenReview(a.proposal_id!)}
        >
          Review
        </button>
      )}
      {a.undoable && (
        <button
          type="button"
          className="link-button"
          disabled={action.pending}
          onClick={() => void undo(g, a)}
        >
          Undo
        </button>
      )}
    </>
  );

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

  const saveToolsets = () => {
    if (!editing) return;
    const target = editing;
    void action.run(async () => {
      await client.setAgentToolsets(target.id, target.toolsets);
      setEditing(null);
      await load();
      return "Its tools changed. The agent sees them the next time it lists its tools (within five minutes).";
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
          for.{" "}
          <a href="/developers/mcp" className="link-button">
            For developers
          </a>
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
                  {g.kind === "assistant" ? (
                    <Bot size={15} />
                  ) : g.kind === "legacy" ? (
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
                    <span
                      className={
                        "agents-tag " +
                        (g.access === "read" ? "is-read" : "is-write")
                      }
                    >
                      {ACCESS_TAG[g.access]}
                    </span>
                    {g.access === "write" && (
                      <span className="agents-tag">{TRUST_TAG[g.trust]}</span>
                    )}
                    {g.access === "write" &&
                      Object.keys(g.space_trust).length > 0 && (
                        <span className="agents-tag">Differs by space</span>
                      )}
                    <span className="agents-tag">{spacesText(g)}</span>
                    {g.kind !== "legacy" && g.kind !== "assistant" && (
                      <span className="agents-tag">{toolsetsText(g)}</span>
                    )}
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
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={trusting?.id === g.id}
                      onClick={() => openTrust(g)}
                    >
                      How it acts
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={hearing === g.id}
                      onClick={() => setHearing(hearing === g.id ? null : g.id)}
                    >
                      What it hears
                    </button>
                    {g.kind !== "legacy" && (
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={editing?.id === g.id}
                        onClick={() =>
                          setEditing(
                            editing?.id === g.id
                              ? null
                              : {
                                  id: g.id,
                                  toolsets: g.toolsets.filter(
                                    (t) => t !== "core",
                                  ),
                                },
                          )
                        }
                      >
                        Tools
                      </button>
                    )}
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
                    {g.kind !== "assistant" && (
                      <button
                        type="button"
                        className="danger-text"
                        disabled={action.pending}
                        onClick={() => void revoke(g)}
                      >
                        {g.kind === "key" ? "Revoke" : "Disconnect"}
                      </button>
                    )}
                  </div>
                  {trusting?.id === g.id && (
                    <TrustEdit
                      grant={g}
                      draft={trusting}
                      onChange={setTrusting}
                      onSave={() => saveTrust(g)}
                      onCancel={() => setTrusting(null)}
                      pending={action.pending}
                    />
                  )}
                  {hearing === g.id && (
                    <InboxEdit
                      grant={g}
                      report={report}
                      onClose={() => setHearing(null)}
                    />
                  )}
                  {editing?.id === g.id && (
                    <div className="agents-tools-edit">
                      <ToolsetChoice
                        idPrefix={`tools-${g.id}`}
                        value={editing.toolsets}
                        bookings={
                          g.kind === "key" || g.toolsets.includes("booking")
                        }
                        onChange={(toolsets) =>
                          setEditing({ id: g.id, toolsets })
                        }
                      />
                      {g.kind === "oauth" &&
                        !g.toolsets.includes("booking") && (
                          <small className="muted">
                            Bookings need {g.client_name || "the app"} to ask
                            for them when it signs in again.
                          </small>
                        )}
                      <div className="agents-tools-actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={action.pending}
                          onClick={saveToolsets}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {open !== undefined && (
                    <div className="agents-activity" aria-live="polite">
                      {open === null ? (
                        <p className="muted">Loading activity…</p>
                      ) : open.length ? (
                        <ul>
                          {groupAgentActivity(open).map((job) => {
                            const many = job.rows.length > 1;
                            const shown = expanded.has(job.id);
                            const links = jobLinks(job);
                            const undoable = job.rows.filter(
                              (a) => a.undoable,
                            ).length;
                            return (
                              <li key={job.id} className="agents-job">
                                <span className="agents-activity-time">
                                  {timeAgo(job.at)}
                                </span>
                                <div className="agents-job-main">
                                  <span>
                                    {jobText(g, job)}
                                    {undoneText(job) && (
                                      <span className="muted">
                                        {undoneText(job)}
                                      </span>
                                    )}
                                  </span>
                                  {links.length > 0 && (
                                    <span className="agents-job-links">
                                      {links.map((l) => (
                                        <button
                                          key={`${l.kind}:${l.id}`}
                                          type="button"
                                          className="link-button"
                                          title={`Open this ${l.kind === "doc" ? "page" : l.kind}`}
                                          onClick={() =>
                                            openObject({
                                              kind: l.kind,
                                              id: l.id,
                                            })
                                          }
                                        >
                                          {l.title || "Untitled"}
                                        </button>
                                      ))}
                                    </span>
                                  )}
                                  {many && shown && (
                                    <ul className="agents-job-steps">
                                      {job.rows.map((a) => (
                                        <li key={a.id}>
                                          <span>
                                            {activityText(a)}
                                            {a.undone_at && (
                                              <span className="muted">
                                                {" "}
                                                · undone
                                              </span>
                                            )}
                                          </span>
                                          {rowActions(g, a)}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                <span className="agents-job-acts">
                                  {many ? (
                                    <>
                                      <button
                                        type="button"
                                        className="link-button agents-job-toggle"
                                        aria-expanded={shown}
                                        onClick={() => toggleJob(job.id)}
                                      >
                                        {shown ? (
                                          <ChevronDown
                                            size={13}
                                            aria-hidden="true"
                                          />
                                        ) : (
                                          <ChevronRight
                                            size={13}
                                            aria-hidden="true"
                                          />
                                        )}
                                        {job.rows.length} steps
                                      </button>
                                      {job.job && undoable > 1 && (
                                        <button
                                          type="button"
                                          className="link-button"
                                          disabled={action.pending}
                                          onClick={() => void undoJob(g, job)}
                                        >
                                          Undo job
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    rowActions(g, job.rows[0])
                                  )}
                                </span>
                              </li>
                            );
                          })}
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
      <AgentWarmStart report={report} />
      {grants.length > 0 && <AgentRules report={report} />}

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
  // New connections start at full power (see AGENT_TRUST).
  const [access, setAccess] = useState<AgentAccess>("write");
  const [personal, setPersonal] = useState(true);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [hideOutside, setHideOutside] = useState(false);
  const [toolsets, setToolsets] = useState<AgentToolset[]>([]);
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
        toolsets: ["core", ...toolsets],
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
                    {access === "write" &&
                      " Change how much it does alone later with “How it acts”."}
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
                <ToolsetChoice
                  idPrefix="agent-key-tools"
                  value={toolsets}
                  bookings
                  onChange={setToolsets}
                />
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

      <div className="agents-install">
        <span className="agents-step-title">Or add Orbyn in one click</span>
        <div className="agents-install-links">
          {agentInstallLinks(url || "https://mcp.orbyn.dev/mcp").map((l) => (
            <a
              key={l.app}
              className="secondary"
              href={l.href}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} /> {l.label}
            </a>
          ))}
        </div>
        <small className="muted">
          Opens the app with Orbyn’s address filled in. It then signs in with
          Orbyn, or asks for an agent key. No key is ever part of the link.
        </small>
      </div>
    </div>
  );
}
