import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  MAX_AGENT_INSTRUCTIONS,
  type AgentContextSettings,
  type PersonalAgentSettings,
  type AgentInstructions,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { SmallAction } from "../components/SmallAction";
import { openAppUrl } from "../hooks/useAppLinks";
import { client } from "../lib/api";
import { timeAgo } from "../lib/progress";
import { FadeIn } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { NightShift } from "./NightShift";
import { ReminderNudges } from "./ReminderNudges";

type Run = (fn: () => Promise<void>) => Promise<unknown>;

/**
 * Connected agents on the phone → "About me for agents" and "Instructions"
 * (H8): the page every agent reads first (an ordinary Personal page, made
 * here on first use) and a few lines per space that agents follow there.
 * A team's are shared by its members' agents; viewers only read them.
 */
export function AgentWarmStartCards({
  busy,
  run,
}: {
  busy: boolean;
  run: Run;
}) {
  const [data, setData] = useState<AgentContextSettings | null>(null);
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [editing, setEditing] = useState<{
    team_id: string | null;
    text: string;
  } | null>(null);

  const load = async () => setData(await client.agentContext());
  useEffect(() => {
    void run(load);
    void run(async () => {
      const value = await client.agentSettings();
      setIdentity(value);
      setIdentityName(value.name);
      setIdentityPersona(value.persona);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProfile = () =>
    void run(async () => {
      const made = await client.openAgentProfile();
      openAppUrl(`orbyn://doc/${made.doc_id}`);
      await load();
    });

  const save = () => {
    if (!editing) return;
    const d = editing;
    void run(async () => {
      setData(await client.setAgentInstructions(d.team_id, d.text.trim()));
      setEditing(null);
    });
  };

  const saveIdentity = () => {
    void run(async () => {
      const value = await client.updateAgentSettings({
        name: identityName.trim(),
        persona: identityPersona,
      });
      setIdentity(value);
    });
  };

  const row = (i: AgentInstructions) => (
    <View key={i.team_id ?? "personal"} style={s.row}>
      <View style={s.flex}>
        <Text style={shared.small}>{i.space}</Text>
        <Text style={[s.text, !i.text && s.none]}>{i.text || "None yet"}</Text>
        {!!i.text && !!i.updated_at && (
          <Text style={shared.small}>
            {i.updated_by ?? "Someone"}
            {i.updated_via ? ` via ${i.updated_via}` : ""},{" "}
            {timeAgo(i.updated_at)}
          </Text>
        )}
      </View>
      {i.can_edit && (
        <SmallAction
          label="Change"
          disabled={busy}
          onPress={() => setEditing({ team_id: i.team_id, text: i.text })}
        />
      )}
    </View>
  );

  const editingSpace = editing
    ? data?.instructions.find((i) => i.team_id === editing.team_id)?.space
    : null;

  return (
    <>
      <NightShift busy={busy} run={run} />
      <ReminderNudges busy={busy} run={run} />
      <View style={shared.card}>
        <Text style={shared.label}>Your assistant</Text>
        <Text style={[shared.small, s.gap]}>
          The name your assistant goes by, and how it should come across.
        </Text>
        <Field label="Name">
          <TextInput
            value={identityName}
            onChangeText={setIdentityName}
            maxLength={40}
            autoCapitalize="words"
            placeholder="Orbyn"
            placeholderTextColor={colors.faint}
            style={shared.input}
          />
        </Field>
        <Field label="Persona (optional)">
          <TextInput
            value={identityPersona}
            onChangeText={setIdentityPersona}
            maxLength={1000}
            multiline
            style={[shared.input, s.area]}
            placeholder="Warm, direct, and concise"
            placeholderTextColor={colors.faint}
          />
        </Field>
        <Button
          title="Save"
          onPress={saveIdentity}
          disabled={busy || identity === null || !identityName.trim()}
          style={s.last}
        />
      </View>
      <View style={shared.card}>
        <Text style={shared.label}>About me for agents</Text>
        <Text style={[shared.small, s.gap]}>
          One page your agents read before they help: your courses and exams,
          how you like notes and cards, when you study and for how long. Change
          it like any page; your agents can fill it in too.
        </Text>
        <Button
          secondary
          title={data?.profile ? "Open the page" : "Make the page"}
          icon="fileText"
          style={s.last}
          disabled={busy || data === null}
          onPress={openProfile}
        />
        {!!data?.profile && (
          <Text style={[shared.small, s.after]}>
            Changed {timeAgo(data.profile.updated_at)}
          </Text>
        )}
      </View>
      <View style={shared.card}>
        <Text style={shared.label}>Instructions</Text>
        <Text style={[shared.small, s.gap]}>
          A few lines agents follow in each space, like “In Biology, cards are
          cloze”. A team’s instructions are shared by every member’s agents.
        </Text>
        {data === null ? (
          <Text style={shared.small}>Loading…</Text>
        ) : (
          data.instructions.map(row)
        )}
        {editing && (
          <FadeIn style={s.panel}>
            <Field label={`Instructions for ${editingSpace ?? "this space"}`}>
              <TextInput
                style={[shared.input, s.area]}
                value={editing.text}
                onChangeText={(text) => setEditing({ ...editing, text })}
                maxLength={MAX_AGENT_INSTRUCTIONS}
                multiline
                placeholder={
                  editing.team_id
                    ? "In this team, cards are cloze and notes cite the slides."
                    : "Keep answers short. Plan study in the evenings."
                }
                placeholderTextColor={colors.faint}
                accessibilityLabel="Instructions"
              />
            </Field>
            <View style={s.actions}>
              <Button
                title="Save"
                style={s.flexButton}
                disabled={busy}
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
        )}
      </View>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    panel: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.input,
      padding: 10,
      gap: 8,
      marginTop: 10,
    },
    flex: { flex: 1 },
    gap: { marginBottom: 10 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    text: { fontSize: 15, color: colors.text, fontFamily: fonts.regular },
    none: { color: colors.muted },
    area: { minHeight: 80, textAlignVertical: "top" },
    actions: { flexDirection: "row", gap: 10, alignItems: "center" },
    flexButton: { flex: 1, marginBottom: 0 },
    last: { marginBottom: 0 },
    after: { marginTop: 8 },
  }),
);
