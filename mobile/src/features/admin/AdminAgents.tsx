import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  LEGACY_KEY_CLIENT_ID,
  type AdminAgentClient,
  type AdminAgentUsage,
  type AgentLimits,
  type AgentSettings,
  type AgentSettingsUpdate,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { InlineDetails } from "../../components/InlineDetails";
import { Pill } from "../../components/Pill";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { timeAgo } from "../progress/progress";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

type Act = (fn: () => Promise<void>) => Promise<void>;

/** The limits, in words, in the order the form shows them (as on the web). */
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
 * Admin console "Agents" segment, as Admin → Agents on the web: the
 * switches for outside AI agents, which websites' apps may connect, blocking
 * an app, limits, and use by app. Changes apply within seconds.
 */
export function AdminAgents({ act, busy }: { act: Act; busy: boolean }) {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [apps, setApps] = useState<AdminAgentClient[] | null>(null);
  const [usage, setUsage] = useState<AdminAgentUsage | null>(null);
  const [hosts, setHosts] = useState("");
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [maxDays, setMaxDays] = useState("");
  const [note, setNote] = useState<{ where: string; text: string } | null>(
    null,
  );

  // Only refresh the saved form; unrelated drafts survive access/app changes.
  const adopt = (s: AgentSettings, saved?: AgentSettingsUpdate) => {
    setSettings(s);
    if (!saved || "allowed_client_hosts" in saved)
      setHosts(s.allowed_client_hosts.join("\n"));
    if (!saved || "agent_limits" in saved || "max_grant_days" in saved) {
      setMaxDays(String(s.max_grant_days));
      setLimits(
        Object.fromEntries(
          LIMITS.map(({ key }) => [key, String(s.agent_limits[key])]),
        ),
      );
    }
  };
  const load = () =>
    act(async () => {
      const [s, a] = await Promise.all([
        client.adminAgentSettings(),
        client.adminAgentClients(),
      ]);
      adopt(s);
      setApps(a);
      // Needs analytics:read; without it the section is simply left out.
      setUsage(await client.adminAgentUsage(30).catch(() => null));
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (body: AgentSettingsUpdate, where: string, done: string) =>
    act(async () => {
      adopt(await client.adminUpdateAgentSettings(body), body);
      setNote({ where, text: done });
    });

  if (!settings)
    return <Text style={shared.small}>Loading agent settings…</Text>;

  const toggle = (
    key:
      | "agents_enabled"
      | "agents_writes_enabled"
      | "dcr_enabled"
      | "mcp_apps_enabled",
    on: boolean,
    confirmOff: string,
  ) => {
    const apply = () =>
      void update({ [key]: on }, "switches", on ? "Turned on." : "Turned off.");
    if (on) apply();
    else confirmAction(confirmOff, "", "Turn off", apply);
  };

  const legacyOn = !settings.blocked_client_ids.includes(LEGACY_KEY_CLIENT_ID);
  const toggleLegacy = (on: boolean) => {
    const blocked = settings.blocked_client_ids.filter(
      (id) => id !== LEGACY_KEY_CLIENT_ID,
    );
    const apply = () =>
      void update(
        {
          blocked_client_ids: on ? blocked : [...blocked, LEGACY_KEY_CLIENT_ID],
        },
        "switches",
        on
          ? "Old API keys reach agents again."
          : "Old API keys no longer reach agents.",
      );
    if (on) apply();
    else
      confirmAction(
        "Stop old personal API keys from reaching agents?",
        "They keep working with the API and CalDAV.",
        "Turn off",
        apply,
      );
  };

  const saveHosts = () => {
    const list = hosts
      .split(/[\n,\s]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    void update(
      { allowed_client_hosts: list },
      "apps",
      list.length
        ? `Only apps from ${list.join(", ")} can connect now.`
        : "Apps from any website can connect.",
    );
  };

  const block = (app: AdminAgentClient, blocked: boolean) => {
    const rest = settings.blocked_client_ids.filter((id) => id !== app.id);
    const apply = () =>
      void act(async () => {
        adopt(
          await client.adminUpdateAgentSettings({
            blocked_client_ids: blocked ? [...rest, app.id] : rest,
          }),
          { blocked_client_ids: blocked ? [...rest, app.id] : rest },
        );
        setApps(await client.adminAgentClients());
        setNote({
          where: "apps",
          text: blocked
            ? `Blocked ${app.name}.`
            : `${app.name} can connect again.`,
        });
      });
    if (!blocked) apply();
    else
      confirmAction(
        `Block ${app.name} (${app.host})?`,
        `Its ${app.connections} connection${app.connections === 1 ? "" : "s"} end at once, and people are told.`,
        "Block app",
        apply,
      );
  };

  const saveLimits = () => {
    const agent_limits = Object.fromEntries(
      LIMITS.map(({ key }) => [key, Number(limits[key])]),
    ) as AgentLimits;
    if (
      Object.values(agent_limits).some((v) => !Number.isInteger(v) || v < 0) ||
      !Number.isInteger(Number(maxDays)) ||
      Number(maxDays) < 1
    ) {
      setNote({ where: "limits", text: "Use whole numbers." });
      return;
    }
    void update(
      { agent_limits, max_grant_days: Number(maxDays) },
      "limits",
      "Saved. Applies within a few seconds.",
    );
  };

  const noteFor = (where: string) =>
    note?.where === where ? (
      <Text style={[shared.small, s.note]}>{note.text}</Text>
    ) : null;

  return (
    <>
      <View style={[shared.card, s.card]}>
        <Text style={s.title}>Outside agents</Text>
        <Text style={[shared.small, s.lead]}>
          Workspace-wide MCP access. Changes apply within seconds.
        </Text>
        <Toggle
          label="Outside agents"
          hint="Off blocks all connections and new sign-ins."
          on={settings.agents_enabled}
          disabled={busy}
          onChange={(on) =>
            toggle(
              "agents_enabled",
              on,
              "Turn outside agents off for everyone? Every connected agent stops at once.",
            )
          }
        />
        <Toggle
          label="Allow changes"
          hint="Off keeps reading available and blocks changes."
          on={settings.agents_writes_enabled}
          disabled={busy}
          onChange={(on) =>
            toggle(
              "agents_writes_enabled",
              on,
              "Freeze every agent's changes? Reading keeps working.",
            )
          }
        />
        <Toggle
          label="App registration"
          hint="Allows apps without website metadata to register."
          on={settings.dcr_enabled}
          disabled={busy}
          onChange={(on) =>
            toggle(
              "dcr_enabled",
              on,
              "Stop apps from registering themselves? Apps that already did keep working.",
            )
          }
        />
        <Toggle
          label="Interactive cards"
          hint="Shows supported previews. Approvals stay in Orbyn."
          on={settings.mcp_apps_enabled}
          disabled={busy}
          onChange={(on) =>
            toggle(
              "mcp_apps_enabled",
              on,
              "Stop showing cards in agents? Their answers stay the same.",
            )
          }
        />
        <Toggle
          label="Legacy API key access"
          hint={
            settings.legacy_keys_until
              ? `Until ${new Date(settings.legacy_keys_until).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}, then never again. They always keep working with the API and CalDAV.`
              : "Their 90 days are over. They keep working with the API and CalDAV."
          }
          on={legacyOn}
          disabled={busy}
          onChange={toggleLegacy}
        />
        {noteFor("switches")}
      </View>

      <View style={[shared.card, s.card]}>
        <Text style={s.title}>Apps</Text>
        <InlineDetails title="Allowed websites">
          <Text style={shared.label}>Only allow apps from these websites</Text>
          <TextInput
            style={[shared.input, s.multiline]}
            value={hosts}
            editable={!busy}
            onChangeText={setHosts}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={"Empty: any website.\nclaude.ai\nchatgpt.com"}
            placeholderTextColor={colors.faint}
            accessibilityLabel="Only allow apps from these websites"
          />
          <Text style={[shared.small, s.lead]}>
            Leave empty to allow any website. Include all app redirect hosts.
          </Text>
          <Button
            secondary
            title="Save websites"
            disabled={busy}
            style={s.flush}
            onPress={saveHosts}
          />
        </InlineDetails>
        {noteFor("apps")}
        {apps === null ? (
          <Text style={shared.small}>Loading apps…</Text>
        ) : apps.length ? (
          <View style={s.list}>
            {apps.map((a, n) => (
              <View key={a.id} style={[s.row, n > 0 && s.divider]}>
                <View style={s.rowMain}>
                  <View style={s.rowTitle}>
                    <Text style={[s.name, { flexShrink: 1 }]}>{a.name}</Text>
                    {a.blocked && <Pill label="Blocked" tone="danger" />}
                  </View>
                  <Text style={shared.small}>
                    {a.host} ·{" "}
                    {a.kind === "cimd" ? "Its website" : "Registered itself"}
                  </Text>
                  <Text style={shared.small}>
                    {a.connections} connection{a.connections === 1 ? "" : "s"} ·{" "}
                    {a.last_used_at
                      ? `used ${timeAgo(a.last_used_at)}`
                      : "never used"}
                  </Text>
                </View>
                <SmallAction
                  label={a.blocked ? "Unblock" : "Block"}
                  destructive={!a.blocked}
                  disabled={busy}
                  onPress={() => block(a, !a.blocked)}
                />
              </View>
            ))}
          </View>
        ) : (
          <Text style={shared.small}>No app has signed in yet.</Text>
        )}
      </View>

      <View style={[shared.card, s.card]}>
        <Text style={s.title}>Limits</Text>
        <InlineDetails
          title="Connection limits"
          reveal={note?.where === "limits"}
        >
          <NumberField
            disabled={busy}
            label="Connection lifetime (days)"
            value={maxDays}
            onChange={setMaxDays}
          />
          {LIMITS.map(({ key, label }) => (
            <NumberField
              key={key}
              disabled={busy}
              label={label}
              value={limits[key] ?? ""}
              onChange={(v) => setLimits((l) => ({ ...l, [key]: v }))}
            />
          ))}
          <Button
            title="Save limits"
            disabled={busy}
            style={s.flush}
            onPress={saveLimits}
          />
          {noteFor("limits")}
        </InlineDetails>
      </View>

      {usage && (
        <View style={[shared.card, s.card]}>
          <Text style={s.title}>Use by app</Text>
          <Text style={[shared.small, s.lead]}>
            Last {usage.days} days. People who turned usage analytics off aren’t
            counted.
          </Text>
          {usage.apps.length ? (
            <View style={s.list}>
              {usage.apps.map((u, n) => (
                <View
                  key={`${u.kind}-${u.app}`}
                  style={[s.row, n > 0 && s.divider]}
                >
                  <View style={s.rowMain}>
                    <Text style={s.name}>{u.app}</Text>
                    <Text style={shared.small}>
                      {u.people} {u.people === 1 ? "person" : "people"} ·{" "}
                      {u.calls} calls · {u.writes} changes
                    </Text>
                    {(u.denied > 0 || u.limited > 0) && (
                      <Text style={shared.small}>
                        {u.denied} refused · {u.limited} over limits
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={shared.small}>No agent use yet.</Text>
          )}
        </View>
      )}
    </>
  );
}

function Toggle({
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
    <View style={s.toggle}>
      <View style={s.rowMain}>
        <Text style={s.name}>{label}</Text>
        <Text style={shared.small}>{hint}</Text>
      </View>
      <Switch
        value={on}
        disabled={disabled}
        trackColor={{ true: colors.accent }}
        accessibilityLabel={label}
        onValueChange={onChange}
      />
    </View>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <View style={s.field}>
      <Text style={[shared.small, s.fieldLabel]}>{label}</Text>
      <TextInput
        style={[shared.input, s.number]}
        value={value}
        editable={!disabled}
        onChangeText={onChange}
        keyboardType="number-pad"
        accessibilityLabel={label}
        maxLength={9}
      />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: { marginBottom: 16, gap: 10 },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    lead: { lineHeight: 19 },
    note: { color: colors.accent },
    flush: { marginBottom: 0 },
    multiline: { minHeight: 90, textAlignVertical: "top", paddingTop: 13 },
    toggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 6,
    },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rowMain: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    field: { flexDirection: "row", alignItems: "center", gap: 12 },
    fieldLabel: { flex: 1 },
    number: { width: 96, textAlign: "right" },
  }),
);
