import React, { useEffect, useRef, useState } from "react";
import {
  Linking,
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
  isOfflineError,
  seriesNoteFor,
  pageAboutTask,
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
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { CelebrationHost, celebrate } from "../../components/Celebration";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { LinkedText } from "../../components/LinkedText";
import { AskBox } from "../followthrough/Asks";
import { ProofSection } from "../followthrough/Proofs";
import { MeetingOutcome } from "../followthrough/MeetingOutcome";
import { StatusPill } from "../../components/Pill";
import { PlanningMeta } from "../planner/PlanningMeta";
import { ProgressBar } from "../../components/ProgressBar";
import { SessionsPanel } from "../planner/SessionsPanel";
import { HeaderButton, Sheet, sheetStyles } from "../../components/Sheet";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import { copyLink, shareLink } from "../../lib/share";
import { session } from "../../lib/session";
import { ChoicePicker } from "../../components/ChoicePicker";
import { InlineDetails } from "../../components/InlineDetails";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { useNow } from "../../hooks/useNow";
import { client } from "../../lib/api";
import { showToast } from "../../components/Toast";
import { announceStars } from "../../lib/accountPrefs";
import * as outbox from "../../lib/outbox";
import { canJoin } from "../planner/planning";
import {
  leftLabel,
  percentOf,
  stepsLabel,
  subtasksLabel,
  timeAgo,
} from "../progress/progress";
import { FadeIn, PressableScale, Pressable } from "../../motion";
import {
  controls,
  colors,
  fonts,
  radii,
  spacing,
  themed,
  statusTones,
} from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";
import { LinkedHere } from "../documents/editor/links";

const PROGRESS_STEPS = [0, 25, 50, 75, 100];
/** Line height of the update box; it grows to five lines before scrolling. */
const NOTE_LINE = 21;
/** Every status, closed ones last. */
const STATUS_CHOICES: Status[] = [...statusOrder, "cancelled"];
/** A task, its subtasks and theirs: the server's limit. */
const MAX_LEVELS = 3;

type CancelAction = {
  id: string;
  disabled: boolean;
  onPress: () => void;
};

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
type TaskDetailProps = Omit<Parameters<typeof TaskDetailSession>[0], "item"> & {
  item: Item | null;
};

/** Keep the account controller and explicitly reset item data across identity changes. */
export function TaskDetail(props: TaskDetailProps) {
  if (!props.item) return null;
  return <TaskDetailSession key={session.token} {...props} item={props.item} />;
}

function TaskDetailSession({
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
  inline = false,
  registerLeaveGuard,
}: {
  registerLeaveGuard?: (
    id: string,
    guard: () => Promise<boolean>,
  ) => () => void;
  /**
   * Beside the list rather than over it (MOB-12): on an iPad or a wide
   * window the task sits in a panel next to Tasks.
   */
  inline?: boolean;
  visible: boolean;
  /** The row that was tapped; shown straight away while the detail loads. */
  item: Item;
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
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const currentItem = useRef(item);
  currentItem.current = item;
  const owns = (id?: string) =>
    mounted.current &&
    session.token === owner &&
    (!id || currentItem.current?.id === id);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** The ⋯ in the header: sharing the task's link. */
  const [menu, setMenu] = useState(false);
  const [cancelAction, setCancelAction] = useState<CancelAction | null>(null);
  const currentCancelAction = useRef(cancelAction);
  currentCancelAction.current = cancelAction;
  /** Whether this task is starred (NAV-07), read when its menu opens. */
  const [starred, setStarred] = useState<boolean | null>(null);
  const [starFailure, setStarFailure] = useState(false);
  const [starAttempt, setStarAttempt] = useState(0);
  const [menuError, setMenuError] = useState("");
  const starring = useRef(false);
  const [starPending, setStarPending] = useState(false);
  useEffect(() => {
    setMenu(false);
    setCancelAction(null);
    setMenuError("");
  }, [item?.id, visible]);
  useEffect(() => {
    if (!menu || !item) return;
    let live = true;
    setStarred(null);
    setStarFailure(false);
    const id = item.id;
    client.listFavourites().then(
      (all) => {
        if (live && owns(id))
          setStarred(all.some((f) => f.kind === "task" && f.target_id === id));
      },
      () => {
        if (live && owns(id)) setStarFailure(true);
      },
    );
    return () => {
      live = false;
    };
  }, [menu, item?.id, starAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened: it leads the search's recent list, and ⌘K's on the web.
  const openedId = visible ? item?.id : undefined;
  useEffect(() => {
    if (openedId) void client.recordRecent("task", openedId).catch(() => {});
  }, [openedId]);
  const options = item ? (
    <HeaderButton
      icon="more"
      label={item.kind === "event" ? "Event options" : "Task options"}
      on={menu}
      onPress={() => setMenu(true)}
    />
  ) : undefined;
  const presentation = useRef({ visible, inline, onDismiss });
  presentation.current = { visible, inline, onDismiss };
  const model = useTaskDetailContent({
    seed: item,
    active: visible,
    inline,
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
    onCancelReady: setCancelAction,
  });
  const prepareLeave = useRef<() => Promise<boolean>>(async () => true);
  prepareLeave.current = () => {
    if (starring.current) {
      setMenuError("Wait for this change to finish.");
      return Promise.resolve(false);
    }
    return model.beforeLeave();
  };
  useEffect(
    () => registerLeaveGuard?.(item.id, () => prepareLeave.current()),
    [item.id, registerLeaveGuard],
  );
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    void prepareLeave
      .current()
      .then((allowed) => {
        if (allowed && owns(item.id) && presentation.current.visible) onClose();
      })
      .finally(() => {
        closing.current = false;
      });
  };
  const body = (
    <>
      {!!menuError && (
        <ErrorBanner error={menuError} onDismiss={() => setMenuError("")} />
      )}
      {model.content}
      <CelebrationHost />
    </>
  );
  const surface = inline ? (
    visible && item ? (
      <View style={panel.box} accessibilityLabel="Task beside the list">
        <View style={panel.head}>
          <Text style={panel.kind}>
            {item.kind === "event" ? "Event" : "Task"}
          </Text>
          {options}
          <HeaderButton
            icon="x"
            label="Close"
            disabled={model.pending || starPending}
            onPress={close}
          />
        </View>
        <View style={panel.body}>{body}</View>
      </View>
    ) : null
  ) : (
    <Sheet
      avoidKeyboard={false}
      visible={visible}
      title={item?.kind === "event" ? "Event" : "Task"}
      onClose={close}
      onDismiss={() => {
        const latest = presentation.current;
        if (!latest.visible && !latest.inline) latest.onDismiss?.();
      }}
      guardedClose
      closeDisabled={model.pending || starPending}
      actions={options}
    >
      {body}
    </Sheet>
  );
  return (
    <>
      {surface}
      {model.overlays}
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
            ...(starFailure
              ? [
                  {
                    label: "Retry star status",
                    onPress: () => {
                      setStarAttempt((a) => a + 1);
                      setMenu(true);
                    },
                  },
                ]
              : [
                  {
                    label:
                      starred === null
                        ? "Loading star status…"
                        : starred
                          ? "Unstar"
                          : "Star",
                    disabled: starred === null || starPending,
                    onPress: () => {
                      if (
                        !owns(item.id) ||
                        starring.current ||
                        starred === null
                      )
                        return;
                      starring.current = true;
                      setStarPending(true);
                      setMenuError("");
                      const on = !starred;
                      void client
                        .setFavourite("task", item.id, on)
                        .then(
                          () => {
                            if (!owns(item.id)) return;
                            setStarred(on);
                            announceStars();
                            showToast({ text: on ? "Starred" : "Unstarred" });
                          },
                          () => {
                            if (owns(item.id))
                              setMenuError(
                                "Star could not be updated. Try again.",
                              );
                          },
                        )
                        .finally(() => {
                          starring.current = false;
                          if (owns()) setStarPending(false);
                        });
                    },
                  },
                ]),
            ...(cancelAction?.id === item.id
              ? [
                  {
                    label: "Cancel task",
                    icon: "x" as const,
                    destructive: true,
                    disabled: cancelAction.disabled,
                    onPress: () => {
                      const latest = currentCancelAction.current;
                      if (latest?.id === item.id && !latest.disabled)
                        latest.onPress();
                    },
                  },
                ]
              : []),
          ]}
          onClose={() => setMenu(false)}
        />
      )}
    </>
  );
}

