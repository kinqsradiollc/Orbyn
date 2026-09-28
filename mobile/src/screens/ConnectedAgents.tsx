import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_ASK_FIRST,
  AGENT_ASK_FIRST_LABELS,
  AGENT_NEVER,
  AGENT_TRUST,
  AGENT_TRUST_LABELS,
  AGENT_HIDE_OUTSIDE_TEXT,
  AGENT_SETUP_CLIENTS,
  AGENT_TOOLSETS,
  AGENT_TOOLSET_LABELS,
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
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { Field } from "../components/Field";
import { Icon, CONCEPT_ICON } from "../components/Icon";
import { Pill } from "../components/Pill";
import { SmallAction } from "../components/SmallAction";
import { showToast } from "../components/Toast";
import { openAppUrl } from "../hooks/useAppLinks";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { openReview } from "../lib/review";
import { shareText } from "../lib/planning";
import { timeAgo } from "../lib/progress";
import { FadeIn, PressableScale, animateLayout } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { AgentRulesCard, InboxPanel } from "./AgentInbox";
import { AgentWarmStartCards } from "./AgentContext";

/** What a connection can do, in a word or two, for its badge. */
const ACCESS_TAG: Record<AgentAccess, string> = {
  read: "Can see",
  suggest: "Can suggest",
  write: "Can make changes",
};
const EXPIRY_CHOICES = [7, 30, 90, 365];

/** Toolsets besides core (which every connection has). */
const OPTIONAL_TOOLSETS = AGENT_TOOLSETS.filter(
  (t) => t !== "core",
) as AgentToolset[];

/** "Planner, Study", or core only. */
const toolsetsText = (g: AgentGrant) => {
  const extra = g.toolsets.filter((t) => t !== "core");
  return extra.length
    ? extra.map((t) => AGENT_TOOLSET_LABELS[t].name).join(", ")
    : "Core tools only";
};

/** Chips to choose toolsets, each with what it adds below. */
function ToolsetChips({
  value,
  onChange,
  bookings,
}: {
  value: AgentToolset[];
  onChange: (next: AgentToolset[]) => void;
  bookings: boolean;
}) {
  const shown = OPTIONAL_TOOLSETS.filter((t) => bookings || t !== "booking");
  return (
    <Field
      label="Tools"
      hint={`${AGENT_TOOLSET_LABELS.core.name} are always on. ${shown
        .filter((t) => value.includes(t))
        .map(
          (t) =>
            `${AGENT_TOOLSET_LABELS[t].name}: ${AGENT_TOOLSET_LABELS[t].blurb}`,
        )
        .join(" ")}`}
    >
      <ChipRow label="Tools" multi>
        {shown.map((t) => {
          const on = value.includes(t);
          return (
            <Chip
              key={t}
              multi
              label={AGENT_TOOLSET_LABELS[t].name}
              selected={on}
              onPress={() =>
                onChange(on ? value.filter((x) => x !== t) : [...value, t])
              }
            />
          );
        })}
      </ChipRow>
    </Field>
  );
}

/** Short names for the trust levels, as tags. */
const TRUST_TAG: Record<AgentTrust, string> = {
  full: "Full power",
  ask: "Asks first",
  suggest: "Suggests",
};

/** What "How it acts" is changing. */
type TrustDraft = {
  id: string;
  trust: AgentTrust;
  /** "personal" or a team id → its own level ("" = same as the default). */
  spaces: Record<string, AgentTrust | "">;
  actsAlone: AgentAskFirst[];
};

/**
 * How a connection acts: its trust, per space where it differs, and which
 * ask-first items it may do alone (a switch each: on = asks first).
 */
