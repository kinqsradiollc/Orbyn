import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  dateLabel,
  dueLine,
  hasTeamPermission,
  isClosed,
  seriesNoteFor,
  pageAboutTask,
  projectPlace,
  statusLabels,
  statusOrder,
  type EventNoteRef,
  type Item,
  type ItemDetail,
  type ItemContext,
  type Project,
  type ItemStep,
  type ItemUpdate,
  type Priority,
  type Status,
  type Team,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { SmallAction } from "../components/SmallAction";
import { Chip, ChipRow } from "../components/Chip";
import { CelebrationHost, celebrate } from "../components/Celebration";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { LinkedText } from "../components/LinkedText";
import { AskBox } from "../components/followthrough/Asks";
import { ProofSection } from "../components/followthrough/Proofs";
import { MeetingOutcome } from "../components/followthrough/MeetingOutcome";
import { StatusPill } from "../components/Pill";
import { PlanningMeta } from "../components/PlanningMeta";
import { ProgressBar } from "../components/ProgressBar";
import { SessionsPanel } from "../components/SessionsPanel";
import { HeaderButton, Sheet, sheetStyles } from "../components/Sheet";
import { ActionSheet } from "../components/MoreMenu";
import { copyLink, shareLink } from "../lib/share";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { useNow } from "../hooks/useNow";
import { client } from "../lib/api";
import * as outbox from "../lib/outbox";
import { canJoin } from "../lib/planning";
import {
  leftLabel,
  percentOf,
  stepsLabel,
  subtasksLabel,
  timeAgo,
} from "../lib/progress";
import {
  animateLayout,
  FadeIn,
  pop,
  PressableScale,
  useReducedMotion,
} from "../motion";
import {
  controls,
  colors,
  fonts,
  radii,
  spacing,
  themed,
  statusTones,
} from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";
import { tap } from "../lib/haptics";

const PROGRESS_STEPS = [0, 25, 50, 75, 100];
/** Line height of the update box; it grows to five lines before scrolling. */
const NOTE_LINE = 21;
/** Every status, closed ones last. */
const STATUS_CHOICES: Status[] = [...statusOrder, "cancelled"];
/** A task, its subtasks and theirs: the server's limit. */
const MAX_LEVELS = 3;

const PRIORITY = themed<
  Record<Priority, { bg: string; fg: string; label: string }>
>(() => ({
  high: { bg: colors.highBg, fg: colors.highText, label: "High priority" },
  medium: {
    bg: colors.mediumBg,
    fg: colors.mediumText,
    label: "Medium priority",
  },
  low: { bg: colors.lowBg, fg: colors.lowText, label: "Low priority" },
}));

/**
 * Task detail sheet: status, progress, checklist and the updates timeline.
 * Opened by tapping a task anywhere. "Edit details" hands off to ItemEditor
 * (RootScreen closes this sheet first and reopens it afterwards).
 */
export function TaskDetail({
  visible,
  item,
  items,
  teams,
  onClose,
  onDismiss,
  onEdit,
  onFocus,
  onChanged,
  onOpenNote,
  occurrence,
  onOpenItem,
  onShowOnCalendar,
  onOpenProject,
  onAskTask,
  onOpenPage,
}: {
  visible: boolean;
  /** The row that was tapped; shown straight away while the detail loads. */
  item: Item | null;
  /** Everything loaded, for the task's parent and subtasks. */
  items: Item[];
  teams: Team[];
  /** Show another task here (a subtask, or the task above). */
  onOpenItem: (item: Item) => void;
  onClose: () => void;
  /** iOS: called once the dismiss animation has finished. */
  onDismiss?: () => void;
  /** Opens the full editor for this item. */
  onEdit: (item: Item) => void;
  /** Opens focus mode for this task. */
  onFocus: (item: Item) => void;
  /** Called after every change so lists and counts refresh. */
  onChanged: () => void;
  /**
   * Open (or start) the meeting note for an event: the class it was opened
   * on for a repeating one, or with `series`, the whole series'.
   */
  onOpenNote?: (event: Item, series?: boolean) => void;
  /** The class of a repeating event the sheet was opened on (its first start). */
  occurrence?: string | null;
  /** Show a session's day on the calendar. */
  onShowOnCalendar?: (at: string) => void;
  onOpenProject?: (id: string) => void;
  onAskTask?: (item: Item) => void;
  onOpenPage?: (id: string, blockId?: string | null) => void;
}) {
  /** The ⋯ in the header: sharing the task's link. */
  const [menu, setMenu] = useState(false);
  // Opened: it leads the search's recent list, and ⌘K's on the web.
  const openedId = visible ? item?.id : undefined;
  useEffect(() => {
    if (openedId) void client.recordRecent("task", openedId).catch(() => {});
  }, [openedId]);
  return (
    <Sheet
      avoidKeyboard={false}
      visible={visible}
      title={item?.kind === "event" ? "Event" : "Task"}
      onClose={onClose}
      onDismiss={onDismiss}
      actions={
        item ? (
          <HeaderButton
            icon="more"
            label={item.kind === "event" ? "Event options" : "Task options"}
            on={menu}
            onPress={() => setMenu(true)}
          />
        ) : undefined
      }
    >
      {item && (
        <Body
          key={item.id}
          seed={item}
          items={items}
          teams={teams}
          onEdit={onEdit}
          onFocus={onFocus}
          onChanged={onChanged}
          onOpenNote={onOpenNote}
          occurrence={occurrence}
          onOpenItem={onOpenItem}
          onShowOnCalendar={onShowOnCalendar}
          onOpenProject={onOpenProject}
          onAskTask={onAskTask}
          onOpenPage={onOpenPage}
        />
      )}
      <CelebrationHost />
      {item && (
        <ActionSheet
          visible={menu}
          label={item.kind === "event" ? "Event options" : "Task options"}
          title={item.title}
          actions={[
            {
              label: "Copy link",
              onPress: () =>
                void copyLink({ kind: "task", id: item.id }, item.title),
            },
            {
              label: "Share link…",
              onPress: () =>
                void shareLink({ kind: "task", id: item.id }, item.title),
            },
          ]}
          onClose={() => setMenu(false)}
        />
      )}
    </Sheet>
  );
}

