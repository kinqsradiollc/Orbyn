import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_SETUP_CLIENTS,
  AGENT_SETUP_LABELS,
  AGENT_SOON_CLIENTS,
  agentExpiryText,
  agentSetup,
  type AgentAccess,
  type AgentActivity,
  type AgentGrant,
  type AgentSetupClient,
  type AgentsOverview,
  type Team,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { Field } from "../components/Field";
import { Pill } from "../components/Pill";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { shareText } from "../lib/planning";
import { timeAgo } from "../lib/progress";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const ACCESS_TAG: Record<AgentAccess, string> = {
  read: "See",
  suggest: "Suggest",
  write: "Change",
};
const EXPIRY_CHOICES = [7, 30, 90, 365];

/** "Personal, Design team"; old API keys reach every team, now and later. */
const spacesText = (g: AgentGrant) =>
  g.team_ids === null
    ? g.personal
      ? "Personal and every team"
      : "Every team"
    : [...(g.personal ? ["Personal"] : []), ...g.teams.map((t) => t.name)].join(
        ", ",
      ) || "No spaces";

/**
 * Settings → Connections → Connected agents, on the phone: the AI agents
 * let into Orbyn over MCP (agent keys, and old API keys used there), what
 * each did, revoking, and how to connect one. They see only what you can.
 */
export function ConnectedAgentsCard({
  busy,
  run,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<unknown>;
}) {
  const [overview, setOverview] = useState<AgentsOverview | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activity, setActivity] = useState<
    Record<string, AgentActivity[] | null>
  >({});
  const [tab, setTab] = useState<AgentSetupClient>("claude-code");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<AgentAccess>("read");
  const [personal, setPersonal] = useState(true);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [hideOutside, setHideOutside] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const reload = async () => setOverview(await client.agents());
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

  const revoke = (g: AgentGrant) => {
    const legacy = g.kind === "legacy";
    // Asked in a way that also works in the web build (Alert doesn't there).
    confirmAction(
      legacy ? `Disconnect ${g.name} from agents?` : `Revoke ${g.name}?`,
      legacy
        ? "It keeps working with the API and CalDAV."
        : "The agent using it stops working at once.",
      legacy ? "Disconnect" : "Revoke",
      () =>
        void run(async () => {
          await client.revokeAgent(g.id);
          animateLayout();
          await reload();
        }),
    );
  };

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
          AI agents you’ve let into Orbyn, like Claude Code, Codex and Cursor.
          They can only see what you can, in the spaces you choose.
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
                  {g.kind === "legacy"
                    ? `API key “${g.name}”`
                    : `Agent key “${g.name}”`}
                </Text>
                <View style={s.tags}>
                  <Pill label="See" tone="accent" />
                  {g.access !== "read" && (
                    <Pill label={ACCESS_TAG[g.access]} tone="accent" />
                  )}
                  <Pill label={spacesText(g)} />
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
                <View style={s.actions}>
                  <SmallAction
                    label={open !== undefined ? "Hide activity" : "Activity"}
                    disabled={busy}
                    onPress={() => toggleActivity(g)}
                  />
                  {g.suspended_at && (
                    <SmallAction
                      label="Restore"
                      disabled={busy}
                      onPress={() => restore(g)}
                    />
                  )}
                  <SmallAction
                    destructive
                    label={g.kind === "legacy" ? "Disconnect" : "Revoke"}
                    disabled={busy}
                    onPress={() => revoke(g)}
                  />
                </View>
                {open !== undefined && (
                  <FadeIn style={s.activity}>
                    {open === null ? (
                      <Text style={shared.small}>Loading…</Text>
                    ) : open.length ? (
                      open.slice(0, 30).map((a) => (
                        <View key={a.id} style={s.activityRow}>
                          <Text style={[shared.small, s.activityTime]}>
                            {timeAgo(a.at)}
                          </Text>
                          <Text style={[shared.small, s.flex]}>
                            {a.summary}
                            {a.outcome === "ok"
                              ? ""
                              : a.outcome === "denied"
                                ? " · refused"
                                : ` · ${a.outcome}`}
                          </Text>
                        </View>
                      ))
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
          {AGENT_SOON_CLIENTS.map((c) => (
            <Chip
              key={c}
              label={`${c} · soon`}
              selected={false}
              disabled
              onPress={() => {}}
            />
          ))}
        </ChipRow>

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
                (access === "read"
                  ? ""
                  : " For now agents can only read; changes arrive soon.")
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
            <View style={s.switchRow}>
              <View style={s.flex}>
                <Text style={shared.label}>Hide outside content</Text>
                <Text style={shared.small}>
                  Leave out text from outside Orbyn: subscribed calendars,
                  imported files, tasks sent by email and what booking guests
                  typed. The agent sees that something is there, not what it
                  says.
                </Text>
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
    activity: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.input,
      padding: 10,
      gap: 6,
    },
    activityRow: { flexDirection: "row", gap: 10 },
    activityTime: { width: 64, color: colors.muted },
    flex: { flex: 1 },
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
  }),
);
