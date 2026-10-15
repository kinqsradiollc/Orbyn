import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "../lib/alert";
import { hasTeamPermission, type Tag, type Team } from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { MoreMenu } from "../components/MoreMenu";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { LIST_COLORS } from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import { useRun } from "../hooks/useRun";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { Swatches } from "./ListsSheet";

const PERSONAL = "personal";

/**
 * Tags: your personal ones and each team's shared ones. Make one with a
 * colour for you or a team; rename, recolour or delete the ones you can
 * change.
 */
export function TagsSheet({
  visible,
  teams,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  teams: Team[];
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      visible={visible}
      title="Tags"
      closeDisabled={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      onDismiss={onDismiss}
    >
      <Body teams={teams} onBusyChange={setBusy} />
    </Sheet>
  );
}

function Body({
  teams,
  onBusyChange,
}: {
  teams: Team[];
  onBusyChange: (busy: boolean) => void;
}) {
  const { tags, reload } = usePlanning();
  const { busy, error, setError, run: runBase } = useRun();
  const pending = useRef(false);
  const mounted = useRef(true);
  const account = session.token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);
  const run = async <T,>(fn: () => Promise<T>) => {
    if (pending.current || account !== session.token || !mounted.current)
      return undefined;
    pending.current = true;
    onBusyChange(true);
    try {
      const result = await runBase(fn);
      return mounted.current && account === session.token ? result : undefined;
    } finally {
      pending.current = false;
      onBusyChange(false);
    }
  };
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LIST_COLORS[1]);
  const [scope, setScope] = useState(PERSONAL);
  const [expanded, setExpanded] = useState<string | null>(null);
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const scopes = [PERSONAL, ...writable.map((t) => t.id)];
  const scopeLabels: Record<string, string> = { [PERSONAL]: "Personal" };
  for (const t of writable) scopeLabels[t.id] = t.name;
  const canEdit = (t: Tag) =>
    !t.team_id || writable.some((team) => team.id === t.team_id);

  const sections = [
    {
      key: PERSONAL,
      title: "Personal",
      tags: tags.filter((t) => !t.team_id),
    },
    ...teams.map((team) => ({
      key: team.id,
      title: team.name,
      tags: tags.filter((t) => t.team_id === team.id),
    })),
  ].filter((sec) => sec.tags.length);

  const create = () =>
    run(async () => {
      await client.createTag({
        name: name.trim(),
        color,
        team_id: scope === PERSONAL ? null : scope,
      });
      await reload();
      if (!mounted.current || account !== session.token) return;
      setName("");
      setCreating(false);
    });

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Button
          title="New tag"
          icon="plus"
          disabled={busy}
          onPress={() => setCreating(true)}
        />

        {sections.length === 0 && (
          <View style={[shared.card, shared.empty]}>
            <View style={shared.emptyIcon}>
              <Icon name="tag" size={24} color={colors.accent} />
            </View>
            <Text style={shared.sectionTitle}>No tags yet.</Text>
            <Text style={[shared.subtitle, s.center]}>
              Add a tag here or when editing a task.
            </Text>
          </View>
        )}
        {sections.map((sec) => (
          <View key={sec.key}>
            <Text style={[shared.eyebrow, s.eyebrow]}>
              {sec.title.toUpperCase()}
            </Text>
            <View style={s.card}>
              {sec.tags.map((t, n) => (
                <TagRow
                  key={t.id}
                  tag={t}
                  first={n === 0}
                  open={expanded === t.id}
                  editable={canEdit(t)}
                  busy={busy}
                  error={error}
                  onDismissError={() => setError("")}
                  onToggle={() => {
                    if (busy) return;
                    setExpanded(expanded === t.id ? null : t.id);
                  }}
                  onSave={(patch) =>
                    run(async () => {
                      await client.updateTag(t.id, patch);
                      await reload();
                      return true;
                    })
                  }
                  onDelete={() =>
                    Alert.alert(
                      `Delete ${t.name}?`,
                      "It comes off every task that has it.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () =>
                            void run(async () => {
                              await client.deleteTag(t.id);
                              await reload();
                              if (mounted.current && account === session.token)
                                setExpanded(null);
                            }),
                        },
                      ],
                    )
                  }
                />
              ))}
            </View>
          </View>
        ))}

        <Sheet
          visible={creating}
          closeDisabled={busy}
          title="New tag"
          onClose={() => {
            if (!busy) setCreating(false);
          }}
        >
          <ScrollView
            contentContainerStyle={sheetStyles.body}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <View style={sheetStyles.column}>
              <ErrorBanner error={error} onDismiss={() => setError("")} />
              <TextInput
                style={[shared.input, s.gap]}
                value={name}
                editable={!busy}
                onChangeText={setName}
                maxLength={40}
                placeholder="Tag name"
                placeholderTextColor={colors.faint}
                returnKeyType="done"
                accessibilityLabel="New tag name"
              />
              {scopes.length > 1 && (
                <View style={s.gap}>
                  <Segmented
                    wrap
                    accessibilityLabel="Whose tag"
                    options={scopes}
                    labels={scopeLabels}
                    value={scope}
                    disabled={busy}
                    onChange={setScope}
                  />
                </View>
              )}
              <Swatches value={color} disabled={busy} onChange={setColor} />
              <Button
                title="Add tag"
                icon="plus"
                style={s.add}
                disabled={busy || !name.trim() || !scopes.includes(scope)}
                onPress={() => void create()}
              />
            </View>
          </ScrollView>
        </Sheet>
      </View>
    </ScrollView>
  );
}