function Body({
  seed,
  items,
  teams,
  onEdit,
  onFocus,
  onChanged,
  onOpenNote,
  occurrence,
  onOpenItem,
  onShowOnCalendar,
  onOpenProject,
  onAskTask,
  onOpenPage,
}: {
  seed: Item;
  items: Item[];
  teams: Team[];
  onEdit: (item: Item) => void;
  onFocus: (item: Item) => void;
  onChanged: () => void;
  onOpenNote?: (event: Item, series?: boolean) => void;
  occurrence?: string | null;
  onOpenItem: (item: Item) => void;
  onShowOnCalendar?: (at: string) => void;
  onOpenProject?: (id: string) => void;
  onAskTask?: (item: Item) => void;
  onOpenPage?: (id: string, blockId?: string | null) => void;
}) {
  const [newSubtask, setNewSubtask] = useState("");
  /** The task above, when it isn't among the loaded items. */
  const [fetchedParent, setFetchedParent] = useState<Item | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [context, setContext] = useState<ItemContext | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newStep, setNewStep] = useState("");
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState<Status | null>(null);
  /** The update box has focus: its status choices show above it. */
  const [composing, setComposing] = useState(false);
  const area = useRef<React.ComponentRef<typeof View>>(null);
  const keyboard = useKeyboardInset(area);
  const { fontScale } = useWindowDimensions();
  /** Progress being chosen, saved half a second after the last tap. */
  const [draft, setDraft] = useState<number | null>(null);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    client
      .getItem(seed.id)
      .then((d) => {
        if (!alive) return;
        animateLayout();
        setDetail(d);
      })
      .catch((e: Error) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
    // Reload when the task changes elsewhere, not only when another opens.
  }, [
    seed.id,
    seed.version,
    seed.status,
    seed.steps_done,
    seed.steps_total,
    seed.updates_count,
    seed.last_update_at,
  ]);
  useEffect(() => {
    if (seed.kind !== "task") return;
    let alive = true;
    void client.itemContext(seed.id).then(
      (value) => alive && setContext(value),
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [seed.id, seed.version]);

  const item: Item = detail ?? seed;
  // Opened on one class of a repeating event: that class opens its own
  // note, so a note the series keeps for every class is pointed to here.
  const [seriesNote, setSeriesNote] = useState<EventNoteRef | null>(null);
  const noteKind = seed.kind === "event" && !!seed.rrule && !!onOpenNote;
  useEffect(() => {
    if (!noteKind || !occurrence) return;
    let alive = true;
    client.eventNotes([seed.id]).then(
      (notes) =>
        alive &&
        setSeriesNote(
          seriesNoteFor(notes, {
            item_id: seed.id,
            occurrence,
            team_id: seed.team_id,
          }) ?? null,
        ),
      () => alive && setSeriesNote(null),
    );
    return () => {
      alive = false;
    };
  }, [seed.id, seed.team_id, noteKind, occurrence]);
  const team = item.team_id
    ? teams.find((t) => t.id === item.team_id)
    : undefined;
  const readOnly = !!team && !hasTeamPermission(team.role, "items:write");
  const teamName = item.team_name ?? team?.name ?? seed.team_name;
  const steps = (detail?.steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const updates = detail?.updates ?? [];
  const stepsDone = detail
    ? steps.filter((st) => st.done).length
    : (seed.steps_done ?? 0);
  const stepsTotal = detail ? steps.length : (seed.steps_total ?? 0);
  const percent = draft ?? percentOf(item);
  const tone = statusTones[item.status];
  const priority = PRIORITY[item.priority];
  const meetingUrl = item.meeting_url ?? "";
  const now = useNow(30_000, !!meetingUrl);
  const joinable = canJoin(
    { meeting_url: meetingUrl, start_at: item.due_at, end_at: item.end_at },
    now,
  );
  const canWork = item.kind === "task" && !isClosed(item.status) && !readOnly;

  /**
   * Which project a task belongs to, and which stage within it. Loaded only
   * when a task is open, since events never belong to a project.
   */
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => {
    if (item?.kind !== "task" || readOnly) return;
    // Only projects in the task's own space: a team task files into its
    // team's projects, a personal task into personal ones.
    client.listProjects().then(
      (all) =>
        setProjects(
          all.filter((p) => (p.team_id ?? null) === (item?.team_id ?? null)),
        ),
      () => setProjects([]),
    );
  }, [item?.kind, item?.team_id, readOnly]);

  const project = projects?.find((p) => p.id === detail?.project_id) ?? null;

  const putInProject = (projectId: string | null, stageId?: string | null) =>
    void run(async () => {
      await client.setItemProject(item.id, {
        project_id: projectId,
        ...(stageId === undefined ? {} : { stage_id: stageId }),
      });
      setContext(await client.itemContext(item.id));
      // `run` adopts what it is given, so hand back the item as it now is.
      return client.getItem(item.id);
    });
  const byId = new Map(items.map((i) => [i.id, i]));
  const parent = item.parent_id
    ? (byId.get(item.parent_id) ??
      (fetchedParent?.id === item.parent_id ? fetchedParent : null))
    : null;
  const parentId = item.parent_id ?? null;
  const parentKnown = !parentId || byId.has(parentId);
  useEffect(() => {
    if (!parentId || parentKnown) return;
    let alive = true;
    client
      .getItem(parentId)
      .then((p) => alive && setFetchedParent(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [parentId, parentKnown]);
  /** 1 for a task, 2 for a subtask, 3 for a subtask's subtask. */
  let level = 1;
  for (
    let p = item.parent_id, guard = 0;
    p && guard < MAX_LEVELS;
    p = byId.get(p)?.parent_id, guard++
  )
    level++;
  const subtasks = items
    .filter((i) => i.parent_id === item.id)
    .sort(
      (a, b) =>
        Number(isClosed(a.status)) - Number(isClosed(b.status)) ||
        (a.position ?? 0) - (b.position ?? 0),
    );
  const canAddSubtask =
    item.kind === "task" &&
    !readOnly &&
    !isClosed(item.status) &&
    level < MAX_LEVELS;
  const links = detail?.links ?? [];
  const left = leftLabel(item);
  const addSubtask = async () => {
    const title = newSubtask.trim();
    if (!title || busy) return;
    setBusy(true);
    setError("");
    try {
      await outbox.createItem({
        title,
        kind: "task",
        status: "todo",
        priority: item.priority,
        parent_id: item.id,
        team_id: item.team_id ?? null,
        list_id: item.list_id ?? null,
      });
      animateLayout();
      setNewSubtask("");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const cancelTask = () =>
    Alert.alert(
      "Cancel this task?",
      subtasks.length
        ? "It leaves your plans and its sessions are removed. Its subtasks stay as they are. You can reopen it later."
        : "It leaves your plans and its sessions are removed. You can reopen it later.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel task",
          style: "destructive",
          onPress: () => setStatus("cancelled"),
        },
      ],
    );

  /**
   * Run a change; the server answers with the fresh detail. Offline, a
   * change that can wait is kept on the phone (`fn` answers null) and shown
   * here as `expected`.
   */
  const run = async (
    fn: () => Promise<ItemDetail | null>,
    expected?: Partial<ItemDetail>,
  ) => {
    setBusy(true);
    setError("");
    const before = item.status;
    try {
      const answer = await fn();
      animateLayout();
      if (answer) setDetail(answer);
      else setDetail((d) => (d ? { ...d, ...expected } : d));
      const status = answer?.status ?? expected?.status ?? item.status;
      // A status change, an update or the last checklist step can finish it.
      if (status === "done" && before !== "done") {
        tap();
        celebrate(answer?.title ?? item.title);
      }
      onChanged();
      return true;
    } catch (e) {
      setError(errorText(e));
      // The task changed elsewhere (steps added, a newer version): reload it.
      if ((e as { status?: number }).status === 409)
        client.getItem(seed.id).then(setDetail, () => {});
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: Status) => {
    if (status !== item.status)
      void run(
        () =>
          outbox.postItemUpdate(item, {
            status,
          }) as Promise<ItemDetail | null>,
        { status, ...(status === "done" ? { progress: 100 } : {}) },
      );
  };
  /** Set progress by hand; saved half a second after the last change. */
  const setProgress = (value: number) => {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setDraft(next);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null;
      void run(
        () =>
          outbox.postItemUpdate(item, {
            progress: next,
          }) as Promise<ItemDetail | null>,
        { progress: next },
      ).then(() => setDraft(null));
    }, 500);
  };
  const addStep = async () => {
    const title = newStep.trim();
    if (!title) return;
    if (await run(() => client.addStep(item.id, { title }))) setNewStep("");
  };
  const postNote = async () => {
    const body = note.trim();
    const status = noteStatus && noteStatus !== item.status ? noteStatus : null;
    if (!body && !status) return;
    const ok = await run(
      () =>
        outbox.postItemUpdate(item, {
          ...(body ? { body } : {}),
          ...(status ? { status } : {}),
        }) as Promise<ItemDetail | null>,
      status ? { status } : {},
    );
    if (ok) {
      setNote("");
      setNoteStatus(null);
    }
  };
  const openEditor = () => {
    const {
      steps: _steps,
      updates: _updates,
      links: saved,
      ...rest
    } = detail ?? ({ ...seed, steps: [], updates: [] } as ItemDetail);
    // The editor sends links as { url, title } only (ids are the server's).
    onEdit({
      ...rest,
      team_name: teamName,
      ...(saved
        ? { links: saved.map(({ url, title }) => ({ url, title })) }
        : {}),
    });
  };
  const canPost =
    !busy && (!!note.trim() || (!!noteStatus && noteStatus !== item.status));

  return (
    <View
      ref={area}
      collapsable={false}
      onLayout={keyboard.onLayout}
      style={[s.fill, { paddingBottom: keyboard.inset }]}
    >
      <ScrollView
        style={s.fill}
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {/* Header */}
          <FadeIn style={s.header}>
            {!!item.parent_id && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  parent ? `Subtask of ${parent.title}` : "Subtask"
                }
                accessibilityHint={parent ? "Opens that task" : undefined}
                disabled={!parent}
                hitSlop={6}
                onPress={() => parent && onOpenItem(parent)}
                style={({ pressed }) => [s.crumb, pressed && { opacity: 0.6 }]}
              >
                <Icon name="chevronLeft" size={13} color={colors.accent} />
                <Text style={s.crumbText} numberOfLines={1}>
                  {parent ? `Subtask of ${parent.title}` : "Subtask"}
                </Text>
              </Pressable>
            )}
            <View style={s.headerTop}>
              <StatusPill status={item.status} />
              {item.kind === "event" && <Text style={s.kind}>Event</Text>}
            </View>
            <Text style={s.title} accessibilityRole="header">
              {item.title}
            </Text>
            {item.kind === "task" && onAskTask && (
              <SmallAction
                label="Ask about this task"
                disabled={busy}
                onPress={() => onAskTask(item)}
              />
            )}
            <View style={s.metaRow}>
              <View style={s.metaItem}>
                <Icon name="clock" size={14} color={colors.muted} />
                <Text style={s.metaText}>
                  {item.kind === "task" && item.due_at
                    ? // "Due" is the deadline: an all-day task is due by the end
                      // of its (last) day, one with an end time when it ends.
                      dueLine(item)
                    : `${dateLabel(item.due_at)}${
                        item.end_at
                          ? ` – ${new Date(item.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                          : ""
                      }`}
                </Text>
              </View>
              <View style={[s.chip, { backgroundColor: priority.bg }]}>
                <Text style={[s.chipText, { color: priority.fg }]}>
                  {priority.label}
                </Text>
              </View>
              {!!teamName && (
                <View
                  style={[s.chip, s.teamChip]}
                  accessibilityLabel={`Team: ${teamName}`}
                >
                  <Icon name="users" size={11} color={colors.accent} />
                  <Text style={[s.chipText, { color: colors.accent }]}>
                    {teamName}
                  </Text>
                </View>
              )}
              {!!left && (
                <View style={[s.chip, s.progressChip]}>
                  <Icon name="clock" size={11} color={colors.textSoft} />
                  <Text style={[s.chipText, { color: colors.textSoft }]}>
                    {left}
                  </Text>
                </View>
              )}
            </View>
            <PlanningMeta item={item} large />
            {!!item.location && (
              <View style={[s.metaItem, s.metaLine]}>
                <Icon name="mapPin" size={14} color={colors.muted} />
                <Text style={s.metaText}>{item.location}</Text>
              </View>
            )}
            {!!item.notes && (
              <LinkedText
                text={item.notes}
                style={s.notes}
                onError={setError}
              />
            )}
            {links.length > 0 && (
              <View style={s.links} accessibilityLabel="Links">
                {links.map((l, n) => (
                  <Pressable
                    key={`${l.url}-${n}`}
                    accessibilityRole="link"
                    accessibilityLabel={l.title || l.url}
                    accessibilityHint="Opens in your browser"
                    onPress={() =>
                      void Linking.openURL(l.url).catch(() =>
                        setError("That link couldn’t be opened."),
                      )
                    }
                    style={({ pressed }) => [
                      s.link,
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <Icon name="link" size={14} color={colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.linkTitle} numberOfLines={1}>
                        {l.title || l.url}
                      </Text>
                      {!!l.title && (
                        <Text style={shared.small} numberOfLines={1}>
                          {l.url}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
            {!!meetingUrl && (
              <View style={s.meeting}>
                <Button
                  title="Join"
                  icon="video"
                  disabled={!joinable}
                  style={s.join}
                  onPress={() =>
                    void Linking.openURL(meetingUrl).catch(() =>
                      setError("That meeting link couldn’t be opened."),
                    )
                  }
                />
                {!joinable && (
                  <Text style={shared.small}>
                    Join opens 5 minutes before the start.
                  </Text>
                )}
              </View>
            )}
          </FadeIn>

          {canWork && (
            <Button
              title="Focus on this"
              icon="target"
              onPress={() => onFocus(item)}
            />
          )}

          {item.kind === "task" && (
            <SessionsPanel
              item={item}
              canWork={canWork}
              reloadKey={[
                item.version,
                item.status,
                item.due_at,
                item.end_at,
              ].join("|")}
              onChanged={onChanged}
              onShowOnCalendar={onShowOnCalendar}
            />
          )}

          {readOnly && (
            <View style={s.viewOnly}>
              <Icon name="users" size={16} color={colors.accent} />
              <Text style={s.viewOnlyText}>
                View only — you’re a viewer in {teamName}. You can read steps
                and updates but not change them.
              </Text>
            </View>
          )}

          {/* Status */}
          <Text style={shared.label}>Status</Text>
          <StatusChoice
            value={item.status}
            disabled={readOnly || busy}
            onChange={setStatus}
            accessibilityLabel="Task status"
          />

          {item.kind === "task" && !!item.team_id && (
            <AskBox itemId={item.id} onChanged={onChanged} />
          )}

          {/* Progress */}
          <FadeIn index={1} style={[shared.card, s.progressCard]}>
            <View style={s.progressTop}>
              <Text style={shared.sectionTitle}>Progress</Text>
              <Text style={[s.bigPercent, { color: tone.fg }]}>{percent}%</Text>
            </View>
            <ProgressBar
              value={percent}
              height={10}
              color={tone.fg}
              track={colors.surfaceMuted}
              label={`${item.title} progress`}
            />
            {stepsTotal > 0 ? (
              <Text style={[shared.small, s.progressHint]}>
                {stepsLabel(stepsDone, stepsTotal)} · Progress follows the
                checklist
              </Text>
            ) : readOnly ? null : item.status === "done" ? (
              <Text style={[shared.small, s.progressHint]}>
                Reopen the task to change its progress.
              </Text>
            ) : (
              <>
                <Text style={[shared.small, s.progressHint]}>
                  No checklist yet. Set progress by hand:
                </Text>
                <View style={s.segments} accessibilityRole="radiogroup">
                  {PROGRESS_STEPS.map((value) => {
                    const active = percent === value;
                    const filled = value > 0 && percent >= value;
                    return (
                      <PressableScale
                        key={value}
                        accessibilityRole="radio"
                        accessibilityLabel={`Set progress to ${value}%`}
                        accessibilityState={{ checked: active, disabled: busy }}
                        disabled={busy}
                        onPress={() => !active && setProgress(value)}
                        style={[
                          s.segment,
                          filled && { backgroundColor: tone.bg },
                          active && { borderColor: tone.fg },
                        ]}
                      >
                        <Text
                          style={[
                            s.segmentText,
                            (filled || active) && { color: tone.fg },
                          ]}
                        >
                          {value}%
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
                <View style={s.stepper}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="5% less"
                    accessibilityState={{ disabled: busy || percent <= 0 }}
                    disabled={busy || percent <= 0}
                    onPress={() => setProgress(percent - 5)}
                    style={[s.stepperButton, (busy || percent <= 0) && s.faded]}
                  >
                    <Text style={s.stepperText}>−5%</Text>
                  </PressableScale>
                  <Text style={s.stepperValue} accessibilityLiveRegion="polite">
                    {percent}%
                  </Text>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="5% more"
                    accessibilityState={{ disabled: busy || percent >= 100 }}
                    disabled={busy || percent >= 100}
                    onPress={() => setProgress(percent + 5)}
                    style={[
                      s.stepperButton,
                      (busy || percent >= 100) && s.faded,
                    ]}
                  >
                    <Text style={s.stepperText}>+5%</Text>
                  </PressableScale>
                </View>
              </>
            )}
          </FadeIn>

          {item.kind === "task" && (
            <ProofSection itemId={item.id} canWrite={!readOnly} />
          )}
          {item.kind === "event" &&
            (!!item.team_id || !!detail?.attendees?.length) && (
              <MeetingOutcome
                item={
                  {
                    ...item,
                    attendees: detail?.attendees ?? item.attendees,
                  } as Item
                }
                canWrite={!readOnly}
              />
            )}

          {/* Which project this belongs to, and where in it. */}
          {item.kind === "task" &&
            (context?.project || (!readOnly && !!projects?.length)) && (
              <FadeIn index={2} style={shared.card}>
                <View style={s.cardHeading}>
                  <Text style={shared.sectionTitle} accessibilityRole="header">
                    Project
                  </Text>
                </View>
                {!!context?.project && !!onOpenProject && (
                  <Chip
                    label={`Open ${projectPlace(context.project)}`}
                    selected={false}
                    onPress={() => onOpenProject(context.project!.id)}
                  />
                )}
                {!readOnly && !!projects?.length && (
                  <ChipRow label="Project">
                    <Chip
                      label="None"
                      selected={!project}
                      disabled={busy}
                      onPress={() => putInProject(null)}
                    />
                    {projects.map((p) => (
                      <Chip
                        key={p.id}
                        label={p.name}
                        selected={project?.id === p.id}
                        disabled={busy}
                        onPress={() => putInProject(p.id)}
                      />
                    ))}
                  </ChipRow>
                )}
                {!readOnly && !!project && (
                  <ChipRow label="Stage">
                    <Chip
                      label="No stage"
                      selected={!detail?.stage_id}
                      disabled={busy}
                      onPress={() => putInProject(project.id, null)}
                    />
                    {project.stages.map((stage) => (
                      <Chip
                        key={stage.id}
                        label={stage.name}
                        selected={detail?.stage_id === stage.id}
                        disabled={busy}
                        onPress={() => putInProject(project.id, stage.id)}
                      />
                    ))}
                  </ChipRow>
                )}
              </FadeIn>
            )}
          {item.kind === "task" && !!onOpenPage && (
            <FadeIn index={2} style={shared.card}>
              <Text style={shared.sectionTitle} accessibilityRole="header">
                Pages
              </Text>
              {!!context?.came_from && (
                <View>
                  <Chip
                    label={`Came from ${context.came_from.title}`}
                    selected={false}
                    onPress={() =>
                      onOpenPage(
                        context.came_from!.doc_id,
                        context.came_from!.block_id,
                      )
                    }
                  />
                  {!!context.came_from.quote && (
                    <Text style={shared.small}>
                      “{context.came_from.quote}”
                    </Text>
                  )}
                </View>
              )}
              {context?.pages.map((page) => (
                <Chip
                  key={page.id}
                  label={page.title}
                  selected={false}
                  onPress={() => onOpenPage(page.id, page.block_id)}
                />
              ))}
              {!readOnly && (
                <Chip
                  label="New page about this task"
                  selected={false}
                  onPress={() =>
                    void client.createDoc(pageAboutTask(item)).then(
                      (doc) => onOpenPage(doc.id),
                      (e) => setError(errorText(e)),
                    )
                  }
                />
              )}
            </FadeIn>
          )}

          {/* Subtasks */}
          {item.kind === "task" && (subtasks.length > 0 || canAddSubtask) && (
            <FadeIn index={2} style={shared.card}>
              <View style={s.cardHeading}>
                <Text style={shared.sectionTitle} accessibilityRole="header">
                  Subtasks
                </Text>
                {subtasks.length > 0 && (
                  <Text style={s.counter}>
                    {subtasksLabel(item) ||
                      `${subtasks.filter((c) => c.status === "done").length} of ${subtasks.length}`}
                  </Text>
                )}
              </View>
              {!subtasks.length && (
                <Text style={[shared.small, s.gapBelow]}>
                  Split bigger work into tasks of their own, each with its own
                  date and estimate.
                </Text>
              )}
              {subtasks.map((c, n) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.title}, ${statusLabels[c.status]}, ${percentOf(c)}%`}
                  accessibilityHint="Opens this subtask"
                  onPress={() => onOpenItem(c)}
                  style={({ pressed }) => [
                    s.subtask,
                    n > 0 && s.stepDivider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[s.stepText, isClosed(c.status) && s.stepDone]}
                      numberOfLines={2}
                    >
                      {c.title}
                    </Text>
                    <Text style={shared.small} numberOfLines={1}>
                      {[
                        `${percentOf(c)}%`,
                        c.due_at ? dateLabel(c.due_at) : "",
                        leftLabel(c),
                        subtasksLabel(c),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  <StatusPill status={c.status} />
                  <Icon name="chevronRight" size={16} color={colors.faint} />
                </Pressable>
              ))}
              {canAddSubtask && (
                <View style={s.addRow}>
                  <TextInput
                    style={[shared.input, s.addInput]}
                    value={newSubtask}
                    onChangeText={setNewSubtask}
                    maxLength={200}
                    placeholder="Add subtask"
                    placeholderTextColor={colors.faint}
                    returnKeyType="done"
                    submitBehavior="submit"
                    onSubmitEditing={() => void addSubtask()}
                    accessibilityLabel="New subtask title"
                  />
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Add subtask"
                    accessibilityState={{
                      disabled: busy || !newSubtask.trim(),
                    }}
                    disabled={busy || !newSubtask.trim()}
                    onPress={() => void addSubtask()}
                    style={[
                      s.addButton,
                      (busy || !newSubtask.trim()) && { opacity: 0.45 },
                    ]}
                  >
                    <Icon
                      name="plus"
                      size={18}
                      color={colors.white}
                      strokeWidth={2.2}
                    />
                  </PressableScale>
                </View>
              )}
              {item.kind === "task" &&
                !readOnly &&
                level >= MAX_LEVELS &&
                !subtasks.length && (
                  <Text style={shared.small}>
                    Tasks go three levels deep, so this one can’t have subtasks.
                  </Text>
                )}
            </FadeIn>
          )}

          {/* Checklist */}
          <FadeIn index={2} style={shared.card}>
            <View style={s.cardHeading}>
              <Text style={shared.sectionTitle} accessibilityRole="header">
                Checklist
              </Text>
              {stepsTotal > 0 && (
                <Text style={s.counter}>
                  {stepsDone} of {stepsTotal}
                </Text>
              )}
            </View>
            {!detail && stepsTotal > 0 && (
              <Text style={shared.small}>Loading steps…</Text>
            )}
            {detail && !steps.length && (
              <Text style={[shared.small, s.gapBelow]}>
                Break this into small steps. Progress updates as you tick them
                off.
              </Text>
            )}
            {steps.map((step, n) => (
              <StepRow
                key={step.id}
                step={step}
                first={n === 0}
                disabled={readOnly || busy}
                readOnly={readOnly}
                onToggle={() =>
                  void run(() =>
                    client.updateStep(item.id, step.id, { done: !step.done }),
                  )
                }
                onDelete={() =>
                  void run(() => client.deleteStep(item.id, step.id))
                }
                onRename={(title) =>
                  void run(() => client.updateStep(item.id, step.id, { title }))
                }
              />
            ))}
            {!readOnly && (
              <View style={s.addRow}>
                <TextInput
                  style={[shared.input, s.addInput]}
                  value={newStep}
                  onChangeText={setNewStep}
                  maxLength={200}
                  placeholder="Add a step"
                  placeholderTextColor={colors.faint}
                  returnKeyType="done"
                  submitBehavior="submit"
                  onSubmitEditing={() => void addStep()}
                  accessibilityLabel="New step title"
                />
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Add step"
                  accessibilityState={{ disabled: busy || !newStep.trim() }}
                  disabled={busy || !newStep.trim()}
                  onPress={() => void addStep()}
                  style={[
                    s.addButton,
                    (busy || !newStep.trim()) && { opacity: 0.45 },
                  ]}
                >
                  <Icon
                    name="plus"
                    size={18}
                    color={colors.white}
                    strokeWidth={2.2}
                  />
                </PressableScale>
              </View>
            )}
          </FadeIn>

          {/* Updates */}
          <FadeIn index={3} style={shared.card}>
            <View style={s.cardHeading}>
              <Text style={shared.sectionTitle} accessibilityRole="header">
                Updates
              </Text>
              {updates.length > 0 && (
                <Text style={s.counter}>{updates.length}</Text>
              )}
            </View>
            {detail && !updates.length && (
              <Text style={shared.small}>
                No updates yet.
                {readOnly ? "" : " Post one to keep everyone in the loop."}
              </Text>
            )}
            {updates.map((u, n) => (
              <UpdateRow key={u.id} update={u} first={n === 0} />
            ))}
          </FadeIn>

          <Button
            secondary
            title={readOnly ? "View all details" : "Edit details"}
            icon="arrowRight"
            onPress={openEditor}
          />
          {item.kind === "event" && !readOnly && !!onOpenNote && (
            <Button
              secondary
              title="Meeting note"
              icon="fileText"
              disabled={busy}
              onPress={() => onOpenNote(item)}
            />
          )}
          {item.kind === "event" &&
            !readOnly &&
            !!onOpenNote &&
            !!occurrence &&
            !!seriesNote && (
              <Button
                secondary
                title={`Series note: “${seriesNote.title || "Untitled"}”`}
                icon="fileText"
                disabled={busy}
                onPress={() => onOpenNote(item, true)}
              />
            )}
          {item.kind === "task" && !readOnly && !isClosed(item.status) && (
            <Button
              destructive
              title="Cancel task"
              icon="x"
              disabled={busy}
              onPress={cancelTask}
            />
          )}
        </View>
      </ScrollView>
      {/* Fixed under the scrolling detail, and above the keyboard. */}
      {!readOnly && (
        <View style={s.footer}>
          <View style={sheetStyles.column}>
            {(composing || !!note.trim() || !!noteStatus) && (
              <>
                <Text style={[shared.label, s.composerLabel]}>
                  Change status (optional)
                </Text>
                <StatusChoice
                  compact
                  value={noteStatus}
                  disabled={busy}
                  onChange={(st) =>
                    setNoteStatus((prev) => (prev === st ? null : st))
                  }
                  accessibilityLabel="Status to set with this update"
                />
              </>
            )}
            <View style={s.footerRow}>
              <TextInput
                style={[
                  shared.input,
                  s.noteInput,
                  { maxHeight: NOTE_LINE * 5 * fontScale + 26 },
                ]}
                value={note}
                onChangeText={setNote}
                onFocus={() => setComposing(true)}
                onBlur={() => setComposing(false)}
                multiline
                maxLength={2000}
                textAlignVertical="top"
                placeholder="Share progress, a blocker or a win…"
                placeholderTextColor={colors.faint}
                accessibilityLabel="Update text"
              />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={busy ? "Posting update" : "Post update"}
                accessibilityState={{ disabled: !canPost }}
                disabled={!canPost}
                onPress={() => void postNote()}
                style={({ pressed }) => [
                  s.send,
                  pressed && { backgroundColor: colors.accentPressed },
                  !canPost && { opacity: 0.4 },
                ]}
              >
                <Icon
                  name="arrowRight"
                  size={18}
                  color={colors.white}
                  strokeWidth={2.2}
                />
              </PressableScale>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/** Four colored status chips. `value` null means none chosen (composer). */
function StatusChoice({
  value,
  onChange,
  disabled,
  compact = false,
  accessibilityLabel,
}: {
  value: Status | null;
  onChange: (status: Status) => void;
  disabled: boolean;
  compact?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <View
      style={[s.statusRow, compact && s.statusRowCompact]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {STATUS_CHOICES.map((status) => {
        const active = status === value;
        const t = statusTones[status];
        return (
          <PressableScale
            key={status}
            accessibilityRole="radio"
            accessibilityLabel={statusLabels[status]}
            accessibilityState={{ checked: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(status)}
            style={[
              s.statusChip,
              compact && s.statusChipCompact,
              active && { backgroundColor: t.bg, borderColor: t.fg },
              disabled && !active && { opacity: 0.55 },
            ]}
          >
            <View style={[s.statusDot, { backgroundColor: t.fg }]} />
            <Text
              numberOfLines={1}
              style={[s.statusText, active && { color: t.fg }]}
            >
              {statusLabels[status]}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * One checklist step: tick with a pop, tap its title to rename it, delete
 * with the trash button.
 */
function StepRow({
  step,
  first,
  disabled,
  readOnly,
  onToggle,
  onDelete,
  onRename,
}: {
  step: ItemStep;
  first: boolean;
  disabled: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(step.title);
  // Submitting blurs the field too; save once.
  const saving = useRef(false);
  const startRename = () => {
    setTitle(step.title);
    saving.current = false;
    setRenaming(true);
  };
  const finishRename = () => {
    if (saving.current) return;
    saving.current = true;
    setRenaming(false);
    const next = title.trim();
    if (next && next !== step.title) onRename(next);
  };
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const was = useRef(step.done);
  useEffect(() => {
    if (step.done && !was.current && !reduced) {
      scale.setValue(0.6);
      pop(scale, 1.2).start();
    }
    was.current = step.done;
  }, [step.done, reduced, scale]);
  return (
    <View style={[s.step, !first && s.stepDivider]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={step.title}
        accessibilityState={{ checked: step.done, disabled }}
        disabled={disabled}
        hitSlop={8}
        onPress={onToggle}
      >
        <Animated.View
          style={[s.check, step.done && s.checked, { transform: [{ scale }] }]}
        >
          {step.done && (
            <Icon name="check" size={12} color={colors.white} strokeWidth={3} />
          )}
        </Animated.View>
      </Pressable>
      {renaming ? (
        <TextInput
          style={[shared.input, s.stepRename]}
          value={title}
          onChangeText={setTitle}
          autoFocus
          maxLength={200}
          returnKeyType="done"
          onSubmitEditing={finishRename}
          onBlur={finishRename}
          accessibilityLabel={`Rename step ${step.title}`}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step.title}
          accessibilityHint={readOnly ? undefined : "Renames this step"}
          disabled={readOnly || disabled}
          onPress={startRename}
          style={s.stepTitle}
        >
          <Text style={[s.stepText, step.done && s.stepDone]}>
            {step.title}
          </Text>
        </Pressable>
      )}
      {!readOnly && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete step ${step.title}`}
          disabled={disabled}
          hitSlop={8}
          onPress={onDelete}
          style={({ pressed }) => [s.trash, pressed && s.trashPressed]}
        >
          <Icon name="trash" size={16} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

/** A timeline entry: avatar initial, name, time, body and change chips. */
function UpdateRow({ update, first }: { update: ItemUpdate; first: boolean }) {
  const initial = (update.author_name || "?").trim().charAt(0).toUpperCase();
  return (
    <FadeIn style={[s.update, !first && s.stepDivider]}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.updateTop}>
          <Text style={s.author} numberOfLines={1}>
            {update.author_name || "Someone"}
          </Text>
          <Text style={shared.small}>{timeAgo(update.created_at)}</Text>
        </View>
        {!!update.body && <Text style={s.updateBody}>{update.body}</Text>}
        {(update.status || update.progress !== null) && (
          <View style={s.changes}>
            {update.status && <StatusPill status={update.status} />}
            {update.progress !== null && (
              <View style={[s.chip, s.progressChip]}>
                <Text style={[s.chipText, { color: colors.textSoft }]}>
                  Progress {update.progress}%
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    header: { marginBottom: 18 },
    headerTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    kind: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
    title: {
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.6,
      color: colors.text,
      marginTop: 10,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 10,
    },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    metaLine: { marginTop: 10 },
    meeting: { marginTop: 14, gap: 6 },
    join: { marginBottom: 0 },
    metaText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    teamChip: { backgroundColor: colors.accentSoft },
    progressChip: { backgroundColor: colors.surfaceMuted },
    chipText: { fontFamily: fonts.semibold, fontSize: 11 },
    notes: { ...shared.body, marginTop: 12 },
    crumb: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 4,
      marginBottom: 10,
      maxWidth: "100%",
    },
    crumbText: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    links: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      overflow: "hidden",
    },
    link: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    linkTitle: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.accent,
    },
    subtask: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 52,
      paddingVertical: 10,
    },
    viewOnly: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 12,
      marginBottom: 18,
    },
    viewOnlyText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 18,
      color: colors.accent,
    },
    statusRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 18,
    },
    statusRowCompact: { marginBottom: 12, gap: 6 },
    statusChip: {
      flexGrow: 1,
      flexBasis: "45%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      minHeight: 44,
      borderRadius: radii.input,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 10,
    },
    statusChipCompact: { flexBasis: "auto", minHeight: 44, flexGrow: 0 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    progressCard: { gap: 12 },
    progressTop: { flexDirection: "row", alignItems: "baseline" },
    bigPercent: {
      marginLeft: "auto",
      fontFamily: fonts.display,
      fontSize: 26,
      letterSpacing: -0.6,
    },
    progressHint: { marginTop: -2 },
    segments: { flexDirection: "row", gap: 6 },
    segment: {
      flex: 1,
      minHeight: controls.tap,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    },
    stepperButton: {
      minWidth: 64,
      minHeight: 40,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    stepperText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    stepperValue: {
      minWidth: 48,
      textAlign: "center",
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    faded: { opacity: 0.45 },
    stepTitle: { flex: 1, paddingVertical: 4 },
    stepRename: { flex: 1, minHeight: 40, paddingVertical: 8 },
    segmentText: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.muted,
    },
    cardHeading: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    counter: {
      marginLeft: "auto",
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.muted,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 6,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    gapBelow: { marginBottom: 12 },
    step: { flexDirection: "row", alignItems: "center", minHeight: 46 },
    stepDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    stepMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    checked: { backgroundColor: colors.accent, borderColor: colors.accent },
    stepText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    stepDone: { color: colors.faint, textDecorationLine: "line-through" },
    trash: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    trashPressed: { backgroundColor: colors.dangerSoft },
    addRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    addInput: { flex: 1, minHeight: 44, paddingVertical: 10 },
    addButton: {
      width: 44,
      height: 44,
      borderRadius: radii.input,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    fill: { flex: 1 },
    footer: {
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.page,
      paddingTop: 10,
      paddingBottom: 10,
    },
    footerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    /** Grows to five lines, then scrolls inside (see NOTE_LINE). */
    noteInput: { flex: 1, minHeight: 50, lineHeight: NOTE_LINE },
    composerLabel: { marginTop: 0 },
    send: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    update: { flexDirection: "row", gap: 12, paddingVertical: 12 },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontFamily: fonts.bold, fontSize: 14, color: colors.accent },
    updateTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
    author: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
    },
    updateBody: { ...shared.body, marginTop: 3 },
    changes: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  }),
);
