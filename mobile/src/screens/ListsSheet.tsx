import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { ChoicePicker } from "../components/ChoicePicker";
import { Sheet, sheetStyles } from "../components/Sheet";
import { MoreMenu } from "../components/MoreMenu";
import { client } from "../lib/api";
import { LIST_COLORS } from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import { session } from "../lib/session";
import { errorText } from "../lib/errors";
import { Pressable } from "../motion";
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

type Props = {
  visible: boolean;
  teams: Team[];
  items: Item[];
  handlers: RowHandlers;
  onNewTask: (list: TaskList) => void;
  onClose: () => void;
  onDismiss?: () => void;
};

export function ListsSheet(props: Props) {
  return <ListsBody key={session.token} {...props} />;
}

/** Lists, tasks and occasional management each get a focused sheet view. */
function ListsBody({
  visible,
  teams,
  items,
  handlers,
  onNewTask,
  onClose,
  onDismiss,
}: Props) {
  const { lists, reload } = usePlanning();
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<TaskList | "new" | null>(null);
  const [deleting, setDeleting] = useState<TaskList | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LIST_COLORS[0]);
  const [scope, setScope] = useState(PERSONAL);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const mutation = useRef(false);
  const mounted = useRef(true);
  const owner = session.token;
  const live = useRef(visible);
  live.current = visible;
  const current = () =>
    mounted.current && session.token === owner && live.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const canEdit = (list: TaskList) =>
    !list.team_id || writable.some((t) => t.id === list.team_id);
  const active = lists.find((l) => l.id === selected);
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
  ]
    .map((section) => ({
      ...section,
      lists: section.lists.filter((l) =>
        l.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    }))
    .filter((section) => section.lists.length);
  const tasks = active
    ? items
        .filter((i) => i.list_id === active.id)
        .sort(
          (a, b) =>
            Number(isClosed(a.status)) - Number(isClosed(b.status)) ||
            byDueDate(a, b),
        )
    : [];
  const refresh = async () => {
    try {
      await reload();
      if (current()) setRefreshFailed(false);
      return true;
    } catch {
      if (current()) setRefreshFailed(true);
      return false;
    }
  };
  const run = async (work: () => Promise<void>) => {
    if (mutation.current || !current()) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (mounted.current && session.token === owner) setBusy(false);
    }
  };
  const edit = (list: TaskList | "new") => {
    if (mutation.current || (list !== "new" && !canEdit(list))) return;
    setName(list === "new" ? "" : list.name);
    setColor(list === "new" ? LIST_COLORS[0] : list.color);
    setScope(list === "new" ? PERSONAL : (list.team_id ?? PERSONAL));
    setError("");
    setNotice("");
    setEditor(list);
  };
  const save = () =>
    run(async () => {
      if (!editor || !name.trim()) return;
      if (
        (editor !== "new" && !canEdit(editor)) ||
        (editor === "new" &&
          scope !== PERSONAL &&
          !writable.some((t) => t.id === scope))
      )
        throw new Error("You can no longer change lists in this space.");
      if (editor === "new") {
        const made = await client.createList({
          name: name.trim(),
          color,
          team_id: scope === PERSONAL ? null : scope,
        });
        if (!current()) return;
        setSelected(made.id);
      } else await client.updateList(editor.id, { name: name.trim(), color });
      if (!current()) return;
      setEditor(null);
      const refreshed = await refresh();
      if (current())
        setNotice(refreshed ? "List saved." : "Saved. Couldn't refresh lists.");
    });
  const remove = () =>
    run(async () => {
      if (!deleting) return;
      if (!canEdit(deleting))
        throw new Error("You can no longer delete this list.");
      await client.deleteList(deleting.id);
      if (!current()) return;
      setSelected((id) => (id === deleting.id ? null : id));
      setDeleting(null);
      const refreshed = await refresh();
      if (current())
        setNotice(
          refreshed ? "List deleted." : "Deleted. Couldn't refresh lists.",
        );
    });
  const back = () => {
    if (mutation.current) return;
    if (editor) setEditor(null);
    else if (deleting) setDeleting(null);
    else setSelected(null);
    setError("");
  };
  return (
    <Sheet
      visible={visible}
      title={
        editor
          ? editor === "new"
            ? "New list"
            : "Edit list"
          : deleting
            ? "Delete list?"
            : (active?.name ?? "Lists")
      }
      closeDisabled={busy}
      onClose={() => {
        if (!mutation.current) onClose();
      }}
      onDismiss={onDismiss}
      onBack={editor || deleting || active ? back : undefined}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {!!notice && (
            <Text style={shared.small} accessibilityLiveRegion="polite">
              {notice}
            </Text>
          )}
          {refreshFailed && !editor && !deleting && (
            <Button
              secondary
              title="Retry refresh"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  if (!(await refresh()))
                    throw new Error("Couldn't refresh lists. Try again.");
                })
              }
            />
          )}
          {editor ? (
            <>
              <Text style={shared.label}>List name</Text>
              <TextInput
                style={shared.input}
                accessibilityLabel="List name"
                autoFocus
                value={name}
                onChangeText={setName}
                editable={!busy}
                maxLength={80}
                returnKeyType="done"
                onSubmitEditing={() => void save()}
              />
              {editor === "new" && writable.length > 0 && (
                <ChoicePicker
                  label="Space"
                  value={scope}
                  disabled={busy}
                  options={[
                    { value: PERSONAL, label: "Personal" },
                    ...writable.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                  onChange={setScope}
                />
              )}
              {editor !== "new" && (
                <Text style={shared.small}>
                  {editor.team_name || "Personal"}
                </Text>
              )}
              <Swatches value={color} disabled={busy} onChange={setColor} />
              <Button
                title={
                  busy ? "Saving…" : editor === "new" ? "Create list" : "Save"
                }
                disabled={busy || !name.trim()}
                onPress={() => void save()}
              />
              <Button secondary title="Cancel" disabled={busy} onPress={back} />
            </>
          ) : deleting ? (
            <>
              <Text style={shared.sectionTitle}>{deleting.name}</Text>
              <Text style={shared.small}>
                Its tasks stay in your planner without a list.
              </Text>
              <Button
                title={busy ? "Deleting…" : "Delete list"}
                disabled={busy}
                onPress={() => void remove()}
              />
              <Button secondary title="Cancel" disabled={busy} onPress={back} />
            </>
          ) : active ? (
            <>
              <View style={s.listActions}>
                <Text style={[shared.small, s.grow]}>{tasks.length} tasks</Text>
                {canEdit(active) && (
                  <MoreMenu
                    label={`Options for ${active.name}`}
                    disabled={busy}
                    actions={[
                      { label: "Edit list", onPress: () => edit(active) },
                      {
                        label: "Delete list",
                        destructive: true,
                        onPress: () => {
                          setError("");
                          setNotice("");
                          setDeleting(active);
                        },
                      },
                    ]}
                  />
                )}
              </View>
              {canEdit(active) && (
                <Button
                  secondary
                  title="New task"
                  icon="plus"
                  disabled={busy}
                  onPress={() => onNewTask(active)}
                />
              )}
              {tasks.length ? (
                <ItemRows items={tasks} {...handlers} />
              ) : (
                <Text style={shared.small}>No tasks yet.</Text>
              )}
            </>
          ) : (
            <>
              <Button
                secondary
                title="New list"
                icon="plus"
                disabled={busy}
                onPress={() => edit("new")}
              />
              <TextInput
                style={shared.input}
                accessibilityLabel="Find a list"
                placeholder="Find a list"
                placeholderTextColor={colors.faint}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {sections.map((section) => (
                <View key={section.key}>
                  <Text style={shared.label}>{section.title}</Text>
                  <View style={s.card}>
                    {section.lists.map((list, index) => (
                      <View
                        key={list.id}
                        style={[s.listActions, index > 0 && s.divider]}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${list.name}, ${list.item_count} open tasks`}
                          disabled={busy}
                          onPress={() => setSelected(list.id)}
                          style={[s.row, s.grow]}
                        >
                          <View
                            style={[
                              s.swatchDot,
                              { backgroundColor: list.color },
                            ]}
                          />
                          <View style={s.grow}>
                            <Text style={s.rowName}>{list.name}</Text>
                            <Text style={shared.small}>
                              {list.item_count} open
                            </Text>
                          </View>
                          <Icon
                            name="chevronRight"
                            size={16}
                            color={colors.faint}
                          />
                        </Pressable>
                        {canEdit(list) && (
                          <MoreMenu
                            label={`Options for ${list.name}`}
                            disabled={busy}
                            actions={[
                              { label: "Edit list", onPress: () => edit(list) },
                              {
                                label: "Delete list",
                                destructive: true,
                                onPress: () => {
                                  setError("");
                                  setNotice("");
                                  setDeleting(list);
                                },
                              },
                            ]}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              {!sections.length && (
                <Text style={shared.small}>
                  {query ? "No matching lists." : "No lists yet."}
                </Text>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

/** The list colours as a row of swatches; lists and tags share it. */
export function Swatches({
  value,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
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
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
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
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    rowName: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    swatchDot: { width: 12, height: 12, borderRadius: radii.pill },
    grow: { flex: 1 },
    listActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    swatches: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    swatch: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: "transparent",
    },
    swatchOn: { borderColor: colors.text },
    swatchFill: {
      width: 30,
      height: 30,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