function TrustPanel({
  grant,
  draft,
  onChange,
  onSave,
  onCancel,
  busy,
}: {
  grant: AgentGrant;
  draft: TrustDraft;
  onChange: (next: TrustDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
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
    <FadeIn style={s.activity}>
      {!changes ? (
        <Text style={shared.small}>
          {grant.access === "read"
            ? "It can only read. To let it change things, connect it again and allow changes."
            : "It can only suggest: every change waits in your Review inbox. To give it more, connect it again and allow changes."}
        </Text>
      ) : (
        <>
          {assistantGrant && (
            <Text style={shared.small}>
              {grant.name} is built in, so it cannot be disconnected. Its trust
              can only be lowered. Protected actions stay ask-first.
            </Text>
          )}
          <Field
            label="How much it does alone"
            hint={AGENT_TRUST_LABELS[draft.trust].blurb}
          >
            <ChipRow label="How much it does alone">
              {trustChoices.map((t) => (
                <Chip
                  key={t}
                  label={`${AGENT_TRUST_LABELS[t].name}${assistantGrant && t === "full" ? " · current" : ""}`}
                  selected={draft.trust === t}
                  disabled={assistantGrant && t === "full"}
                  onPress={() => onChange({ ...draft, trust: t })}
                />
              ))}
            </ChipRow>
          </Field>
          {!assistantGrant &&
            spaces.length > 1 &&
            spaces.map((sp) => (
              <Field key={sp.id} label={sp.name}>
                <ChipRow label={`In ${sp.name}`}>
                  {(
                    ["", ...AGENT_TRUST.filter((t) => t !== draft.trust)] as (
                      AgentTrust | ""
                    )[]
                  ).map((t) => (
                    <Chip
                      key={t || "same"}
                      compact
                      label={t ? TRUST_TAG[t] : "Same"}
                      selected={(draft.spaces[sp.id] ?? "") === t}
                      onPress={() =>
                        onChange({
                          ...draft,
                          spaces: { ...draft.spaces, [sp.id]: t },
                        })
                      }
                    />
                  ))}
                </ChipRow>
              </Field>
            ))}
          {!assistantGrant && draft.trust === "full" && (
            <>
              <Text style={shared.label}>
                At full power it still asks first about
              </Text>
              {AGENT_ASK_FIRST.map((k) => {
                const asks = !draft.actsAlone.includes(k);
                return (
                  <View key={k} style={s.switchRow}>
                    <View style={s.flex}>
                      <Text style={s.askName}>
                        {AGENT_ASK_FIRST_LABELS[k].name}
                      </Text>
                      <Text style={shared.small}>
                        {asks ? "Asks first" : "Acts alone"} ·{" "}
                        {AGENT_ASK_FIRST_LABELS[k].blurb}
                      </Text>
                    </View>
                    <Switch
                      value={asks}
                      onValueChange={(on) =>
                        onChange({
                          ...draft,
                          actsAlone: on
                            ? draft.actsAlone.filter((x) => x !== k)
                            : [...draft.actsAlone, k],
                        })
                      }
                      trackColor={{ true: colors.accent }}
                      accessibilityLabel={`${AGENT_ASK_FIRST_LABELS[k].name}: asks first`}
                    />
                  </View>
                );
              })}
            </>
          )}
        </>
      )}
      <Text style={shared.small}>Never through an agent: {AGENT_NEVER}</Text>
      <View style={s.actions}>
        {changes && (
          <Button
            title="Save"
            style={s.flexButton}
            disabled={busy}
            onPress={onSave}
          />
        )}
        <Button
          secondary
          title={changes ? "Cancel" : "Close"}
          style={s.flexButton}
          onPress={onCancel}
        />
      </View>
    </FadeIn>
  );
}

/** "Personal, Design team"; old API keys reach every team, now and later. */
const spacesText = (g: AgentGrant) =>
  g.team_ids === null
    ? g.personal
      ? "Personal and every team"
      : "Every team"
    : [...(g.personal ? ["Personal"] : []), ...g.teams.map((t) => t.name)].join(
        ", ",
      ) || "No spaces";

/** What a job touched that still opens, each once, at most five. */
const jobLinks = (job: AgentJob): AgentActivityLink[] => {
  const seen = new Set<string>();
  const out: AgentActivityLink[] = [];
  for (const row of job.rows)
    for (const l of row.links ?? []) {
      const key = `${l.kind}:${l.id}`;
      if (seen.has(key) || out.length >= 5) continue;
      seen.add(key);
      out.push(l);
    }
  return out;
};

/** One call's outcome after its words: " · refused", " · undone". */
const outcomeText = (a: AgentActivity) =>
  (a.outcome === "ok"
    ? ""
    : a.outcome === "denied"
      ? " · refused"
      : ` · ${a.outcome}`) + (a.undone_at ? " · undone" : "");

/** Something a job touched, as a small link that opens it in the app. */
function LinkChip({ link }: { link: AgentActivityLink }) {
  const concept = link.kind === "doc" ? "page" : link.kind;
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`Open ${link.title || "Untitled"}`}
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={() => openAppUrl(`orbyn://${link.kind}/${link.id}`)}
      style={s.link}
    >
      <Icon name={CONCEPT_ICON[concept]} size={13} color={colors.accent} />
      <Text style={s.linkText} numberOfLines={1}>
        {link.title || "Untitled"}
      </Text>
    </PressableScale>
  );
}

