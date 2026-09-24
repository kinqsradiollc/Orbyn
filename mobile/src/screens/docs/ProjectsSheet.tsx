import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  changeProjectDeadline,
  projectAtRisk,
  projectDeadlineAt,
  projectDeadlineParts,
  projectProgress,
  projectReentry,
  type Item,
  type Project,
  type ProjectActivity,
  type Proposal,
  type Team,
} from "@orbyn/core";
import { Segmented } from "../../components/Segmented";
import { ScreenIntro } from "../../components/ScreenIntro";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ClockField, DateField } from "../../components/Field";
import { ErrorBanner } from "../../components/ErrorBanner";
import { MoreMenu } from "../../components/MoreMenu";
import { SmallAction } from "../../components/SmallAction";
import { confirmAction } from "../../lib/confirm";
import { Icon } from "../../components/Icon";
import { ProposalReview } from "../../components/ProposalReview";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { ProjectNotes } from "./ProjectNotes";
import { TemplatesPanel } from "./TemplatesPanel";
import { ProjectTimeline } from "./ProjectTimeline";
import { ProjectRecords } from "./ProjectRecords";
import { ProjectTimeMachine } from "./ProjectTimeMachine";
import { PromiseTracker } from "./PromiseTracker";
import { colors, fonts, radii, themed } from "../../theme";
import { errorText } from "../../lib/errors";
import { deviceTimeZone } from "../../lib/planning";

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
  teams = [],
  openTemplate = null,
  canWriteIn,
  userId,
  onClose,
  onDismiss,
  onOpenItem,
  onOpenNote,
  onItemsChanged,
}: {
  visible: boolean;
  items: Item[];
  /** For starting a template's project in a team. */
  teams?: Team[];
  /** Open on this template (from a "ready to start" notice). */
  openTemplate?: string | null;
  canWriteIn: (teamId: string | null) => boolean;
  userId?: string;
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
  const [newSummary, setNewSummary] = useState("");
  const [newTeam, setNewTeam] = useState<string | null>(null);
  const [newDue, setNewDue] = useState<string | null>(null);
  const [section, setSection] = useState<
    "tasks" | "notes" | "timeline" | "decisions" | "history"
  >("tasks");
  const [activity, setActivity] = useState<ProjectActivity[] | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [reentry, setReentry] = useState<ReturnType<
    typeof projectReentry
  > | null>(null);
  /** A name being typed, for a new project or a rename. */
  const [draft, setDraft] = useState<string | null>(null);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(!!openTemplate);
  useEffect(() => {
    if (openTemplate && visible) {
      setOpen(null);
      setAiDraftOpen(false);
      setTemplatesOpen(true);
    }
  }, [openTemplate, visible]);
  const [projectPrompt, setProjectPrompt] = useState("");
  const [projectProposal, setProjectProposal] = useState<Proposal | null>(null);
  const [proposalState, setProposalState] = useState<"pending" | "applied">(
    "pending",
  );
  const { busy, error, setError, run } = useRun();

  useEffect(() => {
    if (!visible || !open || section !== "history") return;
    let active = true;
    setActivity(null);
    setLastSeen(null);
    const key = `orbyn.project.seen.${open.id}`;
    void AsyncStorage.getItem(key)
      .then((previous) => {
        if (!active) return;
        setLastSeen(previous);
        return client.projectActivity(open.id).then(async (rows) => {
          if (!active) return;
          setActivity(rows);
          await AsyncStorage.setItem(key, new Date().toISOString());
        });
      })
      .catch((e: Error) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [visible, open?.id, section, setError]);

  useEffect(() => {
    if (!visible || !open) return;
    let active = true;
    const key = `orbyn.project.reentry.${open.id}`;
    void AsyncStorage.getItem(key)
      .then(async (previous) => {
        const rows = await client.projectActivity(open.id);
        if (!active) return;
        setReentry(
          previous
            ? projectReentry(rows.filter((row) => row.created_at > previous))
            : null,
        );
        await AsyncStorage.setItem(key, new Date().toISOString());
      })
      .catch((reason: Error) => {
        if (active)
          setError(reason.message || "Could not load project changes.");
      });
    return () => {
      active = false;
    };
  }, [visible, open?.id, setError]);

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

  /** The open project's deadline as the day and time it is here. */
  const openDeadline = open?.deadline
    ? projectDeadlineParts(open.deadline, deviceTimeZone())
    : null;

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
        setError(errorText(e));
      },
    );

  const create = () => {
    const name = (draft ?? "").trim();
    if (!name) return;
    void run(async () => {
      const made = await client.createProject({
        name,
        summary: newSummary.trim(),
        team_id: newTeam,
        // 5 pm on the day, where you are (the same rule as editing it).
        deadline: newDue
          ? projectDeadlineAt(newDue, null, deviceTimeZone())
          : null,
      });
      setDraft(null);
      setNewSummary("");
      setNewTeam(null);
      setNewDue(null);
      await reload();
      setOpen(made);
      setSection("tasks");
    });
  };

  // One form for a new project, in the empty state and above the list: the
  // name, what it's for, whose it is and when it's due, as on the desktop.
  const writableTeams = teams.filter((t) => canWriteIn(t.id));
  const newProjectForm = (
    <View style={styles.newForm}>
      <TextInput
        style={styles.nameInput}
        value={draft ?? ""}
        autoFocus
        maxLength={120}
        placeholder="What is it called?"
        placeholderTextColor={colors.faint}
        accessibilityLabel="New project name"
        onChangeText={setDraft}
      />
      <TextInput
        style={[styles.nameInput, styles.summaryInput]}
        value={newSummary}
        multiline
        maxLength={2000}
        placeholder="What it's for (optional)"
        placeholderTextColor={colors.faint}
        accessibilityLabel="What the project is for"
        onChangeText={setNewSummary}
      />
      {writableTeams.length > 0 && (
        <ChipRow label="Whose project">
          <Chip
            label="Just me"
            selected={newTeam === null}
            onPress={() => setNewTeam(null)}
          />
          {writableTeams.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              selected={newTeam === t.id}
              onPress={() => setNewTeam(t.id)}
            />
          ))}
        </ChipRow>
      )}
      <DateField
        label="Deadline"
        value={newDue}
        clearable
        placeholder="No deadline (optional)"
        onChange={setNewDue}
      />
      <View style={styles.createMore}>
        <Button
          title="Cancel"
          secondary
          disabled={busy}
          style={styles.createHalf}
          onPress={() => setDraft(null)}
        />
        <Button
          title="Create project"
          disabled={busy || !(draft ?? "").trim()}
          style={styles.createHalf}
          onPress={create}
        />
      </View>
    </View>
  );

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
  // Only tasks in the open project's own space can be filed into it.
  const unfiled = items.filter(
    (i) =>
      !i.project_id &&
      i.kind === "task" &&
      (i.team_id ?? null) === (open?.team_id ?? null),
  );

  const tasksIn = (project: Project, stageId: string | null) =>
    items.filter(
      (i) =>
        i.project_id === project.id &&
        (stageId === null
          ? !i.stage_id || !project.stages.some((s) => s.id === i.stage_id)
          : i.stage_id === stageId),
    );

  // One full-width way in, and the two quicker starts side by side: the
  // same on an empty list as above a full one.
  const createButtons = (
    <View style={styles.createActions}>
      <Button
        title="New project"
        icon="plus"
        disabled={busy}
        style={styles.createButtonFull}
        onPress={() => setDraft("")}
      />
      <View style={styles.createMore}>
        <Button
          title="Draft with AI"
          secondary
          icon="sparkles"
          disabled={busy}
          style={styles.createHalf}
          onPress={startAiDraft}
        />
        <Button
          title="Template"
          secondary
          icon="layoutGrid"
          disabled={busy}
          style={styles.createHalf}
          onPress={() => setTemplatesOpen(true)}
        />
      </View>
    </View>
  );
  return (
    <Sheet
      visible={visible}
      title={
        open
          ? open.name
          : aiDraftOpen
            ? "Draft a project"
            : templatesOpen
              ? "Templates"
              : "Projects"
      }
      onClose={onClose}
      onBack={
        open
          ? () => setOpen(null)
          : aiDraftOpen
            ? () => setAiDraftOpen(false)
            : templatesOpen
              ? () => setTemplatesOpen(false)
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
          {!open && !aiDraftOpen && !templatesOpen && !!projects?.length && (
            <ScreenIntro
              icon="boxes"
              title="Move the bigger picture forward"
              detail="See what’s progressing, what’s next and what needs your attention."
            />
          )}
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {!open && !aiDraftOpen && !templatesOpen && (
            <PromiseTracker
              userId={userId}
              canWriteIn={canWriteIn}
              onError={setError}
              onProject={(id) =>
                void run(async () => {
                  setOpen(await client.getProject(id));
                  setSection("tasks");
                })
              }
            />
          )}

          {templatesOpen ? (
            <TemplatesPanel
              teams={teams}
              items={items}
              initialId={openTemplate}
              busy={busy}
              run={run}
              onStarted={() => {
                void reload();
                onItemsChanged?.();
              }}
            />
          ) : aiDraftOpen ? (
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
                  {canWriteIn(open.team_id) && (
                    <MoreMenu
                      label="Project options"
                      disabled={busy}
                      actions={[
                        { label: "Rename", onPress: () => setDraft(open.name) },
                        {
                          label: "Delete project",
                          destructive: true,
                          onPress: remove,
                        },
                      ]}
                    />
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
                />
              )}
              {draft !== null && (
                <View style={styles.actions}>
                  <SmallAction label="Save" disabled={busy} onPress={rename} />
                  <SmallAction
                    label="Cancel"
                    disabled={busy}
                    onPress={() => setDraft(null)}
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
              {reentry && reentry.total > 0 && (
                <View style={styles.reentry}>
                  <Text style={styles.reentryTitle}>Since your last visit</Text>
                  <Text style={styles.meta}>
                    {reentry.total} change{reentry.total === 1 ? "" : "s"}
                    {reentry.completedTasks > 0
                      ? ` · ${reentry.completedTasks} completed`
                      : ""}
                    {reentry.changedRecords > 0
                      ? ` · ${reentry.changedRecords} commitment updates`
                      : ""}
                  </Text>
                  {reentry.recent.map((summary, index) => (
                    <Text key={`${summary}-${index}`} style={styles.meta}>
                      • {summary}
                    </Text>
                  ))}
                  <SmallAction
                    label="View history"
                    disabled={busy}
                    onPress={() => setSection("history")}
                  />
                </View>
              )}
              {/* The desktop has a date field beside the progress bar; the
                  phone only ever said what the deadline was. */}
              {canWriteIn(open.team_id) && (
                <>
                  <DateField
                    label="Deadline"
                    clearable
                    placeholder="No deadline"
                    value={openDeadline?.day ?? null}
                    onChange={(day) =>
                      save({
                        deadline: changeProjectDeadline(
                          open.deadline,
                          { day },
                          deviceTimeZone(),
                        ),
                      })
                    }
                  />
                  {/* 5 pm unless another time is picked. */}
                  {openDeadline && (
                    <ClockField
                      label="Deadline time"
                      value={openDeadline.clock}
                      disabled={busy}
                      onChange={(clock) =>
                        save({
                          deadline: changeProjectDeadline(
                            open.deadline,
                            { clock },
                            deviceTimeZone(),
                          ),
                        })
                      }
                    />
                  )}
                </>
              )}

              <Segmented
                accessibilityLabel="Project section"
                options={
                  onOpenNote
                    ? ([
                        "tasks",
                        "notes",
                        "timeline",
                        "decisions",
                        "history",
                      ] as const)
                    : (["tasks", "timeline", "decisions", "history"] as const)
                }
                labels={{ history: "History", decisions: "Decisions" }}
                value={section}
                onChange={setSection}
              />
              {section === "timeline" && (
                <ProjectTimeline
                  project={open}
                  tasks={items.filter((i) => i.project_id === open.id)}
                />
              )}

              {section === "decisions" && (
                <ProjectRecords
                  project={open}
                  items={items}
                  userId={userId}
                  canWrite={canWriteIn(open.team_id)}
                  onOpenNote={onOpenNote}
                />
              )}

              {section === "history" && (
                <View style={styles.projectHistory}>
                  <Text style={styles.historyHeading}>Project history</Text>
                  <Text style={styles.historyDescription}>
                    Changes to the project, its tasks, and its notes.
                  </Text>
                  <ProjectTimeMachine projectId={open.id} />
                  {activity === null ? (
                    <Text style={styles.meta}>Loading project history…</Text>
                  ) : activity.length === 0 ? (
                    <Text style={styles.meta}>
                      Changes will appear here as work on this project evolves.
                    </Text>
                  ) : (
                    <>
                      {lastSeen && (
                        <Text style={styles.historyCatchup}>
                          {
                            activity.filter(
                              (event) => event.created_at > lastSeen,
                            ).length
                          }{" "}
                          {activity.filter(
                            (event) => event.created_at > lastSeen,
                          ).length === 1
                            ? "change since your last visit"
                            : "changes since your last visit"}
                        </Text>
                      )}
                      {activity.map((event) => (
                        <View key={event.id} style={styles.historyEntry}>
                          <Text style={styles.historySummary}>
                            {event.summary}
                          </Text>
                          <Text style={styles.historyMeta}>
                            {event.actor_name ?? "Workspace activity"} ·{" "}
                            {new Date(event.created_at).toLocaleString([], {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              )}

              {section === "notes" && !!onOpenNote && (
                <ProjectNotes
                  projectId={open.id}
                  teamId={open.team_id}
                  canWrite={canWriteIn(open.team_id)}
                  busy={busy}
                  report={(e) => setError(errorText(e))}
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
                              {/* What you can do to a stage lives behind its
                              ⋯, so the list reads as tasks, not buttons.
                              "No stage" is not a stage: it can only be
                              filled. */}
                              {canWriteIn(open.team_id) && (
                                <MoreMenu
                                  label={`${stage.name} options`}
                                  disabled={busy}
                                  actions={[
                                    {
                                      label:
                                        filling === stage.id
                                          ? "Stop adding tasks"
                                          : "Add a task from your list",
                                      onPress: () =>
                                        setFilling(
                                          filling === stage.id
                                            ? undefined
                                            : stage.id,
                                        ),
                                    },
                                    ...(stage.id === null
                                      ? []
                                      : [
                                          {
                                            label: "Rename stage",
                                            onPress: () =>
                                              setStageDraft({
                                                id: stage.id as string,
                                                name: stage.name,
                                              }),
                                          },
                                          {
                                            label: "Remove stage",
                                            destructive: true,
                                            onPress: () =>
                                              removeStage({
                                                id: stage.id as string,
                                                name: stage.name,
                                              }),
                                          },
                                        ]),
                                  ]}
                                />
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
                <View style={styles.emptyActions}>{createButtons}</View>
              ) : (
                <View style={styles.emptyActions}>{newProjectForm}</View>
              )}
            </View>
          ) : (
            <View style={styles.list}>
              {draft === null ? createButtons : newProjectForm}
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
    newForm: { gap: 12 },
    summaryInput: { minHeight: 76, paddingTop: 12, textAlignVertical: "top" },
    createMore: { flexDirection: "row", gap: 8 },
    // The container's gap spaces these; the button's own margin would double it.
    createButtonFull: { marginBottom: 0 },
    createHalf: { flex: 1, minWidth: 0, marginBottom: 0 },
    emptyActions: { alignSelf: "stretch", marginTop: 8 },
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
      paddingHorizontal: 20,
      paddingTop: 32,
      paddingBottom: 20,
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
    reentry: {
      gap: 7,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    reentryTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
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
    projectHistory: {
      gap: 10,
      marginTop: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    historyHeading: {
      color: colors.text,
      fontSize: 16,
      fontFamily: fonts.semibold,
    },
    historyDescription: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    historyCatchup: {
      padding: 10,
      borderRadius: radii.input,
      backgroundColor: colors.accentSoft,
      color: colors.text,
      fontSize: 13,
      fontFamily: fonts.medium,
    },
    historyEntry: {
      gap: 4,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    historySummary: { color: colors.text, fontSize: 14, lineHeight: 20 },
    historyMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
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
    stageAdd: { flexDirection: "row", marginTop: 2 },
    stageName: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontFamily: fonts.semibold,
    },
    stageCount: { color: colors.muted, fontSize: 12 },
    // The move button carries the 44pt target, so the row needs no padding
    // of its own; rows stay one line apart instead of drifting.
    task: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 2,
      minHeight: 48,
      borderRadius: radii.input,
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