function TagRow({
  tag,
  first,
  open,
  editable,
  busy,
  error,
  onDismissError,
  onToggle,
  onSave,
  onDelete,
}: {
  tag: Tag;
  first: boolean;
  open: boolean;
  editable: boolean;
  busy: boolean;
  error: string;
  onDismissError: () => void;
  onToggle: () => void;
  onSave: (patch: {
    name?: string;
    color?: string;
  }) => Promise<boolean | undefined>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  useEffect(() => {
    if (!open) {
      setName(tag.name);
      setColor(tag.color);
    }
  }, [tag.name, tag.color, open]);
  return (
    <View style={!first && s.divider}>
      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: tag.color }]} />
        <Text style={s.rowName}>{tag.name}</Text>
        {editable && (
          <MoreMenu
            label={`${tag.name} options`}
            title={tag.name}
            disabled={busy}
            actions={[
              { label: "Edit tag", disabled: busy, onPress: onToggle },
              {
                label: "Delete tag",
                destructive: true,
                disabled: busy,
                onPress: onDelete,
              },
            ]}
          />
        )}
      </View>
      <Sheet
        visible={open && editable}
        closeDisabled={busy}
        title="Edit tag"
        onClose={() => {
          if (!busy) onToggle();
        }}
      >
        <ScrollView
          contentContainerStyle={sheetStyles.body}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={sheetStyles.column}>
            <ErrorBanner error={error} onDismiss={onDismissError} />
            <Text style={shared.label}>Name</Text>
            <TextInput
              style={shared.input}
              value={name}
              editable={!busy}
              onChangeText={setName}
              maxLength={40}
              accessibilityLabel={`Tag name for ${tag.name}`}
            />
            <Swatches value={color} disabled={busy} onChange={setColor} />
            <Button
              title={busy ? "Saving…" : "Save tag"}
              disabled={
                busy ||
                !name.trim() ||
                (name.trim() === tag.name && color === tag.color)
              }
              onPress={() => {
                void onSave({ name: name.trim(), color }).then((saved) => {
                  if (saved) onToggle();
                });
              }}
            />
          </View>
        </ScrollView>
      </Sheet>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 18 },
    center: { textAlign: "center" },
    eyebrow: { marginTop: 4 },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 16,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    rowName: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    dot: { width: 12, height: 12, borderRadius: radii.pill },
    edit: { paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
    renameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    rename: { flex: 1, minHeight: 44, paddingVertical: 10 },
    delete: { marginBottom: 0 },
    deleteRow: { flexDirection: "row", justifyContent: "flex-end" },
    gap: { marginBottom: 12 },
    add: { marginTop: 14, marginBottom: 0 },
  }),
);
