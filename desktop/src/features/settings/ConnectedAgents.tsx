import { PluginAiPermission } from "./PluginAiPermission";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  ExternalLink,
  Globe,
  KeyRound,
  Plus,
  Terminal,
} from "lucide-react";
import {
  HttpError,
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
import { copyText } from "../planner/planning";
import { timeAgo } from "../tasks/tasks";
import { openReview } from "../review/review";
import { openObject } from "../documents/editor/DocLinks";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Select } from "../../components/Select";
import { Popover } from "../../components/Popover";
import { SettingsSection } from "./SettingsSection";
import { SettingsEditor } from "./SettingsEditor";
import { AgentRules, InboxEdit } from "./AgentInbox";
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
    <fieldset disabled={pending} className="agents-tools-edit agents-trust">
      {!changes ? (
        <p className="muted">
          {grant.access === "read"
            ? "Read only. Reconnect to allow changes."
            : "Changes need your review. Reconnect to allow more."}
        </p>
      ) : (
        <>
          {assistantGrant && (
            <p className="muted">
              {grant.name} is built in and cannot be disconnected. You can lower
              its access; protected actions still need approval.
            </p>
          )}
          <div className="settings-field">
            <label htmlFor={`trust-${grant.id}`}>How much it does alone</label>
            <Select
              disabled={pending}
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
                    disabled={pending}
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
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={onCancel}
        >
          {changes ? "Cancel" : "Close"}
        </button>
      </div>
    </fieldset>
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

/** Every distinct object a job touched that still opens. */
function jobLinks(job: AgentJob): AgentActivityLink[] {
  const seen = new Set<string>();
  const out: AgentActivityLink[] = [];
  for (const a of job.rows)
    for (const l of a.links ?? []) {
      const key = `${l.kind}:${l.id}`;
      if (seen.has(key)) continue;
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
  const [activityId, setActivityId] = useState<string | null>(null);
  const [connectionQuery, setConnectionQuery] = useState("");
  const [connectionGroup, setConnectionGroup] = useState<"external" | "orbyn">(
    "external",
  );
  const [connectionPage, setConnectionPage] = useState(0);
  const connectionList = useRef<HTMLUListElement>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [teamsFailed, setTeamsFailed] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [activityFailed, setActivityFailed] = useState<Record<string, boolean>>(
    {},
  );
  const mounted = useRef(true);
  const overviewRequest = useRef(0);
  const activityRequest = useRef<Record<string, number>>({});
  const reportRef = useRef(report);
  reportRef.current = report;
  const authFailure = (error: unknown) => {
    if (error instanceof HttpError && error.statusCode === 401)
      reportRef.current(error);
  };
  const [activity, setActivity] = useState<
    Record<string, AgentActivity[] | null>
  >({});
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(
    null,
  );
  const [connecting, setConnecting] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [secretUnsaved, setSecretUnsaved] = useState(false);
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
      const saved = await client.setAgentTrust(d.id, {
        trust: d.trust,
        spaces: Object.fromEntries(
          reach.map((id) => [id, d.spaces[id] ? d.spaces[id] : null]),
        ),
        acts_alone: d.actsAlone,
      });
      if (!mounted.current) return;
      setOverview(
        (all) =>
          all && {
            ...all,
            grants: all.grants.map((item) =>
              item.id === saved.id ? saved : item,
            ),
          },
      );
      setTrusting(null);
      return `${grantTitle(g)} now: ${AGENT_TRUST_LABELS[d.trust].name.toLowerCase()}.`;
    });
  };

  const load = async () => {
    const request = ++overviewRequest.current;
    setOverviewFailed(false);
    try {
      const next = await client.agents();
      if (mounted.current && request === overviewRequest.current)
        setOverview(next);
    } catch (error) {
      if (!mounted.current || request !== overviewRequest.current) return;
      setOverviewFailed(true);
      authFailure(error);
    }
  };
  const loadTeams = async () => {
    setTeamsLoading(true);
    setTeamsFailed(false);
    try {
      const next = await client.listTeams();
      if (mounted.current) setTeams(next);
    } catch (error) {
      if (!mounted.current) return;
      setTeamsFailed(true);
      authFailure(error);
    } finally {
      if (mounted.current) setTeamsLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    void loadTeams();
    return () => {
      mounted.current = false;
      overviewRequest.current += 1;
    };
  }, []);

  const loadActivity = async (id: string) => {
    const request = (activityRequest.current[id] ?? 0) + 1;
    activityRequest.current[id] = request;
    setActivityFailed((all) => ({ ...all, [id]: false }));
    setActivity((all) => ({ ...all, [id]: null }));
    try {
      const next = await client.agentActivity(id);
      if (mounted.current && activityRequest.current[id] === request)
        setActivity((all) => ({ ...all, [id]: next }));
    } catch (error) {
      if (!mounted.current || activityRequest.current[id] !== request) return;
      setActivityFailed((all) => ({ ...all, [id]: true }));
      authFailure(error);
    }
  };
  const toggleActivity = (g: AgentGrant) => {
    if (action.pending) return;
    setActivityId(g.id);
    void loadActivity(g.id);
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
    if (!mounted.current) return;
    await action.run(async () => {
      await client.undoAgentChange(a.id);
      if (!mounted.current) return;
      await loadActivity(g.id);
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
    if (!mounted.current) return;
    await action.run(async () => {
      const { undone } = await client.undoAgentJob(g.id, id);
      if (!mounted.current) return;
      await loadActivity(g.id);
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
          onClick={() => {
            setActivityId(null);
            onOpenReview(a.proposal_id!);
          }}
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
    if (!mounted.current) return;
    void action.run(async () => {
      await client.revokeAgent(g.id);
      if (!mounted.current) return;
      setOverview(
        (all) =>
          all && {
            ...all,
            grants: all.grants.filter((item) => item.id !== g.id),
          },
      );
      return legacy || app
        ? `Disconnected ${app ? grantTitle(g) : `“${g.name}”`}.`
        : `Revoked “${g.name}”.`;
    });
  };

  const saveToolsets = () => {
    if (!editing) return;
    const target = editing;
    void action.run(async () => {
      const saved = await client.setAgentToolsets(target.id, target.toolsets);
      if (!mounted.current) return;
      setOverview(
        (all) =>
          all && {
            ...all,
            grants: all.grants.map((item) =>
              item.id === saved.id ? saved : item,
            ),
          },
      );
      setEditing(null);
      return "Tools saved. Allow up to five minutes for the agent to refresh.";
    });
  };

  const restore = (g: AgentGrant) =>
    void action.run(async () => {
      await client.restoreAgent(g.id);
      if (!mounted.current) return;
      setOverview(
        (all) =>
          all && {
            ...all,
            grants: all.grants.map((item) =>
              item.id === g.id ? { ...item, suspended_at: null } : item,
            ),
          },
      );
      return `“${g.name}” works again.`;
    });

  const openConnect = () => setConnecting(true);

  const grants = (overview?.grants ?? []).filter((grant) =>
    connectionGroup === "orbyn"
      ? grant.kind === "assistant"
      : grant.kind !== "assistant",
  );
  const listLocked =
    action.pending || !!editing || !!trusting || !!hearing || !!activityId;
  const query = connectionQuery.trim().toLocaleLowerCase();
  const matchingGrants = grants.filter((grant) =>
    [grantTitle(grant), grant.name, grant.client_host, spacesText(grant)]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query),
  );
  const pageSize = 5;
  const lastPage = Math.max(0, Math.ceil(matchingGrants.length / pageSize) - 1);
  const page = Math.min(connectionPage, lastPage);
  useEffect(() => {
    if (connectionList.current) connectionList.current.scrollTop = 0;
  }, [page, query]);
  const shownGrants = matchingGrants.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );
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
        <p className="muted">Choose what connected agents can access.</p>
        <button
          type="button"
          className="primary"
          disabled={
            !overview ||
            overviewFailed ||
            teamsLoading ||
            teamsFailed ||
            action.pending
          }
          onClick={openConnect}
        >
          <Plus size={14} /> Connect an agent
        </button>
      </div>

      <details className="agents-help">
        <summary>How connections work</summary>
        <p className="muted">
          Agents use their own AI and only access the spaces you allow. Review
          permissions when connecting and disconnect at any time.
        </p>
        <a href="/developers/mcp" className="link-button">
          Developer guide
        </a>
      </details>

      <div className="button-row start" aria-label="Connection category">
        {(["external", "orbyn"] as const).map((group) => (
          <button
            key={group}
            type="button"
            className="secondary"
            aria-pressed={connectionGroup === group}
            disabled={listLocked}
            onClick={() => {
              setConnectionGroup(group);
              setConnectionPage(0);
              setConnectionQuery("");
            }}
          >
            {group === "external" ? "Connected apps" : "Orbyn assistant"}
          </button>
        ))}
      </div>
      {!!grants.length && (
        <label className="agents-search">
          <span>Find a connection</span>
          <input
            type="search"
            disabled={listLocked}
            value={connectionQuery}
            placeholder="Name or space"
            onChange={(event) => {
              setConnectionQuery(event.target.value);
              setConnectionPage(0);
            }}
          />
        </label>
      )}
      {teamsFailed && (
        <div>
          <p role="alert">Couldn't load spaces.</p>
          <button className="secondary" onClick={() => void loadTeams()}>
            Retry spaces
          </button>
        </div>
      )}
      {overviewFailed ? (
        <div>
          <p role="alert">Couldn't load connected agents.</p>
          <button className="secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : overview === null ? (
        <p className="muted">Loading connected agents…</p>
      ) : grants.length ? (
        <ul className="agents-list" ref={connectionList}>
          {shownGrants.map((g) => {
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
                  {g.reconnect_required && (
                    <p className="muted agents-paused" role="status">
                      Sign in to Orbyn again from {g.client_name || g.name} to
                      reconnect.
                    </p>
                  )}
                  {g.suspended_at && !g.reconnect_required && (
                    <p className="muted agents-paused">
                      Paused on{" "}
                      {new Date(g.suspended_at).toLocaleDateString([], {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      after repeated access or usage failures. Check activity
                      before restoring or revoking it.
                    </p>
                  )}
                  <div className="agents-acts">
                    <button
                      type="button"
                      className="link-button"
                      aria-haspopup="dialog"
                      aria-expanded={activityId === g.id}
                      onClick={() => toggleActivity(g)}
                    >
                      Activity
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Manage ${grantTitle(g)}`}
                      aria-haspopup="menu"
                      aria-expanded={menu?.id === g.id}
                      disabled={action.pending}
                      onClick={(event) =>
                        setMenu({
                          id: g.id,
                          anchor: event.currentTarget.getBoundingClientRect(),
                        })
                      }
                    >
                      <Ellipsis size={16} />
                    </button>
                    {menu?.id === g.id && (
                      <Popover
                        anchor={menu.anchor}
                        label={`Manage ${grantTitle(g)}`}
                        onClose={() => setMenu(null)}
                      >
                        <div
                          className="popover-actions"
                          role="menu"
                          onClick={() => setMenu(null)}
                        >
                          <button
                            role="menuitem"
                            type="button"
                            className="link-button"
                            aria-expanded={trusting?.id === g.id}
                            onClick={() => openTrust(g)}
                          >
                            How it acts
                          </button>
                          <button
                            role="menuitem"
                            type="button"
                            className="link-button"
                            aria-expanded={hearing === g.id}
                            onClick={() =>
                              setHearing(hearing === g.id ? null : g.id)
                            }
                          >
                            What it hears
                          </button>
                          {g.kind !== "legacy" && (
                            <button
                              role="menuitem"
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
                          {g.suspended_at && !g.reconnect_required && (
                            <button
                              role="menuitem"
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
                              role="menuitem"
                              type="button"
                              className="danger-text"
                              disabled={action.pending}
                              onClick={() => void revoke(g)}
                            >
                              {g.kind === "key" ? "Revoke" : "Disconnect"}
                            </button>
                          )}
                        </div>
                      </Popover>
                    )}
                  </div>
                  {g.kind === "oauth" && (
                    <PluginAiPermission
                      grantId={g.id}
                      grantName={grantTitle(g)}
                    />
                  )}
                  {trusting?.id === g.id && (
                    <SettingsEditor
                      title={`How ${grantTitle(g)} acts`}
                      pending={action.pending}
                      onClose={() => setTrusting(null)}
                    >
                      <TrustEdit
                        grant={g}
                        draft={trusting}
                        onChange={setTrusting}
                        onSave={() => saveTrust(g)}
                        onCancel={() => setTrusting(null)}
                        pending={action.pending}
                      />
                      <OutcomeNote outcome={action.outcome} />
                    </SettingsEditor>
                  )}
                  {hearing === g.id && (
                    <InboxEdit
                      grant={g}
                      report={report}
                      onClose={() => setHearing(null)}
                    />
                  )}
                  {editing?.id === g.id && (
                    <SettingsEditor
                      title={`Tools for ${grantTitle(g)}`}
                      pending={action.pending}
                      onClose={() => setEditing(null)}
                    >
                      <fieldset disabled={action.pending}>
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
                            disabled={action.pending}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </fieldset>
                      <OutcomeNote outcome={action.outcome} />
                    </SettingsEditor>
                  )}
                  {activityId === g.id && open !== undefined && (
                    <SettingsEditor
                      title={`Activity · ${grantTitle(g)}`}
                      pending={action.pending}
                      onClose={() => setActivityId(null)}
                    >
                      <div className="agents-activity" aria-live="polite">
                        {activityFailed[g.id] ? (
                          <>
                            <p role="alert">Couldn't load activity.</p>
                            <button
                              className="secondary"
                              onClick={() => void loadActivity(g.id)}
                            >
                              Retry
                            </button>
                          </>
                        ) : open === null ? (
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
                                            onClick={() => {
                                              setActivityId(null);
                                              openObject({
                                                kind: l.kind,
                                                id: l.id,
                                              });
                                            }}
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
                      <OutcomeNote outcome={action.outcome} />
                    </SettingsEditor>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted agents-empty">No agents connected.</p>
      )}
      {overview &&
        !overviewFailed &&
        grants.length > 0 &&
        matchingGrants.length === 0 && (
          <p className="muted" role="status">
            No matching connections.
          </p>
        )}
      {overview && !overviewFailed && matchingGrants.length > pageSize && (
        <div className="agents-pagination" aria-label="Connection pages">
          <button
            type="button"
            className="secondary"
            disabled={page === 0 || listLocked}
            onClick={() => {
              setConnectionPage(page - 1);
              setMenu(null);
            }}
          >
            Previous
          </button>
          <span role="status">
            {page * pageSize + 1}–
            {Math.min((page + 1) * pageSize, matchingGrants.length)} of{" "}
            {matchingGrants.length}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page === lastPage || listLocked}
            onClick={() => {
              setConnectionPage(page + 1);
              setMenu(null);
            }}
          >
            Next
          </button>
        </div>
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
      {grants.length > 0 && <AgentRules report={report} />}

      {connecting && (
        <SettingsEditor
          title="Connect an agent"
          pending={connectBusy}
          closeDisabled={secretUnsaved}
          onClose={() => setConnecting(false)}
        >
          <ConnectAgent
            url={overview?.mcp_url ?? ""}
            teams={teams}
            open={connecting}
            onOpen={() => setConnecting(true)}
            onCreated={() => void load()}
            onPendingChange={setConnectBusy}
            onSecretUnsaved={setSecretUnsaved}
            report={report}
          />
        </SettingsEditor>
      )}
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
  onPendingChange,
  onSecretUnsaved,
  report,
}: {
  url: string;
  teams: Team[];
  open: boolean;
  onOpen: () => void;
  onCreated: () => void;
  onPendingChange: (pending: boolean) => void;
  onSecretUnsaved: (unsaved: boolean) => void;
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
  const [savedKey, setSavedKey] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const action = useAction(report);
  useEffect(() => {
    onPendingChange(action.pending);
    return () => onPendingChange(false);
  }, [action.pending, onPendingChange]);
  useEffect(() => {
    onSecretUnsaved(!!fresh && !savedKey);
    return () => onSecretUnsaved(false);
  }, [fresh, savedKey, onSecretUnsaved]);
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
      if (!mounted.current) return;
      setSavedKey(false);
      setFresh(made.key);
      setName("");
      onCreated();
    });
  };

  const copy = (text: string, what: string) =>
    void copyText(text).then((ok) => {
      if (!mounted.current) return;
      setCopied(ok ? what : null);
      if (!ok)
        action.setOutcome({
          ok: false,
          text: "Couldn't copy. Select and copy the text manually.",
        });
    });

  return (
    <div className="agents-connect">
      <div className="agents-tabs" role="tablist" aria-label="Which app">
        {AGENT_SETUP_CLIENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={tab === c}
            disabled={action.pending || (!!fresh && !savedKey)}
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
              No key needed. {AGENT_SETUP_LABELS[tab]} signs in with Orbyn; you
              choose its spaces and access. Write access needs another password
              or passkey check.
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
                {!savedKey && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSavedKey(true)}
                  >
                    I've saved the key
                  </button>
                )}
                <button
                  type="button"
                  disabled={!savedKey}
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
                <fieldset disabled={action.pending}>
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
                      disabled={action.pending}
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
                      disabled={action.pending}
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
                </fieldset>
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
          Opens the app with Orbyn's address. It signs in or asks for an agent
          key; the link contains no key.
        </small>
      </div>
    </div>
  );
}
