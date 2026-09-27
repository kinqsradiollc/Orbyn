import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
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
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { Field } from "../components/Field";
import { MoreMenu } from "../components/MoreMenu";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { shareText } from "../lib/planning";
import { timeAgo } from "../lib/progress";
import { FadeIn } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

type Run = (fn: () => Promise<void>) => Promise<unknown>;

/**
 * Connected agents → "What it hears" on the phone (H0): which kinds of
 * things go to this agent (a switch each), and the address that wakes it
 * when something happens. The wake-up carries only a count and a link.
 */
export function InboxPanel({
  grant,
  busy,
  run,
  onClose,
}: {
  grant: AgentGrant;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<AgentInboxSettings | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void run(async () => {
      const s = await client.agentInbox(grant.id);
      setSettings(s);
      setUrl(s.wake_url ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant.id]);

  const toggle = (kind: AgentInboxKind, on: boolean) => {
    if (!settings) return;
    const muted = on
      ? settings.muted.filter((k) => k !== kind)
      : [...settings.muted, kind];
    setSettings({ ...settings, muted });
    void run(async () => {
      setSettings(await client.setAgentInboxMutes(grant.id, muted));
    });
  };

  const saveWake = () =>
    void run(async () => {
      const made = await client.setAgentWake(grant.id, url.trim());
      setSettings(made.settings);
      setSecret(made.secret);
      setNote(null);
    });

  const testWake = () =>
    void run(async () => {
      const r = await client.testAgentWake(grant.id);
      setSettings(await client.agentInbox(grant.id));
      setNote(
        r.ok
          ? `The address answered ${r.status}.`
          : (r.error ?? "The address didn’t answer."),
      );
    });

  const removeWake = () =>
    void run(async () => {
      setSettings(await client.clearAgentWake(grant.id));
      setUrl("");
      setSecret(null);
      setNote("It won’t be woken any more.");
    });

  if (!settings)
    return (
      <FadeIn style={s.panel}>
        <Text style={shared.small}>Loading…</Text>
      </FadeIn>
    );
  return (
    <FadeIn style={s.panel}>
      <Text style={shared.small}>
        What happens in Orbyn goes to this agent first, only from the spaces it
        reaches.{" "}
        {settings.unread
          ? `${settings.unread} ${settings.unread === 1 ? "thing waits" : "things wait"} for it now.`
          : "Nothing waits for it now."}
      </Text>
      <Text style={shared.label}>Send to this agent</Text>
      {AGENT_INBOX_KINDS.map((k) => {
        const on = !settings.muted.includes(k);
        return (
          <View key={k} style={s.switchRow}>
            <View style={s.flex}>
              <Text style={s.name}>{AGENT_INBOX_KIND_LABELS[k].name}</Text>
              <Text style={shared.small}>
                {AGENT_INBOX_KIND_LABELS[k].blurb}
              </Text>
            </View>
            <Switch
              value={on}
              disabled={busy}
              onValueChange={(next) => toggle(k, next)}
              trackColor={{ true: colors.accent }}
              accessibilityLabel={`Send ${AGENT_INBOX_KIND_LABELS[k].name.toLowerCase()} to this agent`}
            />
          </View>
        );
      })}
      <Field
        label="Wake this agent when something happens"
        hint={`For agents that run on a schedule. Orbyn sends a signed call with how many things wait and where to read them, never what they say, at most every ${AGENT_WAKE_MINUTES} minutes.`}
      >
        <TextInput
          style={shared.input}
          value={url}
          onChangeText={setUrl}
          maxLength={500}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Wake-up address"
        />
      </Field>
      {secret && (
        <FadeIn style={s.secret}>
          <Text style={shared.label}>
            Signing secret: copy it now, it won’t be shown again
          </Text>
          <Text selectable style={s.code}>
            {secret}
          </Text>
          <SmallAction
            label="Copy or share"
            disabled={false}
            onPress={() => void shareText(secret)}
          />
        </FadeIn>
      )}
      {settings.wake_url && (
        <View style={s.statusRow}>
          <Text style={[shared.small, s.flex]}>
            {settings.wake_last_sent_at
              ? `Last woken ${timeAgo(settings.wake_last_sent_at)}`
              : "Not woken yet"}
            {settings.wake_last_error
              ? ` · ${settings.wake_last_error}`
              : settings.wake_last_status
                ? ` · answered ${settings.wake_last_status}`
                : ""}
          </Text>
          <SmallAction label="Test" disabled={busy} onPress={testWake} />
          <SmallAction
            destructive
            label="Remove"
            disabled={busy}
            onPress={removeWake}
          />
        </View>
      )}
      {note && <Text style={shared.small}>{note}</Text>}
      <View style={s.actions}>
        <Button
          title="Save address"
          style={s.flexButton}
          disabled={busy || !url.trim()}
          onPress={saveWake}
        />
        <Button
          secondary
          title="Close"
          style={s.flexButton}
          onPress={onClose}
        />
      </View>
    </FadeIn>
  );
}

const KIND_CHOICES: (AgentInboxKind | "")[] = ["", ...AGENT_INBOX_KINDS];
const kindText = (k: AgentInboxKind | "" | null) =>
  k ? AGENT_INBOX_KIND_LABELS[k].name : "Everything";

/**
 * Standing rules for every agent, in plain words, for everything or one
 * kind of thing. Agents get them with each item in their inbox.
 */
export function AgentRulesCard({ busy, run }: { busy: boolean; run: Run }) {
  const [rules, setRules] = useState<AgentRule[] | null>(null);
  const [editing, setEditing] = useState<{
    id: string | null;
    kind: AgentInboxKind | "";
    text: string;
  } | null>(null);

  const load = async () => setRules(await client.agentRules());
  useEffect(() => {
    void run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!editing?.text.trim()) return;
    const d = editing;
    void run(async () => {
      const input = { kind: d.kind || null, text: d.text.trim() };
      if (d.id) await client.updateAgentRule(d.id, input);
      else await client.addAgentRule(input);
      setEditing(null);
      await load();
    });
  };

  const remove = (r: AgentRule) =>
    confirmAction(
      `Remove “${r.text}”?`,
      "Your agents stop following it.",
      "Remove",
      () =>
        void run(async () => {
          await client.deleteAgentRule(r.id);
          await load();
        }),
    );

  return (
    <View style={shared.card}>
      <Text style={shared.label}>Standing rules</Text>
      <Text style={[shared.small, s.gap]}>
        Plain rules every agent follows when something reaches it, like “Always
        accept bookings from my team”.
      </Text>
      {rules === null ? (
        <Text style={shared.small}>Loading…</Text>
      ) : (
        rules.map((r) => (
          <View key={r.id} style={s.ruleRow}>
            <View style={s.flex}>
              <Text style={shared.small}>{kindText(r.kind)}</Text>
              <Text style={s.ruleText}>{r.text}</Text>
            </View>
            <MoreMenu
              label="Rule options"
              title={r.text}
              disabled={busy}
              actions={[
                {
                  label: "Change",
                  onPress: () =>
                    setEditing({ id: r.id, kind: r.kind ?? "", text: r.text }),
                },
                {
                  label: "Remove",
                  destructive: true,
                  onPress: () => remove(r),
                },
              ]}
            />
          </View>
        ))
      )}
      {editing ? (
        <FadeIn style={s.panel}>
          <Field label="Applies to">
            <ChipRow label="Applies to">
              {KIND_CHOICES.map((k) => (
                <Chip
                  key={k || "all"}
                  compact
                  label={kindText(k)}
                  selected={editing.kind === k}
                  onPress={() => setEditing({ ...editing, kind: k })}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label="Rule">
            <TextInput
              style={shared.input}
              value={editing.text}
              onChangeText={(text) => setEditing({ ...editing, text })}
              maxLength={500}
              multiline
              placeholder="Always accept bookings from my team"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Rule"
            />
          </Field>
          <View style={s.actions}>
            <Button
              title={editing.id ? "Save" : "Add rule"}
              style={s.flexButton}
              disabled={busy || !editing.text.trim()}
              onPress={save}
            />
            <Button
              secondary
              title="Cancel"
              style={s.flexButton}
              onPress={() => setEditing(null)}
            />
          </View>
        </FadeIn>
      ) : (
        rules &&
        rules.length < MAX_AGENT_RULES && (
          <Button
            secondary
            title="Add a rule"
            icon="plus"
            style={s.last}
            onPress={() => setEditing({ id: null, kind: "", text: "" })}
          />
        )
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    panel: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.input,
      padding: 10,
      gap: 8,
    },
    flex: { flex: 1 },
    gap: { marginBottom: 10 },
    name: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 6,
    },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    actions: { flexDirection: "row", gap: 10, alignItems: "center" },
    flexButton: { flex: 1, marginBottom: 0 },
    secret: {
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 12,
      gap: 6,
    },
    code: {
      fontFamily: "Menlo",
      fontSize: 13,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: radii.input,
      padding: 10,
    },
    ruleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    ruleText: { fontSize: 15, color: colors.text, fontFamily: fonts.regular },
    last: { marginBottom: 0, marginTop: 10 },
  }),
);
