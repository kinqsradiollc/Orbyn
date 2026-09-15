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
import {
  byDueDate,
  hasTeamPermission,
  isClosed,
  type Item,
  type TaskList,
  type Team,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { ItemRows, type ListHandlers } from "../components/PlannerList";
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

const COLOR_NAMES = [
  "Green",
  "Sage",
  "Blue",
  "Purple",
  "Clay",
  "Rust",
  "Amber",
  "Slate",
];
const PERSONAL = "personal";

/** Handlers for the task rows shown inside a list. */
type RowHandlers = Omit<ListHandlers, "onAdd">;

/**
 * Lists: your personal ones and each team's shared ones. Tap a list to see
 * its tasks and add one to it; lists you can change can be renamed,
 * recoloured or deleted there too.
 */
export function ListsSheet({
  visible,
  teams,
  items,
  handlers,
  onNewTask,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  teams: Team[];
  items: Item[];
  handlers: RowHandlers;
  /** Open the editor on a new task in this list. */
  onNewTask: (list: TaskList) => void;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Lists"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Body
        teams={teams}
        items={items}
        handlers={handlers}
        onNewTask={onNewTask}
      />
    </Sheet>
  );
}

function Body({
  teams,
  items,
  handlers,
  onNewTask,
}: {
  teams: Team[];
  items: Item[];
  handlers: RowHandlers;
  onNewTask: (list: TaskList) => void;
}) {
  const { lists, reload } = usePlanning();
  const { busy, error, setError, run } = useRun();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LIST_COLORS[0]);
  const [scope, setScope] = useState(PERSONAL);
  const [expanded, setExpanded] = useState<string | null>(null);
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const scopes = [PERSONAL, ...writable.map((t) => t.id)];
  const scopeLabels: Record<string, string> = { [PERSONAL]: "Personal" };
  for (const t of writable) scopeLabels[t.id] = t.name;
  const canEdit = (l: TaskList) =>
    !l.team_id || writable.some((t) => t.id === l.team_id);
  /** A list's tasks, open ones first by due date. */
  const tasksIn = (l: TaskList) =>
    items
      .filter((i) => i.list_id === l.id)
      .sort(
        (a, b) =>
          Number(isClosed(a.status)) - Number(isClosed(b.status)) ||
          byDueDate(a, b),
      );

  const sections = [
    {
      key: PERSONAL,
      title: "Personal",
      lists: lists.filter((l) => !l.team_id),
    },
    ...teams.map((t) => ({
      key: t.id,
      title: t.name,
      lists: lists.filter((l) => l.team_id === t.id),
    })),
  ].filter((sec) => sec.lists.length);

  const create = () =>
    run(async () => {
      await client.createList({
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
          Group tasks into lists. Team lists are shared with everyone in the
          team. Tap a list to see what’s in it.
        </Text>

        {sections.length === 0 && (
          <View style={[shared.card, shared.empty]}>
            <View style={shared.emptyIcon}>
              <Icon name="list" size={24} color={colors.accent} />
            </View>
            <Text style={shared.sectionTitle}>No lists yet.</Text>
            <Text style={[shared.subtitle, s.center]}>
              Start one below, like Work, Home or Errands.
            </Text>
          </View>
        )}
        {sections.map((sec) => (
          <View key={sec.key}>
            <Text style={[shared.eyebrow, s.eyebrow]}>
              {sec.title.toUpperCase()}
            </Text>
            <View style={s.card}>
              {sec.lists.map((l, n) => (
                <ListRow
                  key={l.id}
                  list={l}
                  tasks={tasksIn(l)}
                  handlers={handlers}
                  first={n === 0}
                  open={expanded === l.id}
                  editable={canEdit(l)}
                  busy={busy}
                  onToggle={() => {
                    animateLayout();
                    setExpanded(expanded === l.id ? null : l.id);
                  }}
                  onNewTask={() => onNewTask(l)}
                  onSave={(patch) =>
                    run(async () => {
                      await client.updateList(l.id, patch);
                      await reload();
                    })
                  }
                  onDelete={() =>
                    Alert.alert(
                      `Delete ${l.name}?`,
                      "Its tasks stay in your planner, just without a list.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () =>
                            void run(async () => {
                              await client.deleteList(l.id);
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
          <Text style={shared.label}>New list</Text>
          <TextInput
            style={[shared.input, s.gap]}
            value={name}
            onChangeText={setName}
            maxLength={80}
            placeholder="List name"
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            accessibilityLabel="New list name"
          />
          {scopes.length > 1 && (
            <View style={s.gap}>
              <Segmented
                wrap
                accessibilityLabel="Whose list"
                options={scopes}
                labels={scopeLabels}
                value={scope}
                onChange={setScope}
              />
            </View>
          )}
          <Swatches value={color} onChange={setColor} />
          <Button
            title="Add list"
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

function ListRow({
  list,
  tasks,
  handlers,
  first,
  open,
  editable,
  busy,
  onToggle,
  onNewTask,
  onSave,
  onDelete,
}: {
  list: TaskList;
  tasks: Item[];
  handlers: RowHandlers;
  first: boolean;
  open: boolean;
  editable: boolean;
  busy: boolean;
  onToggle: () => void;
  onNewTask: () => void;
  onSave: (patch: { name?: string; color?: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(list.name);
  return (
    <FadeIn style={!first && s.divider}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${list.name}, ${list.item_count} open`}
        accessibilityHint="Shows its tasks"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
      >
        <View style={[s.swatchDot, { backgroundColor: list.color }]} />
        <Text style={s.rowName} numberOfLines={1}>
          {list.name}
        </Text>
        <Text style={shared.small}>{list.item_count} open</Text>
        <Icon name="chevronRight" size={16} color={colors.faint} />
      </Pressable>
      {open && (
        <View style={s.edit}>
          {tasks.length > 0 ? (
            <ItemRows items={tasks} {...handlers} />
          ) : (
            <Text style={shared.small}>No tasks in this list yet.</Text>
          )}
          {editable && (
            <Button
              secondary
              title="New task here"
              icon="plus"
              style={s.delete}
              onPress={onNewTask}
            />
          )}
          {editable && (
            <>
              <View style={s.renameRow}>
                <TextInput
                  style={[shared.input, s.rename]}
                  value={name}
                  onChangeText={setName}
                  maxLength={80}
                  accessibilityLabel={`Rename ${list.name}`}
                />
                <SmallAction
                  label="Rename"
                  disabled={busy || !name.trim() || name.trim() === list.name}
                  onPress={() => onSave({ name: name.trim() })}
                />
              </View>
              <Swatches
                value={list.color}
                onChange={(color) => color !== list.color && onSave({ color })}
              />
              <Button
                destructive
                title="Delete list"
                icon="trash"
                disabled={busy}
                style={s.delete}
                onPress={onDelete}
              />
            </>
          )}
        </View>
      )}
    </FadeIn>
  );
}

/** The list colours as a row of swatches; lists and tags share it. */
export function Swatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <View
      style={s.swatches}
      accessibilityRole="radiogroup"
      accessibilityLabel="Colour"
    >
      {LIST_COLORS.map((c, n) => {
        const on = c.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityLabel={COLOR_NAMES[n]}
            accessibilityState={{ checked: on }}
            hitSlop={4}
            onPress={() => onChange(c)}
            style={[s.swatch, on && s.swatchOn]}
          >
            <View style={[s.swatchFill, { backgroundColor: c }]}>
              {on && (
                <Icon
                  name="check"
                  size={14}
                  color={colors.white}
                  strokeWidth={3}
                />
              )}
            </View>
          </Pressable>
        );
      })}
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
      paddingHorizontal: 16,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    rowName: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    swatchDot: { width: 12, height: 12, borderRadius: 6 },
    edit: { paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
    renameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    rename: { flex: 1, minHeight: 44, paddingVertical: 10 },
    delete: { marginBottom: 0 },
    gap: { marginBottom: 12 },
    add: { marginTop: 14, marginBottom: 0 },
    swatches: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    swatch: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: "transparent",
    },
    swatchOn: { borderColor: colors.text },
    swatchFill: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
