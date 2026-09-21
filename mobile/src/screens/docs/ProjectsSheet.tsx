import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  projectAtRisk,
  projectProgress,
  type Item,
  type Project,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SmallAction } from "../../components/SmallAction";
import { confirmAction } from "../../lib/confirm";
import { Icon } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { ProjectNotes } from "./ProjectNotes";
import { colors, fonts, radii, themed } from "../../theme";

const dueLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
    : "No deadline";

/**
 * Projects on the phone: the list, then one project's stages with the tasks
 * in each. Moving a task between stages stays on the desktop, where there is
 * room for a board.
 */
export function ProjectsSheet({
  visible,
  items,
  onClose,
  onDismiss,
  onOpenItem,
  onOpenNote,
  onItemsChanged,
}: {
  visible: boolean;
  items: Item[];
  onClose: () => void;
  onDismiss?: () => void;
  onOpenItem?: (item: Item) => void;
  /** Opens one of a project's notes, in the page editor. */
  onOpenNote?: (docId: string) => void;
  /** Called when a task moved, so the planner's lists catch up. */
  onItemsChanged?: () => void;
}) {
  const sheet = sheetStyles;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState<Project | null>(null);
  /** A name being typed, for a new project or a rename. */
  const [draft, setDraft] = useState<string | null>(null);
  const { busy, error, setError, run } = useRun();

  /** True when the list could not be read, which is not the same as empty. */
  const [failed, setFailed] = useState(false);
  /** The task whose stage is being chosen, if any. */
  const [moving, setMoving] = useState<string | null>(null);

  /**
   * Move a task to another stage. The desktop does this by dragging across a
   * board; a phone has no room for one, so the stages are offered as a list
   * under the task instead.
   */
  const moveTo = (item: Item, stageId: string | null) =>
    void run(async () => {
      if (!open) return;
      await client.setItemProject(item.id, {
        project_id: open.id,
        stage_id: stageId,
      });
      setMoving(null);
      onItemsChanged?.();
    });

  /**
   * Read the list of projects. A failure is not an empty workspace: saying
   * "no projects yet" when the network hiccuped tells someone their work
   * has gone.
   */
  const reload = () =>
    client.listProjects().then(
      (list) => {
        setProjects(list);
        setFailed(false);
      },
      (e: Error) => {
        setProjects(null);
        setFailed(true);
        setError(e.message || "Could not reach your projects.");
      },
    );

  const create = () => {
    const name = (draft ?? "").trim();
    if (!name) return;
    void run(async () => {
      const made = await client.createProject({ name });
      setDraft(null);
      await reload();
      setOpen(made);
    });
  };

  const rename = () => {
    const name = (draft ?? "").trim();
    if (!open || !name || name === open.name) return setDraft(null);
    void run(async () => {
      const saved = await client.updateProject(open.id, { name });
      setOpen(saved);
      setDraft(null);
      await reload();
    });
  };

  const remove = () => {
    if (!open) return;
    confirmAction(
      `Delete “${open.name}”?`,
      "Its tasks stay in your planner, unfiled.",
      "Delete",
      () =>
        void run(async () => {
          await client.deleteProject(open.id);
          setOpen(null);
          await reload();
        }),
    );
  };

  useEffect(() => {
    if (!visible) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const tasksIn = (project: Project, stageId: string | null) =>
    items.filter(
      (i) =>
        i.project_id === project.id &&
        (stageId === null
          ? !i.stage_id || !project.stages.some((s) => s.id === i.stage_id)
          : i.stage_id === stageId),
    );

  return (
    <Sheet
      visible={visible}
      title={open ? open.name : "Projects"}
      onClose={onClose}
      onBack={open ? () => setOpen(null) : undefined}
      onDismiss={onDismiss}
    >
      <ScrollView contentContainerStyle={sheet.body}>
        <View style={sheet.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {open ? (
            <View style={styles.page}>
              {draft === null ? (
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{open.name}</Text>
                  {projectAtRisk(open) && (
                    <Text style={styles.chip}>At risk</Text>
                  )}
                </View>
              ) : (
                <TextInput
                  style={styles.nameInput}
                  value={draft}
                  autoFocus
                  maxLength={120}
                  placeholder="Project name"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Project name"
                  onChangeText={setDraft}
                  onSubmitEditing={rename}
                  onBlur={rename}
                />
              )}
              <View style={styles.actions}>
                <SmallAction
                  label={draft === null ? "Rename" : "Save"}
                  disabled={busy}
                  onPress={() =>
                    draft === null ? setDraft(open.name) : rename()
                  }
                />
                <SmallAction
                  label="Delete project"
                  destructive
                  disabled={busy}
                  onPress={remove}
                />
              </View>
              {!!open.summary && (
                <Text style={styles.summary}>{open.summary}</Text>
              )}
              <View style={styles.bar}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${projectProgress(open)}%` },
                  ]}
                />
              </View>
              <Text style={styles.meta}>
                {open.done_count} of {open.task_count} done ·{" "}
                {dueLabel(open.deadline)}
              </Text>

              {!!onOpenNote && (
                <ProjectNotes
                  projectId={open.id}
                  teamId={open.team_id}
                  busy={busy}
                  report={(e) => setError((e as Error).message)}
                  onOpen={onOpenNote}
                />
              )}

              {[...open.stages, { id: null, name: "No stage" }].map((stage) => {
                const rows = tasksIn(open, stage.id as string | null);
                return (
                  <View key={stage.id ?? "none"} style={styles.stage}>
                    <View style={styles.stageHead}>
                      <Text style={styles.stageName}>{stage.name}</Text>
                      <Text style={styles.stageCount}>{rows.length}</Text>
                    </View>
                    {rows.length === 0 ? (
                      <Text style={styles.empty}>Nothing here yet.</Text>
                    ) : (
                      rows.map((item) => (
                        <View key={item.id}>
                          <Pressable
                            style={({ pressed }) => [
                              styles.task,
                              pressed && styles.rowPressed,
                            ]}
                            onPress={() => onOpenItem?.(item)}
                          >
                            <View
                              style={[
                                styles.dot,
                                item.status === "done" && styles.dotDone,
                              ]}
                            />
                            <Text
                              style={[
                                styles.taskText,
                                item.status === "done" && styles.taskDone,
                              ]}
                              numberOfLines={2}
                            >
                              {item.title}
                            </Text>
                            {/* Outside the row's own press, or moving a task
                                would open it instead. */}
                            <Pressable
                              onPress={() =>
                                setMoving((m) =>
                                  m === item.id ? null : item.id,
                                )
                              }
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`Move ${item.title}`}
                              style={styles.moveButton}
                            >
                              <Icon
                                name={
                                  moving === item.id
                                    ? "chevronUp"
                                    : "chevronDown"
                                }
                                size={15}
                                color={colors.faint}
                              />
                            </Pressable>
                          </Pressable>
                          {moving === item.id && (
                            <ChipRow label="Move to">
                              {[
                                ...open.stages,
                                { id: null as string | null, name: "No stage" },
                              ].map((to) => (
                                <Chip
                                  key={to.id ?? "none"}
                                  label={to.name}
                                  selected={to.id === stage.id}
                                  onPress={() => moveTo(item, to.id)}
                                />
                              ))}
                            </ChipRow>
                          )}
                        </View>
                      ))
                    )}
                  </View>
                );
              })}
            </View>
          ) : failed ? (
            <View style={styles.list}>
              <Text style={styles.empty}>
                Your projects could not be reached. They are still there.
              </Text>
              <Button
                title="Try again"
                secondary
                disabled={busy}
                onPress={() => void reload()}
              />
            </View>
          ) : projects === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : projects.length === 0 ? (
            <View style={styles.list}>
              <Text style={styles.empty}>
                No projects yet. Group related tasks into stages and see a piece
                of work end to end.
              </Text>
              {draft === null ? (
                <Button
                  title="New project"
                  secondary
                  disabled={busy}
                  onPress={() => setDraft("")}
                />
              ) : (
                <View style={styles.newRow}>
                  <TextInput
                    style={styles.nameInput}
                    value={draft}
                    autoFocus
                    maxLength={120}
                    placeholder="What is it called?"
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="New project name"
                    onChangeText={setDraft}
                    onSubmitEditing={create}
                  />
                  <Button
                    title="Create"
                    disabled={busy || !draft.trim()}
                    onPress={create}
                  />
                </View>
              )}
            </View>
          ) : (
            <View style={styles.list}>
              {draft === null ? (
                <Button
                  title="New project"
                  secondary
                  disabled={busy}
                  onPress={() => setDraft("")}
                />
              ) : (
                <View style={styles.newRow}>
                  <TextInput
                    style={styles.nameInput}
                    value={draft}
                    autoFocus
                    maxLength={120}
                    placeholder="What is it called?"
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="New project name"
                    onChangeText={setDraft}
                    onSubmitEditing={create}
                  />
                  <View style={styles.actions}>
                    <SmallAction
                      label="Cancel"
                      disabled={busy}
                      onPress={() => setDraft(null)}
                    />
                    <Button
                      title="Create"
                      disabled={busy || !draft.trim()}
                      onPress={create}
                    />
                  </View>
                </View>
              )}
              {projects.map((p) => (
                <Pressable
                  key={p.id}
                  style={({ pressed }) => [
                    styles.card,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() =>
                    void run(async () => setOpen(await client.getProject(p.id)))
                  }
                >
                  <View style={styles.cardTop}>
                    <Icon name="boxes" size={16} color={colors.muted} />
                    <Text style={styles.cardName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {projectAtRisk(p) && (
                      <Text style={styles.chip}>At risk</Text>
                    )}
                  </View>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${projectProgress(p)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.meta}>
                    {p.done_count} of {p.task_count} done ·{" "}
                    {dueLabel(p.deadline)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { gap: 10 },
    card: {
      gap: 8,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    moveButton: { padding: 4 },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    cardName: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.semibold,
    },
    chip: {
      color: colors.warning,
      backgroundColor: colors.warningSoft,
      fontSize: 11,
      fontFamily: fonts.semibold,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      overflow: "hidden",
    },
    bar: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.soft,
      overflow: "hidden",
    },
    barFill: { height: 6, backgroundColor: colors.accent, borderRadius: 3 },
    meta: { color: colors.muted, fontSize: 12 },
    page: { gap: 10 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    newRow: { gap: 8 },
    nameInput: {
      color: colors.text,
      fontSize: 16,
      fontFamily: fonts.semibold,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 20,
      fontFamily: fonts.display,
    },
    summary: { color: colors.muted, fontSize: 14, lineHeight: 20 },
    stage: {
      gap: 6,
      marginTop: 6,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    stageHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    stageName: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontFamily: fonts.semibold,
    },
    stageCount: { color: colors.muted, fontSize: 12 },
    task: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 4,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.muted,
    },
    dotDone: { backgroundColor: colors.accent, borderColor: colors.accent },
    taskText: { flex: 1, color: colors.text, fontSize: 14 },
    taskDone: { color: colors.muted, textDecorationLine: "line-through" },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  }),
);