/** A connection's title in the list. */
const grantTitle = (g: AgentGrant) =>
  g.kind === "assistant"
    ? g.name
    : g.kind === "legacy"
      ? `API key “${g.name}”`
      : g.kind === "key"
        ? `Agent key “${g.name}”`
        : g.client_name || "An app";

/**
 * Settings → Connections → Connected agents, on the phone: the AI agents
 * let into Orbyn over MCP (agent keys, and old API keys used there), what
 * each did, revoking, and how to connect one. They see only what you can.
 */
export function ConnectedAgentsCard({
  busy,
  run,
  onOpenReview = openReview,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<unknown>;
  /** Opens a proposal an agent made in Review. */
  onOpenReview?: (proposalId: string) => void;
}) {
  const [overview, setOverview] = useState<AgentsOverview | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activity, setActivity] = useState<
    Record<string, AgentActivity[] | null>
  >({});
  // Jobs opened to their single changes, by "<grant>:<job>".
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<AgentSetupClient>("claude");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  // New connections start at full power (see AGENT_TRUST).
  const [access, setAccess] = useState<AgentAccess>("write");
  const [personal, setPersonal] = useState(true);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [hideOutside, setHideOutside] = useState(false);
  const [toolsets, setToolsets] = useState<AgentToolset[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  /** The connection whose tools are being changed, and the choice so far. */
  const [editing, setEditing] = useState<{
    id: string;
    toolsets: AgentToolset[];
  } | null>(null);

  /** The connection whose trust is being changed, and the choice so far. */
  const [trusting, setTrusting] = useState<TrustDraft | null>(null);
  /** The connection whose inbox choices (kinds, wake-up) are open. */
  const [hearing, setHearing] = useState<string | null>(null);

  const reload = async () => setOverview(await client.agents());

  const openTrust = (g: AgentGrant) => {
    animateLayout();
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
  };

  const saveTrust = (g: AgentGrant) =>
    void run(async () => {
      if (!trusting) return;
      const d = trusting;
      const reach = [
        ...(g.personal ? ["personal"] : []),
        ...g.teams.map((t) => t.id),
      ];
      await client.setAgentTrust(d.id, {
        trust: d.trust,
        spaces: Object.fromEntries(
          reach.map((id) => [id, d.spaces[id] ? d.spaces[id] : null]),
        ),
        acts_alone: d.actsAlone,
      });
      animateLayout();
      setTrusting(null);
      await reload();
    });
  useEffect(() => {
    void run(async () => {
      const [o, t] = await Promise.all([client.agents(), client.listTeams()]);
      setOverview(o);
      setTeams(t);
    });
  }, [run]);

  const url = overview?.mcp_url || "https://mcp.orbyn.dev/mcp";
  const setup = agentSetup(tab, url, fresh ?? undefined);

  const toggleActivity = (g: AgentGrant) => {
    animateLayout();
    if (activity[g.id] !== undefined) {
      setActivity(({ [g.id]: _open, ...rest }) => rest);
      return;
    }
    setActivity((a) => ({ ...a, [g.id]: null }));
    void run(async () => {
      const list = await client.agentActivity(g.id);
      setActivity((a) => ({ ...a, [g.id]: list }));
    });
  };

  // Take back one change an agent made directly (kept 30 days; refused if
  // the thing changed since).
  const undo = (g: AgentGrant, a: AgentActivity) =>
    confirmAction(
      `Undo “${a.summary}”?`,
      "Orbyn puts things back as they were before this change. If something changed since, it stays as it is.",
      "Undo",
      () =>
        void run(async () => {
          await client.undoAgentChange(a.id);
          const list = await client.agentActivity(g.id);
          animateLayout();
          setActivity((all) => ({ ...all, [g.id]: list }));
        }),
      false,
    );

  // Take back every change of one job at once (all or nothing: refused if
  // anything in it changed since).
  const undoJob = (g: AgentGrant, job: AgentJob) =>
    confirmAction(
      "Undo this whole job?",
      "Orbyn puts back every change in it as it was before. If something changed since, nothing is undone.",
      "Undo job",
      () =>
        void run(async () => {
          const { undone } = await client.undoAgentJob(g.id, job.job!);
          const list = await client.agentActivity(g.id);
          animateLayout();
          setActivity((all) => ({ ...all, [g.id]: list }));
          showToast({
            text: undone === 1 ? "Undid 1 change." : `Undid ${undone} changes.`,
          });
        }),
      false,
    );

  const toggleJob = (key: string) => {
    animateLayout();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** One change, with its own Review and Undo. */
  const changeRow = (g: AgentGrant, a: AgentActivity, time: boolean) => (
    <View key={a.id} style={s.activityRow}>
      <Text style={[shared.small, s.activityTime]}>
        {time ? timeAgo(a.at) : ""}
      </Text>
      <Text style={[shared.small, s.flex]}>
        {a.summary}
        {outcomeText(a)}
      </Text>
      {a.proposal_id && onOpenReview && (
        <SmallAction
          label="Review"
          disabled={busy}
          onPress={() => onOpenReview(a.proposal_id!)}
        />
      )}
      {a.undoable && (
        <SmallAction label="Undo" disabled={busy} onPress={() => undo(g, a)} />
      )}
    </View>
  );

  /**
   * One job: when, what it did in plain words, what it touched, and undoing
   * it whole; a job of several calls opens to each change.
   */
  const jobView = (g: AgentGrant, job: AgentJob, first: boolean) => {
    const key = `${g.id}:${job.id}`;
    const single = job.rows.length === 1;
    const row = job.rows[0];
    const links = jobLinks(job);
    const undoable = job.rows.filter((r) => r.undoable).length;
    const open = expanded.has(key);
    const words =
      job.changes > 0 ? agentJobText(grantTitle(g), job.kinds) : null;
    return (
      <View key={key} style={[s.job, !first && s.jobDivider]}>
        {single && !words ? (
          changeRow(g, row, true)
        ) : (
          <View style={s.activityRow}>
            <Text style={[shared.small, s.activityTime]}>
              {timeAgo(job.at)}
            </Text>
            <Text style={[shared.small, s.flex, s.jobText]}>
              {words ?? row.summary}
              {single
                ? outcomeText(row)
                : job.rows.every((r) => r.undone_at)
                  ? " · undone"
                  : ""}
            </Text>
            {single && row.proposal_id && onOpenReview && (
              <SmallAction
                label="Review"
                disabled={busy}
                onPress={() => onOpenReview(row.proposal_id!)}
              />
            )}
            {single && row.undoable && (
              <SmallAction
                label="Undo"
                disabled={busy}
                onPress={() => undo(g, row)}
              />
            )}
          </View>
        )}
        {links.length > 0 && (
          <View style={[s.indent, s.links]}>
            {links.map((l) => (
              <LinkChip key={`${l.kind}:${l.id}`} link={l} />
            ))}
          </View>
        )}
        {!single && (
          <View style={[s.indent, s.jobActions]}>
            <SmallAction
              label={open ? "Hide changes" : `See ${job.rows.length} changes`}
              disabled={false}
              onPress={() => toggleJob(key)}
            />
            {!!job.job && undoable > 1 && (
              <SmallAction
                label="Undo job"
                disabled={busy}
                onPress={() => undoJob(g, job)}
              />
            )}
          </View>
        )}
        {!single && open && (
          <View style={s.jobRows}>
            {job.rows.map((a) => changeRow(g, a, false))}
          </View>
        )}
      </View>
    );
  };

  const revoke = (g: AgentGrant) => {
    const legacy = g.kind === "legacy";
    const app = g.kind === "oauth";
    // Asked in a way that also works in the web build (Alert doesn't there).
    confirmAction(
      legacy
        ? `Disconnect ${g.name} from agents?`
        : app
          ? `Disconnect ${grantTitle(g)}?`
          : `Revoke ${g.name}?`,
      legacy
        ? "It keeps working with the API and CalDAV."
        : app
          ? "It stops working at once, and has to ask you again to reconnect."
          : "The agent using it stops working at once.",
      legacy || app ? "Disconnect" : "Revoke",
      () =>
        void run(async () => {
          await client.revokeAgent(g.id);
          animateLayout();
          await reload();
        }),
    );
  };

  const saveTools = () =>
    void run(async () => {
      if (!editing) return;
      await client.setAgentToolsets(editing.id, editing.toolsets);
      animateLayout();
      setEditing(null);
      await reload();
    });

  const restore = (g: AgentGrant) =>
    void run(async () => {
      await client.restoreAgent(g.id);
      animateLayout();
      await reload();
    });

  const make = () =>
    void run(async () => {
      if (!personal && !teamIds.length)
        throw new Error("Choose at least one space: Personal or a team.");
      const made = await client.createAgentKey({
        name: name.trim() || `${AGENT_SETUP_LABELS[tab]} key`,
        access,
        personal,
        team_ids: teamIds,
        expires_in_days: days,
        hide_outside_content: hideOutside,
        toolsets: ["core", ...toolsets],
      });
      animateLayout();
      setFresh(made.key);
      setMaking(false);
      setName("");
      await reload();
    });

  const grants = overview?.grants ?? [];
  return (
    <>
      <Text style={[shared.eyebrow, s.eyebrow]}>CONNECTED AGENTS</Text>
      <View style={shared.card}>
        <Text style={[shared.small, s.gap]}>
          AI agents you’ve let into Orbyn, like Claude, ChatGPT, Claude Code and
          Codex. They can only see what you can, in the spaces you choose.
        </Text>
        {overview === null ? (
          <Text style={shared.small}>Loading…</Text>
        ) : grants.length ? (
          grants.map((g) => {
            const expiry = agentExpiryText(g.expires_at);
            const open = activity[g.id];
            return (
              <View key={g.id} style={s.row}>
                <Text style={s.rowTitle}>
                  {grantTitle(g)}
                  {g.client_host ? (
                    <Text style={shared.small}> · {g.client_host}</Text>
                  ) : null}
                </Text>
                <View style={s.tags}>
                  <Pill label={ACCESS_TAG[g.access]} tone="accent" />
                  {g.access === "write" && (
                    <Pill label={TRUST_TAG[g.trust]} tone="accent" />
                  )}
                  {g.access === "write" &&
                    Object.keys(g.space_trust).length > 0 && (
                      <Pill label="Differs by space" />
                    )}
                  <Pill label={spacesText(g)} />
                  {g.kind !== "legacy" && g.kind !== "assistant" && (
                    <Pill label={toolsetsText(g)} />
                  )}
                  {g.hide_outside_content && (
                    <Pill label="Outside content hidden" />
                  )}
                  {g.suspended_at && (
                    <Pill label="Paused by Orbyn" tone="danger" />
                  )}
                  {g.kind === "legacy"
                    ? overview.legacy_keys_until && (
                        <Pill
                          label={`Works here until ${new Date(overview.legacy_keys_until).toLocaleDateString([], { day: "numeric", month: "short" })}`}
                          tone="warning"
                        />
                      )
                    : expiry && (
                        <Pill
                          label={expiry}
                          tone={expiry === "Expired" ? "danger" : "warning"}
                        />
                      )}
                  <Pill
                    label={
                      g.last_used_at
                        ? `Used ${timeAgo(g.last_used_at)}`
                        : "Not used yet"
                    }
                  />
                </View>
                {g.suspended_at && (
                  <Text style={shared.small}>
                    Orbyn paused it because it kept going over its limits or
                    asking for things it can’t reach. Check its activity, then
                    restore it or revoke it.
                  </Text>
                )}
                <View style={[s.actions, s.wrap]}>
                  <SmallAction
                    label={open !== undefined ? "Hide activity" : "Activity"}
                    disabled={busy}
                    onPress={() => toggleActivity(g)}
                  />
                  <SmallAction
                    label="How it acts"
                    disabled={busy}
                    onPress={() => openTrust(g)}
                  />
                  <SmallAction
                    label="What it hears"
                    disabled={busy}
                    onPress={() => {
                      animateLayout();
                      setHearing(hearing === g.id ? null : g.id);
                    }}
                  />
                  {g.kind !== "legacy" && g.kind !== "assistant" && (
                    <SmallAction
                      label={editing?.id === g.id ? "Close tools" : "Tools"}
                      disabled={busy}
                      onPress={() => {
                        animateLayout();
                        setEditing(
                          editing?.id === g.id
                            ? null
                            : {
                                id: g.id,
                                toolsets: g.toolsets.filter(
                                  (t) => t !== "core",
                                ),
                              },
                        );
                      }}
                    />
                  )}
                  {g.suspended_at && (
                    <SmallAction
                      label="Restore"
                      disabled={busy}
                      onPress={() => restore(g)}
                    />
                  )}
                  {g.kind !== "assistant" && (
                    <SmallAction
                      destructive
                      label={
                        g.kind === "legacy" || g.kind === "oauth"
                          ? "Disconnect"
                          : "Revoke"
                      }
                      disabled={busy}
                      onPress={() => revoke(g)}
                    />
                  )}
                </View>
                {hearing === g.id && (
                  <InboxPanel
                    grant={g}
                    busy={busy}
                    run={run}
                    onClose={() => {
                      animateLayout();
                      setHearing(null);
                    }}
                  />
                )}
                {trusting?.id === g.id && (
                  <TrustPanel
                    grant={g}
                    draft={trusting}
                    onChange={setTrusting}
                    onSave={() => saveTrust(g)}
                    onCancel={() => {
                      animateLayout();
                      setTrusting(null);
                    }}
                    busy={busy}
                  />
                )}
                {editing?.id === g.id && (
                  <FadeIn style={s.activity}>
                    <ToolsetChips
                      value={editing.toolsets}
                      bookings={
                        g.kind === "key" || g.toolsets.includes("booking")
                      }
                      onChange={(next) =>
                        setEditing({ id: g.id, toolsets: next })
                      }
                    />
                    {g.kind === "oauth" && !g.toolsets.includes("booking") && (
                      <Text style={shared.small}>
                        Bookings need {g.client_name || "the app"} to ask for
                        them when it signs in again.
                      </Text>
                    )}
                    <View style={s.actions}>
                      <Button
                        title="Save"
                        style={s.flexButton}
                        disabled={busy}
                        onPress={saveTools}
                      />
                      <Button
                        secondary
                        title="Cancel"
                        style={s.flexButton}
                        onPress={() => setEditing(null)}
                      />
                    </View>
                  </FadeIn>
                )}
                {open !== undefined && (
                  <FadeIn style={s.activity}>
                    {open === null ? (
                      <Text style={shared.small}>Loading…</Text>
                    ) : open.length ? (
                      groupAgentActivity(open)
                        .slice(0, 30)
                        .map((job, n) => jobView(g, job, n === 0))
                    ) : (
                      <Text style={shared.small}>Nothing yet.</Text>
                    )}
                  </FadeIn>
                )}
              </View>
            );
          })
        ) : (
          <Text style={shared.small}>No agents yet.</Text>
        )}
      </View>

      <Text style={[shared.eyebrow, s.eyebrow]}>ABOUT YOU</Text>
      <AgentWarmStartCards busy={busy} run={run} />

      {!!overview?.grants.length && (
        <>
          <Text style={[shared.eyebrow, s.eyebrow]}>STANDING RULES</Text>
          <AgentRulesCard busy={busy} run={run} />
        </>
      )}

      <Text style={[shared.eyebrow, s.eyebrow]}>CONNECT AN AGENT</Text>
      <View style={shared.card}>
        <ChipRow label="Which app">
          {AGENT_SETUP_CLIENTS.map((c) => (
            <Chip
              key={c}
              label={AGENT_SETUP_LABELS[c]}
              selected={tab === c}
              onPress={() => setTab(c)}
            />
          ))}
        </ChipRow>

        {isSignInClient(tab) ? (
          <>
            <Text style={[shared.label, s.step]}>1. {setup.where}</Text>
            <Text selectable style={s.code}>
              {setup.snippet}
            </Text>
            <SmallAction
              label="Copy or share"
              disabled={false}
              onPress={() => void shareText(setup.snippet)}
            />
            {AGENT_SIGN_IN_STEPS[tab as keyof typeof AGENT_SIGN_IN_STEPS].map(
              (step, i) => (
                <Text key={step} style={[shared.small, s.step]}>
                  {i + 2}. {step}
                </Text>
              ),
            )}
            <Text style={[shared.small, s.step]}>
              No key needed: Orbyn asks you what it may do and in which spaces.
              Giving it write access asks for your password or passkey again.
            </Text>
          </>
        ) : (
          <>
            <Text style={[shared.label, s.step]}>1. Make an agent key</Text>
            {fresh ? (
              <FadeIn style={s.secret}>
                <Text style={shared.label}>
                  Copy it now, it won’t be shown again
                </Text>
                <Text selectable style={s.code}>
                  {fresh}
                </Text>
                <View style={s.actions}>
                  <Button
                    title="Copy or share"
                    icon="share"
                    style={s.flexButton}
                    onPress={() => void shareText(fresh)}
                  />
                  <Button
                    secondary
                    title="Done"
                    style={s.flexButton}
                    onPress={() => setFresh(null)}
                  />
                </View>
              </FadeIn>
            ) : making ? (
              <>
                <Field label="Name">
                  <TextInput
                    style={shared.input}
                    value={name}
                    onChangeText={setName}
                    maxLength={80}
                    placeholder={`Like “MacBook · ${AGENT_SETUP_LABELS[tab]}”`}
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="Agent key name"
                  />
                </Field>
                <Field
                  label="What it may do"
                  hint={
                    AGENT_ACCESS_LABELS[access].blurb +
                    (access === "write"
                      ? " Change how much it does alone later with “How it acts”."
                      : "")
                  }
                >
                  <ChipRow label="What it may do">
                    {AGENT_ACCESS.map((a) => (
                      <Chip
                        key={a}
                        label={AGENT_ACCESS_LABELS[a].name}
                        selected={access === a}
                        onPress={() => setAccess(a)}
                      />
                    ))}
                  </ChipRow>
                </Field>
                <Field label="In these spaces">
                  <ChipRow label="Spaces" multi>
                    <Chip
                      multi
                      label="Personal"
                      selected={personal}
                      onPress={() => setPersonal(!personal)}
                    />
                    {teams.map((t) => {
                      const on = teamIds.includes(t.id);
                      return (
                        <Chip
                          key={t.id}
                          multi
                          label={t.name}
                          selected={on}
                          onPress={() =>
                            setTeamIds(
                              on
                                ? teamIds.filter((x) => x !== t.id)
                                : [...teamIds, t.id],
                            )
                          }
                        />
                      );
                    })}
                  </ChipRow>
                </Field>
                <Field label="Lasts">
                  <ChipRow label="Lasts">
                    {EXPIRY_CHOICES.map((d) => (
                      <Chip
                        key={d}
                        label={d === 365 ? "A year" : `${d} days`}
                        selected={days === d}
                        onPress={() => setDays(d)}
                      />
                    ))}
                  </ChipRow>
                </Field>
                <ToolsetChips
                  value={toolsets}
                  bookings
                  onChange={setToolsets}
                />
                <View style={s.switchRow}>
                  <View style={s.flex}>
                    <Text style={shared.label}>Hide outside content</Text>
                    <Text style={shared.small}>{AGENT_HIDE_OUTSIDE_TEXT}</Text>
                  </View>
                  <Switch
                    value={hideOutside}
                    onValueChange={setHideOutside}
                    trackColor={{ true: colors.accent }}
                    accessibilityLabel="Hide outside content"
                  />
                </View>
                <Button
                  title="Make key"
                  icon="key"
                  style={s.last}
                  disabled={busy}
                  onPress={make}
                />
              </>
            ) : (
              <Button
                secondary
                title="Make a key"
                icon="key"
                style={s.last}
                onPress={() => setMaking(true)}
              />
            )}

            <Text style={[shared.label, s.step]}>2. {setup.where}</Text>
            <Text selectable style={s.code}>
              {setup.snippet}
            </Text>
            <SmallAction
              label="Copy or share"
              disabled={false}
              onPress={() => void shareText(setup.snippet)}
            />
          </>
        )}

        <Text style={[shared.label, s.step]}>Or add Orbyn in one click</Text>
        <Text style={[shared.small, s.gap]}>
          These apps run on a computer: send yourself the link and open it
          there. The app then signs in with Orbyn, or asks for an agent key. No
          key is ever part of the link.
        </Text>
        {agentInstallLinks(url).map((l) => (
          <View key={l.app} style={s.installRow}>
            <Text style={[shared.label, s.flex]}>{l.label}</Text>
            <SmallAction
              label="Share link"
              disabled={false}
              onPress={() => void shareText(l.href)}
            />
          </View>
        ))}
      </View>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    eyebrow: { marginTop: 8 },
    gap: { marginBottom: 12 },
    row: {
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: 8,
    },
    rowTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    actions: { flexDirection: "row", gap: 10, alignItems: "center" },
    wrap: { flexWrap: "wrap" },
    activity: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.input,
      padding: 10,
      gap: 6,
    },
    activityRow: { flexDirection: "row", gap: 10, alignItems: "center" },
    activityTime: { width: 64, color: colors.muted },
    job: { gap: 6 },
    jobDivider: {
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    jobText: { color: colors.text },
    // Under the words, past the time column (64 + the row's gap).
    indent: { paddingLeft: 74 },
    links: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    link: {
      // 34pt drawn, 44pt to a finger through hitSlop.
      minHeight: controls.tap - 10,
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    linkText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
    jobActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    jobRows: { gap: 6 },
    flex: { flex: 1 },
    askName: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 14,
    },
    flexButton: { flex: 1, marginBottom: 0 },
    step: { marginTop: 14, marginBottom: 8 },
    secret: {
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 12,
      marginBottom: 6,
    },
    code: {
      fontFamily: "Menlo",
      fontSize: 13,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: radii.input,
      padding: 10,
      marginBottom: 10,
    },
    last: { marginBottom: 0 },
    installRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  }),
);
