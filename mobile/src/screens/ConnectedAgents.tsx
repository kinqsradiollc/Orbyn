import { SettingsSection } from "./settings/SettingsSection";
import { PluginAiPermission } from "./PluginAiPermission";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { BottomSheet } from "../components/BottomSheet";
import { MoreMenu } from "../components/MoreMenu";
import { ErrorBanner } from "../components/ErrorBanner";
import { InlineDetails } from "../components/InlineDetails";
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
import { Pressable } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { AgentRulesCard, InboxPanel } from "./AgentInbox";

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
  disabled = false,
}: {
  value: AgentToolset[];
  onChange: (next: AgentToolset[]) => void;
  bookings: boolean;
  disabled?: boolean;
}) {
  const shown = OPTIONAL_TOOLSETS.filter((t) => bookings || t !== "booking");
  return (
    <Field
      label="Tools"
      hint={`${AGENT_TOOLSET_LABELS.core.name} are always on.`}
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
              disabled={disabled}
              onPress={() =>
                onChange(on ? value.filter((x) => x !== t) : [...value, t])
              }
            />
          );
        })}
      </ChipRow>
      <InlineDetails title="About these tools">
        {shown.map((t) => (
          <Text key={t} style={shared.small}>
            {AGENT_TOOLSET_LABELS[t].name}: {AGENT_TOOLSET_LABELS[t].blurb}
          </Text>
        ))}
      </InlineDetails>
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
    <BottomSheet
      visible
      title="Agent permissions"
      closeDisabled={busy}
      onClose={onCancel}
    >
      {!changes ? (
        <Text style={shared.small}>
          {grant.access === "read"
            ? "Read only. Reconnect to allow changes."
            : "Changes need your review. Reconnect to allow more."}
        </Text>
      ) : (
        <>
          {assistantGrant && (
            <Text style={shared.small}>
              {grant.name} is built in and cannot be disconnected. You can lower
              its access; protected actions still need approval.
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
                  disabled={busy || (assistantGrant && t === "full")}
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
                      disabled={busy}
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
                      disabled={busy}
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
          disabled={busy}
          style={s.flexButton}
          onPress={onCancel}
        />
      </View>
    </BottomSheet>
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

/** Each still-visible target touched by a job, once. */
const jobLinks = (job: AgentJob): AgentActivityLink[] => {
  const seen = new Set<string>();
  const out: AgentActivityLink[] = [];
  for (const row of job.rows)
    for (const l of row.links ?? []) {
      const key = `${l.kind}:${l.id}`;
      if (seen.has(key)) continue;
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
function LinkChip({
  link,
  onOpen,
}: {
  link: AgentActivityLink;
  onOpen?: () => void;
}) {
  const concept = link.kind === "doc" ? "page" : link.kind;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${link.title || "Untitled"}`}
      onPress={onOpen ?? (() => openAppUrl(`orbyn://${link.kind}/${link.id}`))}
      style={s.link}
    >
      <Icon name={CONCEPT_ICON[concept]} size={13} color={colors.accent} />
      <Text style={s.linkText}>{link.title || "Untitled"}</Text>
    </Pressable>
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
  onPermissionBusyChange,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<unknown>;
  /** Opens a proposal an agent made in Review. */
  onOpenReview?: (proposalId: string) => void;
  onPermissionBusyChange?: (grantId: string, busy: boolean) => void;
}) {
  const [overview, setOverview] = useState<AgentsOverview | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const activityExitAction = useRef<(() => void) | null>(null);
  const leaveActivity = (next?: () => void) => {
    if (busy) return;
    activityExitAction.current = next ?? null;
    setActivityOpen(false);
  };
  const [connectionQuery, setConnectionQuery] = useState("");
  const [connectionGroup, setConnectionGroup] = useState<"external" | "orbyn">(
    "external",
  );
  const [connectionPage, setConnectionPage] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [keyPending, setKeyPending] = useState(false);
  const keyMutation = useRef(false);
  const [connectionHelpOpen, setConnectionHelpOpen] = useState(false);
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

  const mounted = useRef(true);
  const readEpoch = useRef(0);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [activityError, setActivityError] = useState<Record<string, string>>(
    {},
  );
  const activityPending = useRef(false);
  const reload = useCallback(async () => {
    const epoch = ++readEpoch.current;
    setLoading(true);
    try {
      const [next, availableTeams] = await Promise.all([
        client.agents(),
        client.listTeams(),
      ]);
      if (!mounted.current || readEpoch.current !== epoch) return;
      setOverview(next);
      setTeams(availableTeams);
      setReadError("");
    } catch (error) {
      if (mounted.current && readEpoch.current === epoch)
        setReadError(
          error instanceof Error ? error.message : "Couldn't load agents.",
        );
    } finally {
      if (mounted.current && readEpoch.current === epoch) setLoading(false);
    }
  }, []);
  const blocked = busy || loading || !!readError;

  const openTrust = (g: AgentGrant) => {
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
      if (!mounted.current) return;
      setTrusting(null);
      await reload();
    });
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      ++readEpoch.current;
    };
  }, [reload]);

  const url = overview?.mcp_url || "https://mcp.orbyn.dev/mcp";
  const setup = agentSetup(tab, url, fresh ?? undefined);

  const loadActivity = (g: AgentGrant) => {
    if (busy || activityPending.current) return;
    activityPending.current = true;
    setActivity((value) => ({ ...value, [g.id]: null }));
    setActivityError((value) => ({ ...value, [g.id]: "" }));
    void run(async () => {
      try {
        const value = await client.agentActivity(g.id);
        if (mounted.current) setActivity((all) => ({ ...all, [g.id]: value }));
      } catch (error) {
        if (mounted.current)
          setActivityError((all) => ({
            ...all,
            [g.id]:
              error instanceof Error
                ? error.message
                : "Couldn't load activity.",
          }));
      }
    }).finally(() => {
      activityPending.current = false;
    });
  };
  const toggleActivity = (g: AgentGrant) => {
    if (blocked || activityPending.current) return;
    setActivityId(g.id);
    setActivityOpen(true);
    loadActivity(g);
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
          if (!mounted.current) return;
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
          if (!mounted.current) return;
          setActivity((all) => ({ ...all, [g.id]: list }));
          showToast({
            text: undone === 1 ? "Undid 1 change." : `Undid ${undone} changes.`,
          });
        }),
      false,
    );

  const toggleJob = (key: string) => {
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
          onPress={() => leaveActivity(() => onOpenReview(a.proposal_id!))}
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
                onPress={() =>
                  leaveActivity(() => onOpenReview(row.proposal_id!))
                }
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
              <LinkChip
                key={`${l.kind}:${l.id}`}
                link={l}
                onOpen={() =>
                  leaveActivity(() => openAppUrl(`orbyn://${l.kind}/${l.id}`))
                }
              />
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
          await reload();
        }),
    );
  };

  const saveTools = () =>
    void run(async () => {
      if (!editing) return;
      await client.setAgentToolsets(editing.id, editing.toolsets);
      if (!mounted.current) return;
      setEditing(null);
      await reload();
    });

  const restore = (g: AgentGrant) =>
    void run(async () => {
      await client.restoreAgent(g.id);
      await reload();
    });

  const make = () => {
    if (blocked || keyMutation.current) return;
    if (!personal && !teamIds.length) {
      setConnectError("Choose at least one space.");
      return;
    }
    keyMutation.current = true;
    setKeyPending(true);
    setConnectError("");
    void run(async () => {
      try {
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
        setFresh(made.key);
        setMaking(false);
        setName("");
        await reload();
      } catch (error) {
        if (mounted.current)
          setConnectError("Couldn't create the key. Try again.");
        throw error;
      } finally {
        keyMutation.current = false;
        if (mounted.current) setKeyPending(false);
      }
    });
  };

  const grants = (overview?.grants ?? []).filter((grant) =>
    connectionGroup === "orbyn"
      ? grant.kind === "assistant"
      : grant.kind !== "assistant",
  );
  const listLocked =
    blocked || !!editing || !!trusting || !!hearing || !!activityId;
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
  const shownGrants = matchingGrants.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );
  return (
    <>
      <View style={shared.card}>
        <Text style={[shared.small, s.gap]}>
          Choose what connected agents can access.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: connectionHelpOpen }}
          onPress={() => {
            setConnectionHelpOpen(!connectionHelpOpen);
          }}
          style={s.connectionHelp}
        >
          <Text style={shared.small}>How connections work</Text>
          <Icon
            name={connectionHelpOpen ? "chevronDown" : "chevronRight"}
            size={16}
            color={colors.muted}
          />
        </Pressable>
        {connectionHelpOpen && (
          <Text style={[shared.small, s.gap]}>
            Agents use their own AI and only access the spaces you allow. Review
            permissions when connecting and disconnect at any time.
          </Text>
        )}
        <View
          style={[s.actions, s.wrap]}
          accessibilityLabel="Connection category"
        >
          {(["external", "orbyn"] as const).map((group) => (
            <Button
              key={group}
              title={
                group === "external" ? "Connected apps" : "Orbyn assistant"
              }
              secondary={connectionGroup !== group}
              disabled={listLocked}
              onPress={() => {
                setConnectionGroup(group);
                setConnectionPage(0);
                setConnectionQuery("");
              }}
            />
          ))}
        </View>
        {!!grants.length && (
          <View style={s.gap}>
            <Text style={shared.label}>Find a connection</Text>
            <TextInput
              accessibilityLabel="Find a connection"
              placeholder="Name or space"
              style={shared.input}
              value={connectionQuery}
              editable={!listLocked}
              onChangeText={(value) => {
                setConnectionQuery(value);
                setConnectionPage(0);
              }}
            />
          </View>
        )}
        <ErrorBanner error={readError} />
        {!!readError && (
          <Button
            title="Retry agents"
            secondary
            disabled={busy || loading}
            onPress={() => void reload()}
          />
        )}
        {overview === null ? (
          <Text style={shared.small}>
            {loading ? "Loading agents…" : "Agents unavailable."}
          </Text>
        ) : grants.length ? (
          shownGrants.map((g) => {
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
                {g.reconnect_required && (
                  <Text style={shared.small}>
                    Sign in to Orbyn again from {g.client_name || g.name} to
                    reconnect.
                  </Text>
                )}
                {g.suspended_at && !g.reconnect_required && (
                  <Text style={shared.small}>
                    Paused after repeated access or usage failures. Check
                    activity before restoring or revoking it.
                  </Text>
                )}
                <View style={[s.actions, s.wrap]}>
                  <SmallAction
                    label={open !== undefined ? "Hide activity" : "Activity"}
                    disabled={blocked}
                    onPress={() => toggleActivity(g)}
                  />
                  <MoreMenu
                    label={`${grantTitle(g)} options`}
                    title={grantTitle(g)}
                    disabled={blocked}
                    actions={[
                      { label: "Permissions", onPress: () => openTrust(g) },
                      {
                        label: "Inbox",
                        onPress: () =>
                          setHearing(hearing === g.id ? null : g.id),
                      },
                      ...(g.kind !== "legacy" && g.kind !== "assistant"
                        ? [
                            {
                              label: "Tools",
                              onPress: () =>
                                setEditing({
                                  id: g.id,
                                  toolsets: g.toolsets.filter(
                                    (t) => t !== "core",
                                  ),
                                }),
                            },
                          ]
                        : []),
                      ...(g.suspended_at && !g.reconnect_required
                        ? [
                            {
                              label: "Restore agent",
                              onPress: () => restore(g),
                            },
                          ]
                        : []),
                      ...(g.kind !== "assistant"
                        ? [
                            {
                              label:
                                g.kind === "legacy" || g.kind === "oauth"
                                  ? "Disconnect"
                                  : "Revoke key",
                              destructive: true,
                              onPress: () => revoke(g),
                            },
                          ]
                        : []),
                    ]}
                  />
                </View>
                {hearing === g.id && (
                  <InboxPanel
                    grant={g}
                    busy={busy}
                    run={run}
                    onClose={() => {
                      setHearing(null);
                    }}
                  />
                )}
                {g.kind === "oauth" && (
                  <PluginAiPermission
                    grantId={g.id}
                    onBusyChange={onPermissionBusyChange}
                  />
                )}
                {trusting?.id === g.id && (
                  <TrustPanel
                    grant={g}
                    draft={trusting}
                    onChange={setTrusting}
                    onSave={() => saveTrust(g)}
                    onCancel={() => {
                      setTrusting(null);
                    }}
                    busy={busy}
                  />
                )}
                {editing?.id === g.id && (
                  <BottomSheet
                    visible
                    title="Agent tools"
                    closeDisabled={busy}
                    onClose={() => {
                      if (!busy) setEditing(null);
                    }}
                  >
                    <ToolsetChips
                      value={editing.toolsets}
                      disabled={busy}
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
                        disabled={busy}
                        style={s.flexButton}
                        onPress={() => setEditing(null)}
                      />
                    </View>
                  </BottomSheet>
                )}
                {activityId === g.id && open !== undefined && (
                  <BottomSheet
                    visible={activityOpen}
                    title={`Activity · ${grantTitle(g)}`}
                    closeDisabled={busy}
                    onClose={() => leaveActivity()}
                    afterClose={() => {
                      const next = activityExitAction.current;
                      activityExitAction.current = null;
                      setActivityId(null);
                      next?.();
                    }}
                  >
                    <View style={s.activity}>
                      <ErrorBanner error={activityError[g.id]} />
                      {activityError[g.id] && (
                        <Button
                          title="Retry activity"
                          secondary
                          disabled={busy}
                          onPress={() => loadActivity(g)}
                        />
                      )}
                      {open === null ? (
                        <Text style={shared.small}>
                          {activityError[g.id]
                            ? "Activity unavailable."
                            : "Loading activity…"}
                        </Text>
                      ) : open.length ? (
                        groupAgentActivity(open).map((job, n) =>
                          jobView(g, job, n === 0),
                        )
                      ) : (
                        <Text style={shared.small}>Nothing yet.</Text>
                      )}
                    </View>
                  </BottomSheet>
                )}
              </View>
            );
          })
        ) : (
          <Text style={shared.small}>No agents connected.</Text>
        )}
      </View>

      {overview &&
        !readError &&
        grants.length > 0 &&
        matchingGrants.length === 0 && (
          <Text style={shared.small}>No matching connections.</Text>
        )}
      {overview && !readError && matchingGrants.length > pageSize && (
        <View style={s.actions}>
          <Button
            title="Previous"
            secondary
            disabled={page === 0 || listLocked}
            onPress={() => setConnectionPage(page - 1)}
          />
          <Text style={shared.small}>
            {page * pageSize + 1}–
            {Math.min((page + 1) * pageSize, matchingGrants.length)} of{" "}
            {matchingGrants.length}
          </Text>
          <Button
            title="Next"
            secondary
            disabled={page === lastPage || listLocked}
            onPress={() => setConnectionPage(page + 1)}
          />
        </View>
      )}

      {!!overview?.grants.length && (
        <>
          <SettingsSection title="Standing rules" disabled={busy}>
            <AgentRulesCard busy={busy} run={run} showHeading={false} />
          </SettingsSection>
        </>
      )}

      <Button
        title="Connect an agent"
        icon="plus"
        disabled={blocked}
        onPress={() => {
          setConnectError("");
          setConnecting(true);
        }}
      />
      <BottomSheet
        visible={connecting}
        title="Connect an agent"
        closeDisabled={busy || keyPending || !!fresh}
        onClose={() => {
          if (!busy && !keyMutation.current && !fresh) setConnecting(false);
        }}
      >
        <View style={s.connectForm}>
          <ErrorBanner error={connectError} />
          <ChipRow label="Which app">
            {AGENT_SETUP_CLIENTS.map((c) => (
              <Chip
                key={c}
                label={AGENT_SETUP_LABELS[c]}
                selected={tab === c}
                disabled={busy || keyPending || making}
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
                No key needed. Choose its spaces and access. Write access needs
                another password or passkey check.
              </Text>
            </>
          ) : (
            <>
              <Text style={[shared.label, s.step]}>1. Make an agent key</Text>
              {fresh ? (
                <View style={s.secret}>
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
                </View>
              ) : making ? (
                <View style={s.connectForm}>
                  <Field label="Name">
                    <TextInput
                      style={shared.input}
                      value={name}
                      editable={!busy && !keyPending}
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
                          disabled={busy || keyPending}
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
                        disabled={busy || keyPending}
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
                            disabled={busy || keyPending}
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
                          disabled={busy || keyPending}
                          onPress={() => setDays(d)}
                        />
                      ))}
                    </ChipRow>
                  </Field>
                  <ToolsetChips
                    value={toolsets}
                    disabled={busy || keyPending}
                    bookings
                    onChange={setToolsets}
                  />
                  <View style={s.switchRow}>
                    <View style={s.flex}>
                      <Text style={shared.label}>Hide outside content</Text>
                      <Text style={shared.small}>
                        {AGENT_HIDE_OUTSIDE_TEXT}
                      </Text>
                    </View>
                    <Switch
                      value={hideOutside}
                      disabled={busy || keyPending}
                      onValueChange={setHideOutside}
                      trackColor={{ true: colors.accent }}
                      accessibilityLabel="Hide outside content"
                    />
                  </View>
                  <Button
                    title="Make key"
                    icon="key"
                    style={s.last}
                    disabled={blocked || keyPending}
                    onPress={make}
                  />
                  <Button
                    title="Cancel key"
                    secondary
                    disabled={busy || keyPending}
                    onPress={() => setMaking(false)}
                  />
                </View>
              ) : (
                <Button
                  secondary
                  title="Make a key"
                  disabled={blocked || keyPending}
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
            Open this link on your computer. It signs in or asks for an agent
            key; the link contains no key.
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
      </BottomSheet>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    eyebrow: {
      marginTop: 8,
      fontSize: 13,
      letterSpacing: 0,
      textTransform: "none",
    },
    gap: { marginBottom: 12 },
    connectionHelp: {
      minHeight: controls.tap,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 8,
    },
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
    connectForm: { gap: 12 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "center",
    },
    wrap: { flexWrap: "wrap" },
    activity: { gap: 6 },
    activityRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "center",
    },
    activityTime: { width: 64, color: colors.muted },
    job: { gap: 6 },
    jobDivider: {
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    jobText: { color: colors.text },
    // Under the words, past the time column (64 + the row's gap).
    indent: { paddingLeft: 0 },
    links: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    link: {
      // 34pt drawn, 44pt to a finger through hitSlop.
      minHeight: controls.tap,
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
    flex: { flex: 1, minWidth: 120 },
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
    flexButton: { flex: 1, minWidth: 120, marginBottom: 0 },
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
