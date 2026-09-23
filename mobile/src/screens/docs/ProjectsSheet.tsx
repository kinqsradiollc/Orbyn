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
  type Proposal,
} from "@orbyn/core";
import { Segmented } from "../../components/Segmented";
import { ScreenIntro } from "../../components/ScreenIntro";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { DateField } from "../../components/Field";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SmallAction } from "../../components/SmallAction";
import { confirmAction } from "../../lib/confirm";
import { Icon } from "../../components/Icon";
import { ProposalReview } from "../../components/ProposalReview";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { ProjectNotes } from "./ProjectNotes";
import { ProjectTimeline } from "./ProjectTimeline";
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
  canWriteIn,
  onClose,
  onDismiss,
  onOpenItem,
  onOpenNote,
  onItemsChanged,
}: {
  visible: boolean;
  items: Item[];
  canWriteIn: (teamId: string | null) => boolean;
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
  const [section, setSection] = useState<"tasks" | "notes" | "timeline">(
    "tasks",
  );
  /** A name being typed, for a new project or a rename. */
  const [draft, setDraft] = useState<string | null>(null);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [projectPrompt, setProjectPrompt] = useState("");
  const [projectProposal, setProjectProposal] = useState<Proposal | null>(null);
  const [proposalState, setProposalState] = useState<"pending" | "applied">(
    "pending",
  );
  const { busy, error, setError, run } = useRun();

  /** True when the list could not be read, which is not the same as empty. */
  const [failed, setFailed] = useState(false);
  /** The task whose stage is being chosen, if any. */
  const [moving, setMoving] = useState<string | null>(null);
  /**
   * A stage being named. `id` null means a new one. The desktop asks with
   * `prompt`, which a phone has not got, so the name is typed in place.
   */
  const [stageDraft, setStageDraft] = useState<{
    id: string | null;
    name: string;
  } | null>(null);
  /** The stage an existing task is being picked for, if any. */
  const [filling, setFilling] = useState<string | null | undefined>(undefined);

  /** Save a patch to the open project and keep the list in step. */
  const save = (patch: Parameters<typeof client.updateProject>[1]) =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
      setOpen(await client.updateProject(open.id, patch));
      await reload();
    });

  /** The stages as the API wants them back: every one, named. */
  const stagesOf = (project: Project) =>
    project.stages.map((st) => ({ id: st.id, name: st.name }));

  /** Add a stage, or rename the one being edited. */
  const saveStage = () => {
    const name = (stageDraft?.name ?? "").trim();
    if (!open || !name) return setStageDraft(null);
    const id = stageDraft?.id ?? null;
    save({
      stages:
        id === null
          ? [...stagesOf(open), { name }]
          : stagesOf(open).map((st) => (st.id === id ? { ...st, name } : st)),
    });
    setStageDraft(null);
  };

  const removeStage = (stage: { id: string; name: string }) => {
    if (!open) return;
    confirmAction(
      `Remove the “${stage.name}” stage?`,
      "Its tasks stay in the project, without a stage.",
      "Remove",
      () => save({ stages: stagesOf(open).filter((st) => st.id !== stage.id) }),
    );
  };

  /** Take a task out of the project altogether; it stays in the planner. */
  const unfile = (item: Item) =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
      await client.setItemProject(item.id, { project_id: null });
      setMoving(null);
      onItemsChanged?.();
    });

  /**
   * Move a task to another stage. The desktop does this by dragging across a
   * board; a phone has no room for one, so the stages are offered as a list
   * under the task instead.
   */
  const moveTo = (item: Item, stageId: string | null) =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
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
      setSection("tasks");
    });
  };

  const startAiDraft = () => {
    setDraft(null);
    setProjectPrompt("");
    setProjectProposal(null);
    setProposalState("pending");
    setAiDraftOpen(true);
  };

  const draftWithAi = () => {
    const prompt = projectPrompt.trim();
    if (!prompt || busy) return;
    void run(async () => {
      const proposal = await client.draftProject(
        prompt,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setProjectProposal(proposal);
      setProposalState("pending");
    });
  };

  const applyAiDraft = () => {
    if (!projectProposal || busy) return;
    void run(async () => {
      await client.applyProposal(projectProposal.id);
      setProposalState("applied");
      await reload();
      onItemsChanged?.();
    });
  };

  const rename = () => {
    const name = (draft ?? "").trim();
    if (!open || !canWriteIn(open.team_id) || !name || name === open.name)
      return setDraft(null);
    void run(async () => {
      const saved = await client.updateProject(open.id, { name });
      setOpen(saved);
      setDraft(null);
      await reload();
    });
  };

  const remove = () => {
    if (!open || !canWriteIn(open.team_id)) return;
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

  /** Tasks in no project at all, which any stage can take. */
  const unfiled = items.filter((i) => !i.project_id && i.kind === "task");

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
      title={open ? open.name : aiDraftOpen ? "Draft a project" : "Projects"}
      onClose={onClose}
      onBack={
        open
          ? () => setOpen(null)
          : aiDraftOpen
            ? () => setAiDraftOpen(false)
            : undefined
      }
      onDismiss={onDismiss}
    >
      <ScrollView
        contentContainerStyle={sheet.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheet.column}>
          {!open && !aiDraftOpen && !!projects?.length && (
            <ScreenIntro
              icon="boxes"
              title="Move the bigger picture forward"
              detail="See what’s progressing, what’s next and what needs your attention."
            />
          )}
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {aiDraftOpen ? (
            <View style={styles.aiDraft}>
              <View style={styles.aiHeading}>
                <View style={styles.aiIcon}>
                  <Icon name="sparkles" size={19} color={colors.accent} />
                </View>
                <View style={styles.aiHeadingText}>
                  <Text style={styles.aiTitle}>Shape your project</Text>
                  <Text style={styles.aiDescription}>
                    Describe the goal and any deadline. Review the tasks and
                    schedule before creating it.
                  </Text>
                </View>
              </View>
              {!projectProposal ? (
                <>
                  <TextInput
                    style={styles.promptInput}
                    value={projectPrompt}
                    onChangeText={setProjectPrompt}
                    multiline
                    autoFocus
                    maxLength={4000}
                    placeholder="What are you working toward?"
                    placeholderTextColor={colors.faint}
                    textAlignVertical="top"
                    accessibilityLabel="Describe your project"
                  />
                  <Button
                    title={busy ? "Drafting…" : "Draft project"}
                    icon="sparkles"
                    disabled={busy || !projectPrompt.trim()}
                    onPress={draftWithAi}
                  />
                </>
              ) : (
                <>
                  <ProposalReview
                    proposal={projectProposal}
                    items={items}
                    busy={busy}
                    state={proposalState}
                    onApprove={applyAiDraft}
                    onDiscard={() => setProjectProposal(null)}
                  />
                  {proposalState === "applied" && (
                    <Button
                      title="Back to projects"
                      secondary
                      onPress={() => setAiDraftOpen(false)}
                    />
                  )}
                </>
              )}
            </View>
          ) : open ? (
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
              {canWriteIn(open.team_id) && (
                <View style={styles.actions}>
                  <SmallAction
                    label={draft === null ? "Rename" : "Save"}
                    disabled={busy}
                    onPress={() =>
                      draft === null ? setDraft(open.name) : rename()
                    }
                  />
                  {/* Losing the project sat a thumb's width from renaming
                      it. The desktop keeps its bin off on its own in the
                      toolbar; here it goes to the far end of the row. */}
                  <View style={styles.spacer} />
                  <SmallAction
                    label="Delete project"
                    destructive
                    disabled={busy}
                    onPress={remove}
                  />
                </View>
              )}
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
              {/* The desktop has a date field beside the progress bar; the
                  phone only ever said what the deadline was. */}
              {canWriteIn(open.team_id) && (
                <DateField
                  label="Deadline"
                  clearable
                  placeholder="No deadline"
                  value={
                    open.deadline
                      ? new Date(open.deadline).toISOString().slice(0, 10)
                      : null
                  }
                  onChange={(day) =>
                    save({
                      deadline: day
                        ? new Date(`${day}T12:00:00`).toISOString()
                        : null,
                    })
                  }
                />
              )}

              <Segmented
                accessibilityLabel="Project section"
                options={
                  onOpenNote
                    ? (["tasks", "notes", "timeline"] as const)
                    : (["tasks", "timeline"] as const)
                }
                value={section}
                onChange={setSection}
              />
              {section === "timeline" && (
                <ProjectTimeline
                  project={open}
                  tasks={items.filter((i) => i.project_id === open.id)}
                />
              )}

              {section === "notes" && !!onOpenNote && (
                <ProjectNotes
                  projectId={open.id}
                  teamId={open.team_id}
                  canWrite={canWriteIn(open.team_id)}
                  busy={busy}
                  report={(e) => setError((e as Error).message)}
                  onOpen={onOpenNote}
                />
              )}

              {section === "tasks" && (
                <>
                  {[...open.stages, { id: null, name: "No stage" }].map(
                    (stage) => {
                      const rows = tasksIn(open, stage.id as string | null);
                      return (
                        <View key={stage.id ?? "none"} style={styles.stage}>
                          {stageDraft?.id && stageDraft.id === stage.id ? (
                            <TextInput
                              style={styles.nameInput}
                              value={stageDraft.name}
                              autoFocus
                              maxLength={80}
                              placeholder="Stage name"
                              placeholderTextColor={colors.faint}
                              accessibilityLabel="Stage name"
                              onChangeText={(name) =>
                                setStageDraft({ id: stage.id, name })
                              }
                              onSubmitEditing={saveStage}
                              onBlur={saveStage}
                            />
                          ) : (
                            <View style={styles.stageHead}>
                              <Text style={styles.stageName}>{stage.name}</Text>
                              <Text style={styles.stageCount}>
                                {rows.length}
                              </Text>
                            </View>
                          )}
                          {/* Everything you can do to a stage, on one row under
                        its name: putting them beside the name wrapped "In
                        progress" onto two lines. Naming a stage and getting
                        rid of one were on the desktop only, as was filling a
                        stage from the tasks that are in no project — without
                        it the only way onto a phone's board was to make a
                        task and then move it. "No stage" is not a stage, so
                        it can only be filled. */}
                          {canWriteIn(open.team_id) && (
                            <View style={styles.stageActions}>
                              <SmallAction
                                label={
                                  filling === stage.id
                                    ? "Never mind"
                                    : "Add a task"
                                }
                                disabled={busy}
                                onPress={() =>
                                  setFilling(
                                    filling === stage.id ? undefined : stage.id,
                                  )
                                }
                              />
                              {stage.id !== null && (
                                <>
                                  <SmallAction
                                    label="Rename"
                                    disabled={busy}
                                    onPress={() =>
                                      setStageDraft({
                                        id: stage.id as string,
                                        name: stage.name,
                                      })
                                    }
                                  />
                                  <View style={styles.spacer} />
                                  <SmallAction
                                    label="Remove"
                                    destructive
                                    disabled={busy}
                                    onPress={() =>
                                      removeStage({
                                        id: stage.id as string,
                                        name: stage.name,
                                      })
                                    }
                                  />
                                </>
                              )}
                            </View>
                          )}
                          {filling === stage.id &&
                            (unfiled.length === 0 ? (
                              <Text style={styles.empty}>
                                Every task is already in a project.
                              </Text>
                            ) : (
                              <ChipRow label="Tasks with no project">
                                {unfiled.slice(0, 20).map((task) => (
                                  <Chip
                                    key={task.id}
                                    label={task.title}
                                    selected={false}
                                    onPress={() => {
                                      setFilling(undefined);
                                      moveTo(task, stage.id as string | null);
                                    }}
                                  />
                                ))}
                              </ChipRow>
                            ))}
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
                                  {canWriteIn(open.team_id) && (
                                    <Pressable
                                      onPress={(event) => {
                                        event.stopPropagation();
                                        setMoving((m) =>
                                          m === item.id ? null : item.id,
                                        );
                                      }}
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
                                  )}
                                </Pressable>
                                {moving === item.id && (
                                  <ChipRow label="Move to">
                                    {[
                                      ...open.stages,
                                      {
                                        id: null as string | null,
                                        name: "No stage",
                                      },
                                    ].map((to) => (
                                      <Chip
                                        key={to.id ?? "none"}
                                        label={to.name}
                                        selected={to.id === stage.id}
                                        onPress={() => moveTo(item, to.id)}
                                      />
                                    ))}
                                    {/* The desktop can take a task out of the
                                  project from here; so can the phone. */}
                                    <Chip
                                      label="Out of this project"
                                      selected={false}
                                      onPress={() => unfile(item)}
                                    />
                                  </ChipRow>
                                )}
                              </View>
                            ))
                          )}
                        </View>
                      );
                    },
                  )}

                  {canWriteIn(open.team_id) &&
                    (stageDraft && stageDraft.id === null ? (
                      <TextInput
                        style={styles.nameInput}
                        value={stageDraft.name}
                        autoFocus
                        maxLength={80}
                        placeholder="Name the new stage"
                        placeholderTextColor={colors.faint}
                        accessibilityLabel="New stage name"
                        onChangeText={(name) =>
                          setStageDraft({ id: null, name })
                        }
                        onSubmitEditing={saveStage}
                        onBlur={saveStage}
                      />
                    ) : (
                      <View style={styles.stageAdd}>
                        <SmallAction
                          label="Add a stage"
                          disabled={busy}
                          onPress={() => setStageDraft({ id: null, name: "" })}
                        />
                      </View>
                    ))}
                </>
              )}
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
            <View style={styles.emptyProject}>
              <View style={styles.emptyIcon}>
                <Icon name="boxes" size={24} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>
                Make room for the bigger picture.
              </Text>
              <Text style={styles.emptyDescription}>
                Bring related tasks together, follow their stages, and see
                what’s moving forward.
              </Text>
              {draft === null ? (
                <View style={styles.createActions}>
                  <Button
                    title="New project"
                    disabled={busy}
                    onPress={() => setDraft("")}
                  />
                  <Button
                    title="Draft with AI"
                    secondary
                    icon="sparkles"
                    disabled={busy}
                    onPress={startAiDraft}
                  />
                </View>
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
                <View style={styles.createActions}>
                  <Button
                    title="New project"
                    secondary
                    disabled={busy}
                    onPress={() => setDraft("")}
                  />
                  <Button
                    title="Draft with AI"
                    secondary
                    icon="sparkles"
                    disabled={busy}
                    onPress={startAiDraft}
                  />
                </View>
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
                  accessibilityRole="button"
                  accessibilityLabel={`Open project ${p.name}`}
                  style={({ pressed }) => [
                    styles.card,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() =>
                    void run(async () => {
                      setOpen(await client.getProject(p.id));
                      setSection("tasks");
                    })
                  }
                >
                  <View style={styles.cardTop}>
                    <Icon name="boxes" size={16} color={colors.muted} />
                    <Text style={styles.cardName}>{p.name}</Text>
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
    createActions: { gap: 8 },
    aiDraft: { gap: 16 },
    aiHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    aiHeadingText: { flex: 1, gap: 4 },
    aiIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    aiTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.text },
    aiDescription: {
      fontFamily: fonts.regular,
      fontSize: 14,
      lineHeight: 21,
      color: colors.muted,
    },
    promptInput: {
      minHeight: 128,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
    },
    emptyProject: {
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 22,
      paddingVertical: 36,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
      backgroundColor: colors.accentSoft,
    },
    emptyTitle: {
      fontFamily: fonts.display,
      fontSize: 21,
      lineHeight: 29,
      textAlign: "center",
      color: colors.text,
    },
    emptyDescription: {
      fontFamily: fonts.regular,
      fontSize: 14,
      lineHeight: 21,
      textAlign: "center",
      color: colors.muted,
      marginBottom: 8,
    },
    card: {
      gap: 8,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    moveButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    cardName: {
      flex: 1,
      color: colors.text,
      fontSize: 18,
      lineHeight: 25,
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
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    spacer: { flex: 1 },
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
    stageHead: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    stageActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 2,
    },
    stageAdd: { flexDirection: "row", marginTop: 2 },
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
      paddingVertical: 10,
      minHeight: 48,
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
