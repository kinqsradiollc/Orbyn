import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { hasTeamPermission, type Tag, type Team } from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { LIST_COLORS } from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
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
  return (
    <Sheet
      visible={visible}
      title="Tags"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Body teams={teams} />
    </Sheet>
  );
}

function Body({ teams }: { teams: Team[] }) {
  const { tags, reload } = usePlanning();
  const { busy, error, setError, run } = useRun();
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
      animateLayout();
      setName("");
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
        <Text style={[shared.subtitle, s.intro]}>
          Tags cut across lists, like calls, errands or waiting. Team tags are
          shared with everyone in the team.
        </Text>

        {sections.length === 0 && (
          <View style={[shared.card, shared.empty]}>
            <View style={shared.emptyIcon}>
              <Icon name="tag" size={24} color={colors.accent} />
            </View>
            <Text style={shared.sectionTitle}>No tags yet.</Text>
            <Text style={[shared.subtitle, s.center]}>
              Make one below, or add them when you edit a task.
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
                  onToggle={() => {
                    animateLayout();
                    setExpanded(expanded === t.id ? null : t.id);
                  }}
                  onSave={(patch) =>
                    run(async () => {
                      await client.updateTag(t.id, patch);
                      await reload();
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
                              animateLayout();
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

        <View style={shared.card}>
          <Text style={shared.label}>New tag</Text>
          <TextInput
            style={[shared.input, s.gap]}
            value={name}
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
                onChange={setScope}
              />
            </View>
          )}
          <Swatches value={color} onChange={setColor} />
          <Button
            title="Add tag"
            icon="plus"
            style={s.add}
            disabled={busy || !name.trim()}
            onPress={() => void create()}
          />
        </View>
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
  onToggle,
  onSave,
  onDelete,
}: {
  tag: Tag;
  first: boolean;
  open: boolean;
  editable: boolean;
  busy: boolean;
  onToggle: () => void;
  onSave: (patch: { name?: string; color?: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(tag.name);
  return (
    <FadeIn style={!first && s.divider}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tag.name}
        accessibilityHint={editable ? "Rename, recolour or delete" : undefined}
        accessibilityState={{ expanded: open, disabled: !editable }}
        disabled={!editable}
        onPress={onToggle}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
      >
        <View style={[s.dot, { backgroundColor: tag.color }]} />
        <Text style={s.rowName} numberOfLines={1}>
          {tag.name}
        </Text>
        {editable && (
          <Icon name="chevronRight" size={16} color={colors.faint} />
        )}
      </Pressable>
      {open && (
        <View style={s.edit}>
          <View style={s.renameRow}>
            <TextInput
              style={[shared.input, s.rename]}
              value={name}
              onChangeText={setName}
              maxLength={40}
              accessibilityLabel={`Rename ${tag.name}`}
            />
            <SmallAction
              label="Rename"
              disabled={busy || !name.trim() || name.trim() === tag.name}
              onPress={() => onSave({ name: name.trim() })}
            />
          </View>
          <Swatches
            value={tag.color}
            onChange={(color) => color !== tag.color && onSave({ color })}
          />
          <Button
            destructive
            title="Delete tag"
            icon="trash"
            disabled={busy}
            style={s.delete}
            onPress={onDelete}
          />
        </View>
      )}
    </FadeIn>
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
      paddingHorizontal: 16,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    rowName: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    dot: { width: 12, height: 12, borderRadius: 6 },
    edit: { paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
    renameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    rename: { flex: 1, minHeight: 44, paddingVertical: 10 },
    delete: { marginBottom: 0 },
    gap: { marginBottom: 12 },
    add: { marginTop: 14, marginBottom: 0 },
  }),
);
