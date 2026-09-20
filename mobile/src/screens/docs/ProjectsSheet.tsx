import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  projectAtRisk,
  projectProgress,
  type Item,
  type Project,
} from "@orbyn/core";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
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
}: {
  visible: boolean;
  items: Item[];
  onClose: () => void;
  onDismiss?: () => void;
  onOpenItem?: (item: Item) => void;
}) {
  const sheet = sheetStyles;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState<Project | null>(null);
  const { error, setError, run } = useRun();

  useEffect(() => {
    if (!visible) return;
    client.listProjects().then(setProjects, () => setProjects([]));
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
              <View style={styles.titleRow}>
                <Text style={styles.title}>{open.name}</Text>
                {projectAtRisk(open) && (
                  <Text style={styles.chip}>At risk</Text>
                )}
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
                        <Pressable
                          key={item.id}
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
                        </Pressable>
                      ))
                    )}
                  </View>
                );
              })}
            </View>
          ) : projects === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : projects.length === 0 ? (
            <Text style={styles.empty}>
              No projects yet. Start one on the desktop and it will show here.
            </Text>
          ) : (
            <View style={styles.list}>
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
