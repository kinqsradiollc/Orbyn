import { SettingsSection } from "./settings/SettingsSection";
import { Character } from "../components/Character";
import { CharacterEditor } from "../components/CharacterEditor";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  MAX_AGENT_INSTRUCTIONS,
  characterAppearance,
  CHARACTER_PERSONAS,
  type AgentContextSettings,
  type AutomationAgentIdentity,
  type AutomationAgentLane,
  type AgentInstructions,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { BottomSheet } from "../components/BottomSheet";
import { ErrorBanner } from "../components/ErrorBanner";
import { InlineDetails } from "../components/InlineDetails";
import { Field } from "../components/Field";
import { Segmented } from "../components/Segmented";
import { SmallAction } from "../components/SmallAction";
import { openAppUrl } from "../hooks/useAppLinks";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { timeAgo } from "../lib/progress";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { NightShift } from "./NightShift";
import { ReminderNudges } from "./ReminderNudges";

type Run = (fn: () => Promise<void>) => Promise<unknown>;

/**
 * Connected agents on the phone → "Agent context" and "Instructions"
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
  const [identity, setIdentity] = useState<AutomationAgentIdentity | null>(
    null,
  );
  const [lane, setLane] = useState<AutomationAgentLane>("background");
  const [editingLook, setEditingLook] = useState(false);
  const [reload, setReload] = useState(0);
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [appearance, setAppearance] = useState(() => characterAppearance({}));
  const [editing, setEditing] = useState<{
    team_id: string | null;
    text: string;
  } | null>(null);

  const mounted = useRef(true);
  const contextEpoch = useRef(0);
  const identityEpoch = useRef(0);
  const [contextError, setContextError] = useState("");
  const [identityError, setIdentityError] = useState("");
  const load = useCallback(async () => {
    const epoch = ++contextEpoch.current;
    const token = session.token;
    try {
      const next = await client.agentContext();
      if (
        !mounted.current ||
        epoch !== contextEpoch.current ||
        token !== session.token
      )
        return;
      setData(next);
      setContextError("");
    } catch {
      if (
        mounted.current &&
        epoch === contextEpoch.current &&
        token === session.token
      )
        setContextError("Couldn't load agent instructions.");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      ++contextEpoch.current;
    };
  }, [load]);
  useEffect(() => {
    let live = true;
    const epoch = ++identityEpoch.current;
    const token = session.token;
    setIdentity(null);
    setIdentityError("");
    setEditingLook(false);
    void client
      .automationAgentIdentity(lane)
      .then((value) => {
        if (!live || token !== session.token || epoch !== identityEpoch.current)
          return;
        setIdentity(value);
        setIdentityName(value.name);
        setIdentityPersona(value.persona);
        setAppearance(characterAppearance(value.character));
      })
      .catch(() => {
        if (live && token === session.token && epoch === identityEpoch.current)
          setIdentityError("Couldn't load agent profile.");
      });
    return () => {
      live = false;
    };
  }, [lane, reload]);

  const openProfile = () =>
    void run(async () => {
      const made = await client.openAgentProfile();
      if (!mounted.current) return;
      openAppUrl(`orbyn://doc/${made.doc_id}`);
      await load();
    });

  const save = () => {
    if (!editing) return;
    const d = editing;
    void run(async () => {
      const value = await client.setAgentInstructions(d.team_id, d.text.trim());
      if (!mounted.current) return;
      ++contextEpoch.current;
      setData(value);
      setEditing(null);
    });
  };

  const identityDirty =
    !!identity &&
    (identityName !== identity.name ||
      identityPersona !== identity.persona ||
      JSON.stringify(appearance) !==
        JSON.stringify(characterAppearance(identity.character)));
  const cancelIdentity = () => {
    if (!identity) return;
    setIdentityName(identity.name);
    setIdentityPersona(identity.persona);
    setAppearance(characterAppearance(identity.character));
    setEditingLook(false);
  };

  const saveIdentity = () => {
    if (!identity || identity.lane !== lane) return;
    const token = session.token;
    const epoch = identityEpoch.current;
    void run(async () => {
      const value = await client.updateAutomationAgentIdentity(lane, {
        expected_revision: identity.revision,
        name: identityName.trim(),
        persona: identityPersona,
        character: appearance,
      });
      if (
        mounted.current &&
        token === session.token &&
        epoch === identityEpoch.current
      ) {
        setIdentity(value);
        setIdentityName(value.name);
        setIdentityPersona(value.persona);
        setAppearance(characterAppearance(value.character));
      }
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
          disabled={busy || !!contextError}
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
      <SettingsSection title="Overnight schedule" disabled={busy}>
        <NightShift busy={busy} run={run} />
      </SettingsSection>
      <SettingsSection title="Reminders" disabled={busy}>
        <ReminderNudges busy={busy} run={run} />
      </SettingsSection>
      <SettingsSection title="Background & overnight" disabled={busy}>
        <View style={shared.card}>
          <View style={{ gap: 10, marginVertical: 8 }}>
            <Segmented
              options={["background", "overnight"] as const}
              value={lane}
              labels={{ background: "Background", overnight: "Overnight" }}
              onChange={setLane}
              disabled={busy || identityDirty}
              accessibilityLabel="Agent identity profile"
            />

            <SmallAction
              label="Reload agent profile"
              disabled={busy || identityDirty}
              onPress={() => setReload((value) => value + 1)}
            />
          </View>
          {identityDirty && (
            <Text style={shared.small}>
              Save or cancel changes before switching agents.
            </Text>
          )}
          <ErrorBanner error={identityError} />
          {identity === null && !identityError && (
            <Text style={shared.small}>Loading agent profile…</Text>
          )}
          <Text style={[shared.small, s.gap]}>
            {lane === "background" ? "Background" : "Overnight"} profile.
          </Text>
          <Field label="Name">
            <TextInput
              editable={!busy && identity?.lane === lane}
              value={identityName}
              onChangeText={setIdentityName}
              maxLength={40}
              autoCapitalize="words"
              placeholder="Orbyn"
              placeholderTextColor={colors.faint}
              style={shared.input}
            />
          </Field>
          <Field label="Communication style">
            <TextInput
              editable={!busy && identity?.lane === lane}
              value={identityPersona}
              onChangeText={setIdentityPersona}
              maxLength={1000}
              multiline
              style={[shared.input, s.area]}
              placeholder="Warm, direct, and concise"
              placeholderTextColor={colors.faint}
            />
          </Field>
          <InlineDetails title="Suggested styles">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CHARACTER_PERSONAS.map((preset) => (
                <SmallAction
                  key={preset.label}
                  label={preset.label}
                  disabled={busy || identity?.lane !== lane}
                  onPress={() => setIdentityPersona(preset.persona)}
                />
              ))}
            </View>
          </InlineDetails>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Character appearance={appearance} name={identityName} size={48} />
            <SmallAction
              label={
                editingLook ? "Close character editor" : "Customize character"
              }
              disabled={busy || identity?.lane !== lane}
              onPress={() => setEditingLook((value) => !value)}
            />
          </View>
          {editingLook && (
            <CharacterEditor
              value={appearance}
              onChange={setAppearance}
              name={identityName}
              disabled={busy || identity?.lane !== lane}
            />
          )}
          <Button
            title="Save"
            onPress={saveIdentity}
            disabled={
              busy ||
              identity === null ||
              identity.lane !== lane ||
              !identityName.trim() ||
              !identityDirty
            }
            style={s.last}
          />
          <Button
            title="Cancel"
            secondary
            disabled={busy || !identityDirty}
            onPress={cancelIdentity}
          />
        </View>
      </SettingsSection>
      <SettingsSection title="Agent context" disabled={busy}>
        <View style={shared.card}>
          <Text style={[shared.small, s.gap]}>
            Context your connected agents can read.
          </Text>
          <Button
            secondary
            title={data?.profile ? "Open the page" : "Make the page"}
            icon="fileText"
            style={s.last}
            disabled={busy || data === null || !!contextError}
            onPress={openProfile}
          />
          {!!data?.profile && (
            <Text style={[shared.small, s.after]}>
              Changed {timeAgo(data.profile.updated_at)}
            </Text>
          )}
        </View>
      </SettingsSection>
      <SettingsSection title="Instructions" disabled={busy}>
        <View style={shared.card}>
          <Text style={[shared.small, s.gap]}>
            Space-specific rules for agents. Team rules apply to every member’s
            agents.
          </Text>
          <ErrorBanner error={contextError} />
          {!!contextError && (
            <Button
              title="Retry instructions"
              secondary
              disabled={busy}
              onPress={() => void load()}
            />
          )}
          {data === null ? (
            <Text style={shared.small}>
              {contextError
                ? "Instructions unavailable."
                : "Loading instructions…"}
            </Text>
          ) : (
            data.instructions.map(row)
          )}
          {editing && (
            <BottomSheet
              visible
              title="Agent instructions"
              closeDisabled={busy}
              onClose={() => {
                if (!busy) setEditing(null);
              }}
            >
              <Field label={`Instructions for ${editingSpace ?? "this space"}`}>
                <TextInput
                  style={[shared.input, s.area]}
                  value={editing.text}
                  editable={!busy}
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
                  disabled={busy}
                  style={s.flexButton}
                  onPress={() => setEditing(null)}
                />
              </View>
            </BottomSheet>
          )}
        </View>
      </SettingsSection>
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
    flex: { flex: 1, minWidth: 120 },
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
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "center",
    },
    flexButton: { flex: 1, minWidth: 120, marginBottom: 0 },
    last: { marginBottom: 0 },
    after: { marginTop: 8 },
  }),
);