/** The panel a task sits in beside the list (MOB-12). */
const panel = themed(() =>
  StyleSheet.create({
    box: {
      flex: 1,
      backgroundColor: colors.surface,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    kind: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    body: { flex: 1, minHeight: 0, gap: 12 },
  }),
);

function useTaskDetailContent({
  seed,
  active,
  inline,
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
  onCancelReady,
}: {
  seed: Item;
  active: boolean;
  inline: boolean;
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
  onCancelReady: (action: CancelAction | null) => void;
}) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const currentSeed = useRef(seed.id);
  currentSeed.current = seed.id;
  const modelId = useRef(seed.id);
  const owns = () =>
    mounted.current &&
    session.token === owner &&
    currentSeed.current === seed.id;
  const mutation = useRef(false);
  const detailRead = useRef(0);
  const contextRead = useRef(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [detailOffline, setDetailOffline] = useState(false);
  const [projectFailure, setProjectFailure] = useState(false);
  const [contextFailure, setContextFailure] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      leaveResolver.current?.(false);
      leaveResolver.current = null;
    };
  }, []);
  const [newSubtask, setNewSubtask] = useState("");
  /** The task above, when it isn't among the loaded items. */
  const [fetchedParent, setFetchedParent] = useState<Item | null>(null);
  const [detailValue, setDetail] = useState<ItemDetail | null>(null);
  const detail = detailValue?.id === seed.id ? detailValue : null;
  const [context, setContext] = useState<ItemContext | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null);
  const leavePromise = useRef<Promise<boolean> | null>(null);
  const [newStep, setNewStep] = useState("");
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({});
  const stepDraftRef = useRef(stepDrafts);
  stepDraftRef.current = stepDrafts;
  const renamingSteps = useRef(new Set<string>());
  const writeStepDraft = (id: string, text: string | null) => {
    const next = { ...stepDraftRef.current };
    if (text === null) delete next[id];
    else next[id] = text;
    stepDraftRef.current = next;
    setStepDrafts(next);
  };
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState<Status | null>(null);
  /** The update box has focus: its status choices show above it. */
  const [composing, setComposing] = useState(false);
  const detailScroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const restoreScroll = useRef(false);
  useEffect(() => {
    restoreScroll.current = true;
    const frame = requestAnimationFrame(() => {
      if (owns() && active && detailScroller.current) {
        detailScroller.current.scrollTo({
          y: scrollY.current,
          animated: false,
        });
        restoreScroll.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [inline, active]);
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
    if (modelId.current === seed.id) return;
    modelId.current = seed.id;
    setNewSubtask("");
    setNewStep("");
    setNote("");
    setNoteStatus(null);
    setComposing(false);
    setDraft(null);
    stepDraftRef.current = {};
    setStepDrafts({});
    setDetail(null);
    setContext(null);
    setFetchedParent(null);
    setProjects(null);
    setSeriesNote(null);
    setError("");
    setSaveState("");
    setDetailLoading(true);
    setDetailError("");
    setDetailOffline(false);
    setContextFailure(false);
    setProjectFailure(false);
    createdPage.current = null;
    setCancelConfirmId(null);
    setCancelVisible(false);
    leaveResolver.current?.(false);
    leaveResolver.current = null;
    leavePromise.current = null;
    setLeaveVisible(false);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = null;
    scrollY.current = 0;
    restoreScroll.current = true;
  }, [seed.id]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const request = ++detailRead.current;
    setDetailLoading(true);
    setDetailError("");
    setDetailOffline(false);
    client
      .getItem(seed.id)
      .then((d) => {
        if (!alive || !owns() || request !== detailRead.current) return;
        setDetail(d);
      })
      .catch((e: Error) => {
        if (alive && owns() && request === detailRead.current) {
          setDetailError(errorText(e));
          setDetailOffline(isOfflineError(e));
        }
      })
      .finally(() => {
        if (alive && owns() && request === detailRead.current)
          setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
    // Reload when the task changes elsewhere, not only when another opens.
  }, [
    active,
    readAttempt,
    seed.id,
    seed.version,
    seed.status,
    seed.steps_done,
    seed.steps_total,
    seed.updates_count,
    seed.last_update_at,
  ]);
  useEffect(() => {
    if (!active || seed.kind !== "task") return;
    let alive = true;
    const request = ++contextRead.current;
    setContextFailure(false);
    void client.itemContext(seed.id).then(
      (value) => {
        if (alive && owns() && request === contextRead.current)
          setContext(value);
      },
      () => {
        if (alive && owns() && request === contextRead.current)
          setContextFailure(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [active, seed.id, seed.version, readAttempt]);

  const item: Item = detail ?? seed;
  const latestItem = useRef(item);
  latestItem.current = item;
  // Opened on one class of a repeating event: that class opens its own
  // note, so a note the series keeps for every class is pointed to here.
  const [seriesNote, setSeriesNote] = useState<EventNoteRef | null>(null);
  const noteKind = seed.kind === "event" && !!seed.rrule && !!onOpenNote;
  useEffect(() => {
    if (!active || !noteKind || !occurrence) return;
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
  }, [active, seed.id, seed.team_id, noteKind, occurrence]);
  const team = item.team_id
    ? teams.find((t) => t.id === item.team_id)
    : undefined;
  const readOnly =
    !!item.team_id && (!team || !hasTeamPermission(team.role, "items:write"));
  const readingLocked =
    !active || busy || detailLoading || (!!detailError && !detailOffline);
  const locked =
    readOnly || readingLocked || leaveVisible || leavePromise.current !== null;
  const writeState = useRef({ locked });
  writeState.current = { locked };
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
  const now = useNow(30_000, active && !!meetingUrl);
  const joinable = canJoin(
    { meeting_url: meetingUrl, start_at: item.due_at, end_at: item.end_at },
    now,
  );
  const canWork = item.kind === "task" && !isClosed(item.status) && !locked;

  /**
   * Which project a task belongs to, and which stage within it. Loaded only
   * when a task is open, since events never belong to a project.
   */
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [placementRetry, setPlacementRetry] = useState<{
    itemId: string;
    projectId: string | null;
    stageId?: string | null;
    version: number;
  } | null>(null);
  useEffect(() => {
    if (!active || item.kind !== "task" || readOnly) return;
    let alive = true;
    setProjectFailure(false);
    void client.listProjects().then(
      (all) => {
        if (alive && owns())
          setProjects(
            all.filter((p) => (p.team_id ?? null) === (item.team_id ?? null)),
          );
      },
      () => {
        if (alive && owns()) setProjectFailure(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [active, item.kind, item.team_id, readOnly, readAttempt]);

  const project = projects?.find((p) => p.id === detail?.project_id) ?? null;

  const putInProject = (projectId: string | null, stageId?: string | null) =>
    void run(async () => {
      const previous = detail;
      if (!previous) throw new Error("Reload task details first.");
      let saved: Awaited<ReturnType<typeof client.setItemProject>>;
      try {
        saved = await client.setItemProject(item.id, {
          version: previous.version,
          project_id: projectId,
          ...(stageId === undefined ? {} : { stage_id: stageId }),
        });
      } catch (error) {
        if (owns() && (error as { status?: number }).status === 409)
          setPlacementRetry({
            itemId: item.id,
            projectId,
            stageId,
            version: previous.version,
          });
        throw error;
      }
      if (owns()) setPlacementRetry(null);
      if (!owns()) return null;
      // The write receipt is authoritative; context refresh is a separate read.
      const request = ++contextRead.current;
      setContextFailure(false);
      void client.itemContext(item.id).then(
        (value) => {
          if (owns() && request === contextRead.current) setContext(value);
        },
        () => {
          if (owns() && request === contextRead.current)
            setContextFailure(true);
        },
      );
      const { attendees: _attendees, links: _links, ...fields } = saved.item;
      return { ...previous, ...fields };
    });
  const byId = new Map(items.map((i) => [i.id, i]));
  const parent = item.parent_id
    ? (byId.get(item.parent_id) ??
      (fetchedParent?.id === item.parent_id ? fetchedParent : null))
    : null;
  const parentId = item.parent_id ?? null;
  const parentKnown = !parentId || byId.has(parentId);
  useEffect(() => {
    if (!active || !parentId || parentKnown) return;
    let alive = true;
    client
      .getItem(parentId)
      .then((p) => alive && setFetchedParent(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, parentId, parentKnown, readAttempt]);
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
    if (
      !title ||
      !owns() ||
      mutation.current ||
      writeState.current.locked ||
      !canAddSubtask
    )
      return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const sent = await outbox.createItem({
        title,
        kind: "task",
        status: "todo",
        priority: item.priority,
        parent_id: item.id,
        team_id: item.team_id ?? null,
        list_id: item.list_id ?? null,
      });
      if (!owns()) return;
      setSaveState(sent ? "" : "Saved on this device. Syncs when online.");
      setNewSubtask((current) => (current.trim() === title ? "" : current));
      onChanged();
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (owns()) setBusy(false);
    }
  };
  const cancelTask = () => {
    if (owns() && !writeState.current.locked && !mutation.current) {
      setCancelConfirmId(item.id);
      setCancelVisible(true);
    }
  };
  const cancelTaskRef = useRef(cancelTask);
  cancelTaskRef.current = cancelTask;
  const canCancel = item.kind === "task" && !readOnly && !isClosed(item.status);
  const confirmCancellation = useRef(() => {});
  confirmCancellation.current = () => {
    if (cancelConfirmId === item.id && canCancel && !busy)
      setStatus("cancelled");
    setCancelConfirmId(null);
    setCancelVisible(false);
  };
  useEffect(() => {
    onCancelReady(
      canCancel
        ? {
            id: item.id,
            disabled: locked,
            onPress: () => cancelTaskRef.current(),
          }
        : null,
    );
    return () => onCancelReady(null);
  }, [item.id, canCancel, locked, onCancelReady]);

  /**
   * Run a change; the server answers with the fresh detail. Offline, a
   * change that can wait is kept on the phone (`fn` answers null) and shown
   * here as `expected`.
   */
  const run = async (
    fn: () => Promise<ItemDetail | null>,
    expected?: Partial<ItemDetail>,
  ) => {
    if (!owns() || mutation.current || writeState.current.locked) return false;
    mutation.current = true;
    setBusy(true);
    setError("");
    const before = item.status;
    try {
      const answer = await fn();
      if (!owns()) return false;
      detailRead.current += 1;
      setDetailLoading(false);
      setSaveState(answer ? "" : "Saved on this device. Syncs when online.");
      if (answer) setDetail(answer);
      else setDetail((d) => (d ? { ...d, ...expected } : d));
      const status = answer?.status ?? expected?.status ?? item.status;
      // A status change, an update or the last checklist step can finish it.
      if (answer && status === "done" && before !== "done") {
        celebrate(answer?.title ?? item.title);
      }
      try {
        onChanged();
      } catch {
        setError("Saved. Refresh the task list to update it.");
      }
      return true;
    } catch (e) {
      if (!owns()) return false;
      setError(errorText(e));
      // The task changed elsewhere (steps added, a newer version): reload it.
      if ((e as { status?: number }).status === 409)
        setReadAttempt((attempt) => attempt + 1);
      return false;
    } finally {
      mutation.current = false;
      if (owns()) setBusy(false);
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
  const saveProgress = async (next: number) => {
    if (latestItem.current.status === "done") {
      if (owns()) setDraft(null);
      return;
    }
    const ok = await run(
      () =>
        outbox.postItemUpdate(latestItem.current, {
          progress: next,
        }) as Promise<ItemDetail | null>,
      { progress: next },
    );
    if (ok && owns())
      setDraft((current) => (current === next ? null : current));
  };
  /** Save after the last selection; failed progress remains visible for Retry. */
  const setProgress = (value: number) => {
    if (!owns() || mutation.current || writeState.current.locked) return;
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setDraft(next);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null;
      void saveProgress(next);
    }, 500);
  };
  useEffect(() => {
    if (!active && progressTimer.current) {
      clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
  }, [active]);
  const addStep = async () => {
    const title = newStep.trim();
    if (!title) return;
    if ((await run(() => client.addStep(item.id, { title }))) && owns())
      setNewStep((current) => (current.trim() === title ? "" : current));
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
    if (ok && owns()) {
      setNote((current) => (current.trim() === body ? "" : current));
      setNoteStatus((current) => (current === noteStatus ? null : current));
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
  const createdPage = useRef<string | null>(null);
  const createTaskPage = async () => {
    if (!owns() || mutation.current || writeState.current.locked || !onOpenPage)
      return;
    if (createdPage.current) {
      onOpenPage(createdPage.current);
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const doc = await client.createDoc(pageAboutTask(latestItem.current));
      if (!owns()) return;
      createdPage.current = doc.id;
      onOpenPage(doc.id);
    } catch (error) {
      if (owns()) setError(errorText(error));
    } finally {
      mutation.current = false;
      if (owns()) setBusy(false);
    }
  };
  const canPost =
    !locked && (!!note.trim() || (!!noteStatus && noteStatus !== item.status));

  const settleLeave = (allowed: boolean) => {
    if (allowed && owns() && !mutation.current) {
      setNote("");
      setNoteStatus(null);
      setNewStep("");
      setNewSubtask("");
      setDraft(null);
      stepDraftRef.current = {};
      setStepDrafts({});
      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
    const resolve = leaveResolver.current;
    leaveResolver.current = null;
    leavePromise.current = null;
    setLeaveVisible(false);
    resolve?.(allowed && owns() && !mutation.current);
  };
  const beforeLeave = () => {
    if (!owns()) return Promise.resolve(false);
    if (mutation.current) {
      setError("Wait for this change to finish.");
      return Promise.resolve(false);
    }
    if (leavePromise.current) return leavePromise.current;
    const pendingProgress = progressTimer.current !== null;
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = null;
    const dirty =
      !!note.trim() ||
      !!noteStatus ||
      !!newStep.trim() ||
      !!newSubtask.trim() ||
      draft !== null ||
      pendingProgress ||
      Object.keys(stepDraftRef.current).length > 0;
    if (!dirty) return Promise.resolve(true);
    const pending = new Promise<boolean>((resolve) => {
      leaveResolver.current = resolve;
    });
    leavePromise.current = pending;
    setLeaveVisible(true);
    return pending;
  };
  const overlays = (
    <>
      <ActionSheet
        visible={leaveVisible}
        label="Unsent task changes"
        title={`Discard changes to “${item.title}”?`}
        cancelLabel="Keep editing"
        actions={[
          {
            label: "Discard changes",
            destructive: true,
            onPress: () => settleLeave(true),
          },
        ]}
        onClose={(selection) => {
          setLeaveVisible(false);
          if (selection !== "selected") settleLeave(false);
        }}
      />
      <ActionSheet
        visible={cancelVisible && cancelConfirmId === item.id && canCancel}
        label="Cancel task confirmation"
        title="Cancel this task?"
        message={
          subtasks.length
            ? "It leaves your plans and its sessions are removed. Its subtasks stay as they are. You can reopen it later."
            : "It leaves your plans and its sessions are removed. You can reopen it later."
        }
        cancelLabel="Keep task"
        actions={[
          {
            label: "Cancel task",
            destructive: true,
            disabled: busy,
            onPress: () => confirmCancellation.current(),
          },
        ]}
        onClose={(selection) => {
          setCancelVisible(false);
          if (selection !== "selected") setCancelConfirmId(null);
        }}
      />
    </>
  );
  const content = (
    <View
      ref={area}
      collapsable={false}
      onLayout={keyboard.onLayout}
      style={[s.fill, { paddingBottom: keyboard.inset }]}
    >
      <ScrollView
        ref={detailScroller}
        onScroll={(event) => {
          if (!restoreScroll.current)
            scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (restoreScroll.current && active) {
            detailScroller.current?.scrollTo({
              y: scrollY.current,
              animated: false,
            });
            restoreScroll.current = false;
          }
        }}
        style={s.fill}
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {!!saveState && (
            <Text style={shared.small} accessibilityLiveRegion="polite">
              {saveState}
            </Text>
          )}
          {!!detailError && <ErrorBanner error={detailError} />}
          {!!detailError && (
            <Button
              title="Retry task details"
              secondary
              onPress={() => setReadAttempt((a) => a + 1)}
            />
          )}
          {detailLoading && <Text style={shared.small}>Loading details…</Text>}
          {(contextFailure || projectFailure) && (
            <View style={{ gap: 8 }}>
              <Text style={shared.small}>
                {contextFailure
                  ? "Related work unavailable."
                  : "Projects unavailable."}
              </Text>
              <Button
                title="Retry related work"
                secondary
                disabled={locked}
                onPress={() => setReadAttempt((a) => a + 1)}
              />
            </View>
          )}

          {/* Header */}
          <FadeIn style={s.header}>
            {!!item.parent_id && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  parent ? `Subtask of ${parent.title}` : "Subtask"
                }
                accessibilityHint={parent ? "Opens that task" : undefined}
                disabled={busy || !parent}
                onPress={() => {
                  if (!mutation.current && parent) onOpenItem(parent);
                }}
                style={({ pressed }) => [s.crumb, pressed && { opacity: 0.6 }]}
              >
                <Icon name="chevronLeft" size={13} color={colors.accent} />
                <Text style={s.crumbText}>
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
                disabled={readingLocked}
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
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.linkTitle}>{l.title || l.url}</Text>
                      {!!l.title && <Text style={shared.small}>{l.url}</Text>}
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

          {/* The pages that link here, and the one this task came from. */}
          <LinkedHere
            kind={item.kind === "event" ? "event" : "task"}
            id={item.id}
            report={(e) => setError(errorText(e as Error))}
          />

          {readOnly && (
            <View style={s.viewOnly}>
              <Icon name="users" size={16} color={colors.accent} />
              <Text style={s.viewOnlyText}>
                View only{teamName ? ` in ${teamName}` : ""}.
              </Text>
            </View>
          )}

          {/* Status */}
          <StatusChoice
            value={item.status}
            disabled={locked}
            onChange={(status) => {
              if (status) setStatus(status);
            }}
            accessibilityLabel={
              item.kind === "event" ? "Event status" : "Status"
            }
          />

          {item.kind === "task" && !!item.team_id && (
            <AskBox itemId={item.id} onChanged={onChanged} />
          )}

          {/* Progress */}
          <FadeIn index={1} style={[s.section, s.progressCard]}>
            <View style={s.progressTop}>
              <Text style={shared.sectionTitle}>Progress</Text>
              <Text style={[s.bigPercent, { color: tone.fg }]}>{percent}%</Text>
            </View>
            {draft !== null &&
              !progressTimer.current &&
              item.status !== "done" && (
                <Button
                  secondary
                  title="Save progress"
                  disabled={locked}
                  onPress={() => void saveProgress(draft)}
                />
              )}
            <ProgressBar
              value={percent}
              height={10}
              color={tone.fg}
              track={colors.surfaceMuted}
              label={`${item.title} progress`}
            />
            {stepsTotal > 0 ? (
              <Text style={[shared.small, s.progressHint]}>
                {stepsLabel(stepsDone, stepsTotal)}
              </Text>
            ) : readOnly ? null : item.status === "done" ? (
              <Text style={[shared.small, s.progressHint]}>
                Reopen the task to change its progress.
              </Text>
            ) : (
              <>
                <Text style={[shared.small, s.progressHint]}>Set progress</Text>
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
                        disabled={locked}
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
            <ProofSection itemId={item.id} canWrite={!locked} />
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
                canWrite={!locked}
              />
            )}

          {item.kind === "task" && (context?.project || !readOnly) && (
            <View style={s.relatedFields}>
              {!!context?.project &&
                context.project.id === item.project_id &&
                !!onOpenProject && (
                  <SmallAction
                    label={`Open ${project?.name ?? context.project.name}`}
                    disabled={busy}
                    onPress={() => onOpenProject(context.project!.id)}
                  />
                )}
              {!readOnly && projects === null && !projectFailure && (
                <Text style={shared.small}>Loading projects…</Text>
              )}
              {!readOnly && projects !== null && (
                <ChoicePicker<string>
                  label="Project"
                  value={
                    detail ? (detail.project_id ?? "") : (seed.project_id ?? "")
                  }
                  disabled={locked || projects === null || projectFailure}
                  options={[
                    { value: "", label: "None" },
                    ...(context?.project &&
                    !projects?.some((p) => p.id === context.project!.id)
                      ? [
                          {
                            value: context.project.id,
                            label: context.project.name,
                          },
                        ]
                      : []),
                    ...(projects ?? []).map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                  onChange={(id) => putInProject(id || null)}
                />
              )}
              {!readOnly && !!project && (
                <ChoicePicker<string>
                  label="Stage"
                  value={detail?.stage_id ?? ""}
                  disabled={locked || projectFailure}
                  options={[
                    { value: "", label: "No stage" },
                    ...project.stages.map((stage) => ({
                      value: stage.id,
                      label: stage.name,
                    })),
                  ]}
                  onChange={(id) => putInProject(project.id, id || null)}
                />
              )}
            </View>
          )}
          {placementRetry?.itemId === item.id && (
            <View>
              <Text style={shared.small}>
                Task changed. Review its current placement before retrying your
                saved choice:{" "}
                {projects?.find((p) => p.id === placementRetry.projectId)
                  ?.name ?? "No project"}
                {placementRetry.stageId !== undefined &&
                  ` / ${projects?.flatMap((p) => p.stages).find((stage) => stage.id === placementRetry.stageId)?.name ?? "No stage"}`}
                .
              </Text>
              <SmallAction
                label="Retry saved move"
                disabled={locked || item.version <= placementRetry.version}
                onPress={() =>
                  putInProject(placementRetry.projectId, placementRetry.stageId)
                }
              />
              <SmallAction
                label="Dismiss saved move"
                disabled={busy}
                onPress={() => setPlacementRetry(null)}
              />
            </View>
          )}
          {item.kind === "task" && !!onOpenPage && (
            <InlineDetails title="Pages">
              {!!context?.came_from && (
                <View>
                  <SmallAction
                    label={`Came from ${context.came_from.title}`}
                    disabled={readingLocked}
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
                <SmallAction
                  key={page.id}
                  label={page.title}
                  disabled={readingLocked}
                  onPress={() => onOpenPage(page.id, page.block_id)}
                />
              ))}
              {!readOnly && (
                <SmallAction
                  label={
                    createdPage.current
                      ? "Open created page"
                      : "New page about this task"
                  }
                  disabled={locked}
                  onPress={() => void createTaskPage()}
                />
              )}
            </InlineDetails>
          )}

          {/* Subtasks */}
          {item.kind === "task" && (subtasks.length > 0 || canAddSubtask) && (
            <FadeIn index={2} style={s.section}>
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
              {subtasks.map((c, n) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.title}, ${statusLabels[c.status]}, ${percentOf(c)}%`}
                  accessibilityHint="Opens this subtask"
                  disabled={busy}
                  onPress={() => {
                    if (!mutation.current) onOpenItem(c);
                  }}
                  style={({ pressed }) => [
                    s.subtask,
                    n > 0 && s.stepDivider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[s.stepText, isClosed(c.status) && s.stepDone]}
                    >
                      {c.title}
                    </Text>
                    <Text style={shared.small}>
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
                    editable={!locked}
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
                      color={colors.onAccent}
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
          <FadeIn index={2} style={s.section}>
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
              <Text style={[shared.small, s.gapBelow]}>No steps yet.</Text>
            )}
            {steps.map((step, n) => (
              <StepRow
                key={step.id}
                step={step}
                first={n === 0}
                disabled={locked}
                readOnly={readOnly}
                onToggle={() =>
                  void run(() =>
                    client.updateStep(item.id, step.id, { done: !step.done }),
                  )
                }
                onDelete={() =>
                  void run(() => client.deleteStep(item.id, step.id))
                }
                renameDraft={stepDrafts[step.id] ?? null}
                onStartRename={() => {
                  if (!writeState.current.locked)
                    writeStepDraft(step.id, step.title);
                }}
                onRenameText={(text) => writeStepDraft(step.id, text)}
                onFinishRename={async () => {
                  const text = stepDraftRef.current[step.id];
                  if (
                    text === undefined ||
                    !text.trim() ||
                    renamingSteps.current.has(step.id) ||
                    writeState.current.locked
                  )
                    return;
                  const next = text.trim();
                  if (next === step.title) {
                    writeStepDraft(step.id, null);
                    return;
                  }
                  renamingSteps.current.add(step.id);
                  try {
                    const ok = await run(() =>
                      client.updateStep(item.id, step.id, { title: next }),
                    );
                    if (
                      ok &&
                      owns() &&
                      stepDraftRef.current[step.id]?.trim() === next
                    )
                      writeStepDraft(step.id, null);
                  } finally {
                    renamingSteps.current.delete(step.id);
                  }
                }}
              />
            ))}
            {!readOnly && (
              <View style={s.addRow}>
                <TextInput
                  style={[shared.input, s.addInput]}
                  value={newStep}
                  editable={!locked}
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
                    color={colors.onAccent}
                    strokeWidth={2.2}
                  />
                </PressableScale>
              </View>
            )}
          </FadeIn>

          {/* Updates */}
          <FadeIn index={3} style={s.section}>
            <View style={s.cardHeading}>
              <Text style={shared.sectionTitle} accessibilityRole="header">
                Updates
              </Text>
              {updates.length > 0 && (
                <Text style={s.counter}>{updates.length}</Text>
              )}
            </View>
            {detail && !updates.length && (
              <Text style={shared.small}>No updates yet.</Text>
            )}
            {updates.map((u, n) => (
              <UpdateRow key={u.id} update={u} first={n === 0} />
            ))}
          </FadeIn>

          <Button
            secondary
            title={readOnly ? "View all details" : "Edit details"}
            icon="arrowRight"
            disabled={readingLocked}
            onPress={openEditor}
          />
          {item.kind === "event" && !readOnly && !!onOpenNote && (
            <Button
              secondary
              title="Meeting note"
              icon="fileText"
              disabled={locked}
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
                disabled={locked}
                onPress={() => onOpenNote(item, true)}
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
                <StatusChoice
                  compact
                  value={noteStatus}
                  disabled={locked}
                  onChange={setNoteStatus}
                  accessibilityLabel="Update status"
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
                editable={!locked}
                onChangeText={setNote}
                onFocus={() => setComposing(true)}
                onBlur={() => setComposing(false)}
                multiline
                maxLength={2000}
                textAlignVertical="top"
                placeholder="Add an update…"
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
                  color={colors.onAccent}
                  strokeWidth={2.2}
                />
              </PressableScale>
            </View>
          </View>
        </View>
      )}
    </View>
  );
  const sameItem = modelId.current === seed.id;
  return {
    content: sameItem ? (
      content
    ) : (
      <View style={s.fill}>
        <Text style={shared.small}>Loading details…</Text>
      </View>
    ),
    overlays: sameItem ? overlays : null,
    beforeLeave,
    pending: busy || leavePromise.current !== null,
  };
}

/** One current value, with full status choices in an owned sheet. */
function StatusChoice({
  value,
  onChange,
  disabled,
  compact = false,
  accessibilityLabel,
}: {
  value: Status | null;
  onChange: (status: Status | null) => void;
  disabled: boolean;
  compact?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <ChoicePicker<string>
      label={accessibilityLabel}
      value={value ?? "none"}
      disabled={disabled}
      options={[
        ...(compact ? [{ value: "none", label: "No change" }] : []),
        ...STATUS_CHOICES.map((status) => ({
          value: status,
          label: statusLabels[status],
        })),
      ]}
      onChange={(next) => onChange(next === "none" ? null : (next as Status))}
    />
  );
}

/**
 * One checklist step: stable checked state, title rename and an options menu.
 */
function StepRow({
  step,
  first,
  disabled,
  readOnly,
  onToggle,
  onDelete,
  renameDraft,
  onStartRename,
  onRenameText,
  onFinishRename,
}: {
  step: ItemStep;
  first: boolean;
  disabled: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onDelete: () => void;
  renameDraft: string | null;
  onStartRename: () => void;
  onRenameText: (text: string) => void;
  onFinishRename: () => Promise<void>;
}) {
  return (
    <View style={[s.step, !first && s.stepDivider]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={step.title}
        accessibilityState={{
          checked: step.done,
          disabled: disabled || readOnly,
        }}
        disabled={disabled || readOnly}
        style={s.stepCheckTarget}
        onPress={onToggle}
      >
        <View style={[s.check, step.done && s.checked]}>
          {step.done && (
            <Icon
              name="check"
              size={12}
              color={colors.onAccent}
              strokeWidth={3}
            />
          )}
        </View>
      </Pressable>
      {renameDraft !== null ? (
        <TextInput
          style={[shared.input, s.stepRename]}
          value={renameDraft}
          editable={!disabled && !readOnly}
          onChangeText={onRenameText}
          autoFocus
          maxLength={200}
          returnKeyType="done"
          onSubmitEditing={() => void onFinishRename()}
          onBlur={() => void onFinishRename()}
          accessibilityLabel={`Rename step ${step.title}`}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step.title}
          accessibilityHint={readOnly ? undefined : "Renames this step"}
          disabled={readOnly || disabled}
          onPress={onStartRename}
          style={s.stepTitle}
        >
          <Text style={[s.stepText, step.done && s.stepDone]}>
            {step.title}
          </Text>
        </Pressable>
      )}
      {!readOnly && (
        <MoreMenu
          label={`Step options: ${step.title}`}
          title={step.title}
          disabled={disabled}
          actions={[
            { label: "Rename step", onPress: onStartRename },
            { label: "Delete step", destructive: true, onPress: onDelete },
          ]}
        />
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.updateTop}>
          <Text style={s.author}>{update.author_name || "Someone"}</Text>
          <Text style={shared.small}>
            {update.via_agent ? `via ${update.via_agent} · ` : ""}
            {timeAgo(update.created_at)}
          </Text>
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
      fontFamily: fonts.bold,
      fontSize: 18,
      lineHeight: 26,
      letterSpacing: -0.2,
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
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      maxWidth: "100%",
    },
    metaLine: { marginTop: 10 },
    meeting: { marginTop: 14, gap: 6 },
    join: { marginBottom: 0 },
    metaText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    chip: {
      minWidth: 0,
      maxWidth: "100%",
      flexShrink: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    teamChip: { backgroundColor: colors.accentSoft },
    progressChip: { backgroundColor: colors.surfaceMuted },
    chipText: { fontFamily: fonts.semibold, fontSize: 11, flexShrink: 1 },
    notes: { ...shared.body, marginTop: 12 },
    crumb: {
      minHeight: controls.tap,
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
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
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
    statusDot: { width: 8, height: 8, borderRadius: radii.pill, flexShrink: 0 },
    statusText: {
      flexShrink: 1,
      textAlign: "center",
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    section: {
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    relatedFields: { gap: 8, marginVertical: 12 },
    progressCard: { gap: 12 },
    progressTop: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "baseline",
    },
    bigPercent: {
      marginLeft: "auto",
      fontFamily: fonts.semibold,
      fontSize: 15,
    },
    progressHint: { marginTop: -2 },
    segments: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    segment: {
      flex: 1,
      minWidth: controls.tap,
      paddingHorizontal: 6,
      paddingVertical: 6,
      minHeight: controls.tap,
      borderRadius: radii.input,
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
      minHeight: controls.tap,
      borderRadius: radii.input,
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
    stepCheckTarget: {
      width: controls.tap,
      minHeight: controls.tap,
      alignItems: "center",
      justifyContent: "center",
    },
    stepTitle: {
      flex: 1,
      minWidth: 0,
      minHeight: controls.tap,
      justifyContent: "center",
      paddingVertical: 4,
    },
    stepRename: {
      flex: 1,
      minWidth: 0,
      minHeight: controls.tap,
      paddingVertical: 8,
    },
    segmentText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.muted,
    },
    cardHeading: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
      marginBottom: 10,
    },
    counter: {
      marginLeft: "auto",
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.muted,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.check,
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
      borderRadius: radii.check,
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
      borderRadius: radii.pill,
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
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    update: { flexDirection: "row", gap: 12, paddingVertical: 12 },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
    updateTop: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "baseline",
      gap: 8,
    },
    author: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    updateBody: { ...shared.body, marginTop: 3 },
    changes: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  }),
);
