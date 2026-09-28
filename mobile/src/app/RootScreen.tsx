import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { answerReview, registerReviewActions, reviewAction } from "../lib/push";
import {
  createLabel,
  freshItem,
  motion,
  planDayPrompt,
  readArrangement,
  deadlineOf,
  hasSystemPermission,
  hasTeamPermission,
  itemBody,
  type Doc,
  type Item,
  type LegalSummary,
  type Notice,
  type Plan,
  type SavedView,
  type Status,
  type TaskList,
  type AppLink,
  parseAppLink,
  type StarredItem,
  type CreateActionId,
  type CreateArrangement,
  type DocKind,
  type SharedContent,
  hasUnseenRelease,
  settingById,
  type CommandDef,
} from "@orbyn/core";
import { tabSubtitle, tabTitle, type Tab } from "./tabs";
import { Brand } from "../components/Brand";
import { CelebrationHost, celebrate } from "../components/Celebration";
import { SlotHost, useSlot } from "../components/Slot";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { ItemEditor, type Editing } from "../components/ItemEditor";
import { MaintenanceBanner } from "../components/MaintenanceBanner";
import { TabBar } from "../components/TabBar";
import { useAssistant } from "../hooks/useAssistant";
import { usePlanner } from "../hooks/usePlanner";
import { client } from "../lib/api";
import * as outbox from "../lib/outbox";
import { PlanningProvider } from "../lib/planningContext";
import { planIncluding, planOnly } from "../lib/plans";
import { askScope, seriesTimes, type OccurrenceRef } from "../lib/scope";
import { toggledStatus } from "../lib/progress";
import { FadeIn, PressableScale, isReducedMotion } from "../motion";
import { AdminSheet } from "../screens/AdminSheet";
import {
  AssistantComposer,
  AssistantScreen,
  AssistantTopBar,
} from "../screens/AssistantScreen";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { AuthScreen } from "../screens/AuthScreen";
import { VerifyGateScreen } from "../screens/VerifyGateScreen";
import { ConsentGateScreen } from "../screens/ConsentGateScreen";
import { StudySheet } from "../screens/StudySheet";
import { BookingSheet } from "../screens/BookingSheet";
import { CalendarScreen } from "../screens/CalendarScreen";
import { ConnectionsSheet } from "../screens/ConnectionsSheet";
import { FocusScreen } from "../screens/FocusScreen";
import { HabitsSheet } from "../screens/HabitsSheet";
import { InboxScreen } from "../screens/InboxScreen";
import { ListsSheet } from "../screens/ListsSheet";
import { ViewsSheet } from "../screens/views/ViewsSheet";
import { PlanningSheet } from "../screens/PlanningSheet";
import { PlanSheet } from "../screens/PlanSheet";
import { SettingsScreen } from "../screens/SettingsScreen";
import { StatusSheet } from "../screens/StatusSheet";
import { ReviewSheet } from "../screens/ReviewSheet";
import { onLive } from "../lib/live";
import { onOpenReview } from "../lib/review";
import { TagsSheet } from "../screens/TagsSheet";
import { Sheet, sheetStyles } from "../components/Sheet";
import { BrowseScreen } from "../screens/BrowseScreen";
import { DocsSheet } from "../screens/docs/DocsSheet";
import {
  scanAndSend,
  sendLocalFile,
  takeShared,
} from "../screens/docs/Uploads";
import { ShareIntoSheet } from "../screens/ShareIntoSheet";
import { CreateSheet } from "../components/CreateSheet";
import { showToast } from "../components/Toast";
import { useAppLinks } from "../hooks/useAppLinks";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { deviceTimeZone, nextUp } from "../lib/planning";
import { tap } from "../lib/haptics";
import { ProjectsSheet } from "../screens/docs/ProjectsSheet";
import { TaskDetail } from "../screens/TaskDetail";
import { TasksScreen } from "../screens/TasksScreen";
import { TeamsSheet } from "../screens/TeamsSheet";
import { TodayScreen } from "../screens/TodayScreen";
import { SyncSheet } from "../screens/SyncSheet";
import { ProgressSheet } from "../screens/ProgressSheet";
import { SearchSheet } from "../screens/SearchSheet";
import { RecentChangesSheet } from "../screens/RecentChanges";
import {
  markReleaseSeen,
  seenRelease,
  WhatsNewSheet,
} from "../screens/WhatsNewSheet";
import { FirstRunSheet } from "../screens/FirstRunSheet";
import { SyncBar } from "../components/SyncBar";
import { WelcomeBack } from "../components/followthrough/WelcomeBack";
import { FocusElsewhere } from "../components/FocusElsewhere";
import { AnnouncementBanner } from "../screens/AdminInsights";
import { usePresence } from "../hooks/usePresence";
import { colors, spacing, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";
import { flushPending, setGlanceNames, takeNativeOpen } from "../lib/widget";
import {
  lastPage,
  startScreen,
  useAccountPrefs,
  useStarred,
} from "../lib/accountPrefs";

type SheetName =
  | "teams"
  | "admin"
  | "status"
  | "task"
  | "focus"
  | "plan"
  | "lists"
  | "planning"
  | "connections"
  | "booking"
  | "tags"
  | "habits"
  | "docs"
  | "memory"
  | "agent"
  | "study"
  | "agenda"
  | "note"
  | "projects"
  | "settings"
  | "sync"
  | "progress"
  | "review"
  | "views"
  | "search"
  | "changes"
  | "whatsnew";
/** What to present next: a sheet, the item editor, or "Save to Orbyn". */
type Next = { sheet: SheetName } | { edit: Editing } | { share: SharedContent };

/** Where the + sheet's arrangement is kept, on this device. */
const ARRANGE_KEY = "orbyn-plus-arrangement";

/**
 * Auth gate, tab switching, the shared item editor modal, the task detail
 * sheet and the Teams / Admin / Status sheets.
 *
 * Modals never stack: presenting from an open sheet closes it first, and on
 * iOS the next modal presents from the sheet's `onDismiss` (presenting while
 * another sheet is still animating away is dropped by UIKit). The closed sheet
 * goes on a back stack and reopens when the next modal goes away, so Teams ->
 * task detail -> editor unwinds back to the task and then to Teams (sheet
 * navigation state lives outside the Modal, so it survives being hidden).
 */
export function RootScreen() {
  const planner = usePlanner();
  const {
    token,
    ready,
    user,
    setUser,
    items,
    notices,
    teams,
    lists,
    tags,
    planned,
    today: todayList,
    reloadPlanning,
    error,
    setError,
    busy,
    refreshing,
    maintenance,
    setMaintenance,
    act,
    refresh,
    signIn,
    signOut,
    forgetSession,
    refreshUser,
    twoFactorRequired,
  } = planner;
  const assistant = useAssistant({ token, act, refresh, items });
  /** The assistant's side menu of chats and shortcuts. */
  const [assistantMenu, setAssistantMenu] = useState(false);
  // News from another device may be a session: planned time is asked again.
  usePresence(
    token,
    () => void refresh({ silent: true, planned: true }).catch(() => {}),
  );
  const insets = useSafeAreaInsets();
  /** An iPad or wide window: Tasks keeps the open task beside it (MOB-12). */
  const wideScreen = useWindowDimensions().width >= SPLIT_WIDTH;
  /** The current Terms version, to know whether to ask for agreement. */
  const [legal, setLegal] = useState<LegalSummary | null>(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const check = () =>
      client
        .legal()
        .then((l) => alive && setLegal(l))
        .catch(() => {
          // Keep the last known version; the next check tries again.
        });
    void check();
    const timer = setInterval(() => void check(), 15 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);
  const [tab, setTab] = useState<Tab>(() => {
    // What opens at start on this phone (NAV-12).
    const start = startScreen();
    return start === "tasks" ? "Tasks" : "Today";
  });
  /** Choices that follow the account, and what's starred (D5). */
  const accountPrefs = useAccountPrefs(token);
  // A widget can be set to one list: it needs the lists' names.
  useEffect(() => setGlanceNames(lists), [lists]);
  const starred = useStarred(token);
  useEffect(() => {
    if (token && tab === "Browse") loadPinnedViews();
  }, [token, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  /** A template to open for review, from a "ready to start" notice. */
  const [templateToOpen, setTemplateToOpen] = useState<string | null>(null);
  /** The task shown in the detail sheet. */
  const [task, setTask] = useState<Item | null>(null);
  /** The task is open beside Tasks (MOB-12), not in a sheet. */
  const [besideOpen, setBesideOpen] = useState(false);
  /** The meeting note being read, opened from its event. */
  const [note, setNote] = useState<Doc | null>(null);
  const [noteBlockId, setNoteBlockId] = useState<string | null>(null);
  const [projectToOpen, setProjectToOpen] = useState<string | null>(null);
  /** A saved view to open (from a link or Browse), and the pinned ones. */
  const [viewToOpen, setViewToOpen] = useState<string | null>(null);
  const [pinnedViews, setPinnedViews] = useState<SavedView[]>([]);
  const loadPinnedViews = () =>
    void client.listViews().then(
      (views) => setPinnedViews(views.filter((v) => v.pinned)),
      () => {
        // Browse goes without pinned views until the next look.
      },
    );
  const [projectSectionToOpen, setProjectSectionToOpen] = useState<
    "decisions" | "history" | null
  >(null);
  const [projectSourceId, setProjectSourceId] = useState<string | null>(null);
  /** A page to suggest study cards from, when Study opens from Uploads. */
  const [studySuggest, setStudySuggest] = useState<{
    docId: string;
    title: string;
    max?: number;
  } | null>(null);
  // Study opened any other way starts on its home page.
  useEffect(() => {
    if (sheet !== "study") setStudySuggest(null);
  }, [sheet]);
  /** The task in focus mode. */
  const [focus, setFocus] = useState<Item | null>(null);
  /** A plan to open the Plan my day sheet on (unfinished work moved forward). */
  const [planSeed, setPlanSeed] = useState<Plan | null>(null);
  /** The booking to open the Booking sheet on (from a notification). */
  const [bookingId, setBookingId] = useState<string | null>(null);
  /** A proposal to open in Review (a link, a notice). */
  const [reviewFocus, setReviewFocus] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(0);
  /** Modal waiting for the sheet's dismiss animation before it opens (iOS). */
  const pending = useRef<Next | null>(null);
  /** Sheets to reopen, most recent last, once the modal above them closes. */
  const back = useRef<SheetName[]>([]);
  /** An unapplied plan shown as faint blocks on the calendar. */
  const [preview, setPreview] = useState<Plan | null>(null);
  /** A day for the calendar to show ("Show" on a task's session). */
  const [calendarJump, setCalendarJump] = useState<{
    at: string;
    key: number;
  } | null>(null);
  // Only once: coming back to the calendar later starts where it usually does.
  useEffect(() => {
    if (tab !== "Calendar") setCalendarJump(null);
  }, [tab]);
  /** A time block is being dragged: the page holds still. */
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  /** The page's content column, and how far down the scroll content it starts. */
  const content = useRef<React.ComponentRef<typeof View>>(null);
  const contentY = useRef(0);
  /** The calendar's controls, shown in the page's sticky header. */
  const calendarControls = useSlot();
  const stickyHeight = useRef(0);
  /** The space above the tab bar; on the AI tab it makes room for the keyboard. */
  const keyboardArea = useRef<React.ComponentRef<typeof View>>(null);
  const keyboard = useKeyboardInset(keyboardArea, tab === "AI");
  // Show the newest message: once per new message or reply, after it's laid
  // out. Tied to the count, not to content size, so it can't feed back.
  const messages = assistant.turns.length + (assistant.thinking ? 1 : 0);
  useEffect(() => {
    if (tab !== "AI" || !messages) return;
    const frame = requestAnimationFrame(() =>
      scroller.current?.scrollToEnd({ animated: !isReducedMotion() }),
    );
    return () => cancelAnimationFrame(frame);
  }, [messages, tab]);
  /** The occurrence of a repeating item the task sheet was opened on. */
  const [taskOccurrence, setTaskOccurrence] = useState<OccurrenceRef | null>(
    null,
  );
  /** A repeating item in the editor: its occurrence, and the series' own times. */
  const [editRepeat, setEditRepeat] = useState<
    | (OccurrenceRef & {
        series: { due_at: string | null; end_at: string | null };
      })
    | null
  >(null);
  /** The Plan my day sheet's title for the plan it opens on. */
  const [planTitle, setPlanTitle] = useState<string | null>(null);
  /** Routes a tapped push notification; set on each signed-in render. */
  const routePush = useRef<((data: Record<string, unknown>) => void) | null>(
    null,
  );
  // Files shared to Orbyn from another app become imports in Uploads; text
  // and links open "Save to Orbyn" to choose where they go. The check runs
  // when the app opens and each time it comes back to the front.
  const [docsInUploads, setDocsInUploads] = useState(false);
  /** Something shared into Orbyn, waiting for where it goes. */
  const [sharedIn, setSharedIn] = useState<SharedContent | null>(null);
  /** The + sheet (a long press on +), and how it's arranged. */
  const [creating, setCreating] = useState(false);
  const [arrangement, setArrangement] = useState<CreateArrangement>(() =>
    readArrangement(readLocal(ARRANGE_KEY)),
  );
  /** How Docs and Projects open from the +: a new page, a template, a project. */
  const [docsStart, setDocsStart] = useState<{
    template?: boolean;
    kind?: DocKind;
  } | null>(null);
  const [projectsStart, setProjectsStart] = useState<{
    new?: boolean;
    open?: string;
  } | null>(null);
  /** A section of Settings to open at, from a search (NAV-10). */
  const [settingsAt, setSettingsAt] = useState<{
    section: string;
    seq: number;
  } | null>(null);
  const settingsScroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  /** Words the search sheet opens with (orbyn://search?q=). */
  const [searchStart, setSearchStart] = useState("");
  /** Words from an add link, waiting in Today's quick add to be confirmed. */
  const [quickAddPrefill, setQuickAddPrefill] = useState<{
    text: string;
    key: number;
  } | null>(null);
  /** Opens a link into the app; set on each signed-in render. */
  const openLink = useRef<((link: AppLink) => void) | null>(null);
  /** `present`, for effects set up before it exists; set on each signed-in render. */
  const presentRef = useRef<((next: Next) => void) | null>(null);
  const inApp =
    ready &&
    !!token &&
    !(user && !user.email_verified) &&
    !(user && legal && user.terms_version !== legal.terms_version);
  useAppLinks(inApp, (link) => openLink.current?.(link));
  // How many suggestions wait in Review, read again whenever it changes.
  useEffect(() => {
    if (!inApp) return;
    const count = () =>
      client.reviewCount().then(
        (r) => setReviewPending(r.pending),
        () => {},
      );
    void count();
    const stop = onLive(
      (news) =>
        news.kind === "changed" && news.area === "review" && void count(),
    );
    // Settings → Connected agents → an activity's "Review".
    const stopOpen = onOpenReview((id) => {
      setReviewFocus(id);
      presentRef.current?.({ sheet: "review" });
    });
    return () => {
      stop();
      stopOpen();
    };
  }, [inApp]);
  // The rest of "Open to" (NAV-12): today's agenda or the last page, once.
  const started = useRef(false);
  useEffect(() => {
    if (!inApp || started.current) return;
    started.current = true;
    const start = startScreen();
    if (start === "agenda") presentRef.current?.({ sheet: "agenda" });
    else if (start === "last-page") {
      const id = lastPage();
      if (id)
        void client.getDoc(id).then(
          (doc) => {
            setNoteBlockId(null);
            setNote(doc);
            presentRef.current?.({ sheet: "note" });
          },
          () => {
            // Gone or no longer yours: Today, as usual.
          },
        );
    }
  }, [inApp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!token || Platform.OS === "web") return;
    const check = async () => {
      // Ticks and captures from widgets, controls, Siri and the tile.
      void flushPending().then((sent) => {
        if (sent) void refresh({ silent: true }).catch(() => {});
      });
      const asked = takeNativeOpen();
      const link = asked ? parseAppLink(asked) : null;
      if (link) openLink.current?.(link);
      const { files, shared: words } = await takeShared();
      if (words) {
        if (presentRef.current) presentRef.current({ share: words });
        else setSharedIn(words);
      }
      if (!files.length) return;
      for (const file of files)
        await sendLocalFile(file).catch((e: Error) => setError(errorText(e)));
      setDocsInUploads(true);
      if (!words) presentRef.current?.({ sheet: "docs" });
    };
    void check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handledPush = useRef("");
  useEffect(() => {
    if (!token) return;
    void registerReviewActions();
    const handle = (response: Notifications.NotificationResponse) => {
      const request = response.notification.request;
      const key = `${request.identifier}:${response.actionIdentifier}`;
      if (handledPush.current === key) return;
      handledPush.current = key;
      // Approve or Decline on a proposal's notification: answered at once.
      const answer = reviewAction(response);
      if (answer) {
        void answerReview(answer).then(
          () => void Notifications.dismissNotificationAsync(request.identifier),
          (e: Error) => setError(errorText(e)),
        );
        return;
      }
      routePush.current?.(request.content.data ?? {});
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    // The tap that opened the app, if it wasn't running.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => response && handle(response))
      .catch(() => {});
    return () => sub.remove();
  }, [token]);

  // After a release, "What's new" opens once by itself (DSN-03). A phone
  // that has never shown one (a new account, a new install) is not shown it.
  useEffect(() => {
    if (!inApp || !user || user.first_run_done === false) return;
    const seen = seenRelease();
    if (!seen) markReleaseSeen();
    else if (hasUnseenRelease(seen))
      presentRef.current?.({ sheet: "whatsnew" });
  }, [inApp, user?.id, user?.first_run_done]);

  if (!ready)
    return (
      <View style={shared.center}>
        <Brand size={34} />
        <Text style={shared.small}>Finding your space…</Text>
      </View>
    );
  if (!token)
    return (
      <AuthScreen
        busy={busy}
        error={error}
        act={act}
        signIn={signIn}
        clearError={() => setError("")}
        twoFactorRequired={twoFactorRequired}
      />
    );
  // Signed in but the email isn't confirmed yet: hold at the gate.
  if (user && !user.email_verified)
    return (
      <VerifyGateScreen
        email={user.email}
        busy={busy}
        act={act}
        onContinue={() => void refreshUser()}
        onSignOut={signOut}
      />
    );

  // Signed in but not on the current Terms: ask before the app.
  if (user && legal && user.terms_version !== legal.terms_version)
    return (
      <ConsentGateScreen
        user={user}
        legal={legal}
        busy={busy}
        act={act}
        onAccepted={() => void refreshUser()}
        onSignOut={signOut}
      />
    );

  const show = (next: Next) =>
    "sheet" in next
      ? setSheet(next.sheet)
      : "share" in next
        ? setSharedIn(next.share)
        : setEditing(next.edit);
  /** Present a sheet or the editor; an open sheet closes first and returns later. */
  const present = (next: Next) => {
    if (sheet) {
      back.current.push(sheet);
      setSheet(null);
      if (Platform.OS === "ios") {
        pending.current = next;
        return;
      }
    }
    show(next);
  };
  presentRef.current = present;
  const goBack = () => {
    const previous = back.current.pop();
    if (previous) setSheet(previous);
  };
  const onSheetDismissed = () => {
    // Only iOS waits for a sheet's dismissal to present the next one. The
    // web build also reports dismissals, but there the next sheet is already
    // showing (and closeSheet already went back), so going back again here
    // would replace it with the sheet that was just left.
    if (Platform.OS !== "ios") return;
    const next = pending.current;
    pending.current = null;
    if (next) show(next);
    else goBack();
  };
  /** On Android there is no onDismiss, so return to the previous sheet now. */
  const closeSheet = () => {
    setSheet(null);
    if (Platform.OS !== "ios") goBack();
  };
  const closeEditor = () => {
    setEditing(null);
    if (Platform.OS !== "ios") goBack();
  };
  const openTask = (item: Item, occurrence?: OccurrenceRef | null) => {
    setTask(item);
    setTaskOccurrence(occurrence ?? null);
    // Wide, on Tasks: beside the list rather than over it.
    if (wideScreen && tab === "Tasks" && !sheet) {
      setBesideOpen(true);
      return;
    }
    present({ sheet: "task" });
  };
  /**
   * Edit a saved item. A repeating one opened on an occurrence shows that
   * occurrence's times; saving asks which occurrences the change is for.
   */
  const editItem = (item: Item) => {
    const occ =
      item.rrule && taskOccurrence?.itemId === item.id ? taskOccurrence : null;
    setEditRepeat(
      item.rrule && item.due_at
        ? {
            itemId: item.id,
            occurrence: occ?.occurrence ?? item.due_at,
            start: occ?.start ?? item.due_at,
            end: occ ? occ.end : item.end_at,
            series: { due_at: item.due_at, end_at: item.end_at },
          }
        : null,
    );
    present({
      edit: occ ? { ...item, due_at: occ.start, end_at: occ.end } : { ...item },
    });
  };
  /** Team / Admin sheets: saved plans open the task detail, new ones the editor. */
  const openFromSheet = (item: Editing) => {
    if ("id" in item) return openTask(item);
    setEditRepeat(null);
    present({ edit: item });
  };
  const clearError = () => setError("");

  const today = new Date();
  const openNew = () => {
    setEditRepeat(null);
    setEditing(freshItem());
  };
  /** Personal pages are always yours; a team's need `items:write`. */
  const canWriteIn = (teamId: string | null) => {
    const team = teamId && teams.find((t) => t.id === teamId);
    return !team || hasTeamPermission(team.role, "items:write");
  };

  const listHandlers = {
    busy,
    onAdd: openNew,
    onOpen: openTask,
    canToggle: (i: Item) => {
      const team = i.team_id && teams.find((t) => t.id === i.team_id);
      return !team || hasTeamPermission(team.role, "items:write");
    },
    onToggle: (i: Item) =>
      act(async () => {
        const status = toggledStatus(i);
        // Offline, it's kept on the phone and shown as ticked already.
        const sent = await outbox.postItemUpdate(i, { status });
        if (status === "done") celebrate(i.title);
        // The row may move to another group or leave this list.
        if (sent) await refresh({ animate: true });
      }),
    /** Long-press a row, or "Move to…" on the board. */
    onSetStatus: (i: Item, status: Status) =>
      void act(async () => {
        const sent = await outbox.postItemUpdate(i, { status });
        if (status === "done") celebrate(i.title);
        if (sent) await refresh({ animate: true });
      }),
  };
  /** "New task here" in a list: the editor with that list and team chosen. */
  const newInList = (list: TaskList) => {
    setEditRepeat(null);
    present({
      edit: { ...freshItem(), list_id: list.id, team_id: list.team_id ?? null },
    });
  };
  const markRead = (n: Notice) =>
    act(async () => {
      await client.markNotificationRead(n.id);
      await refresh();
    });
  /** A "conflict" notice: move its time block to the next free time. */
  const reschedule = (n: Notice) =>
    act(async () => {
      if (n.ref) await client.rescheduleBlock(n.ref);
      if (!n.read) await client.markNotificationRead(n.id);
      await refresh();
    });
  /** A "booking" notice: open that booking (`ref`) and mark the notice read. */
  const openBookingNotice = (n: Notice) => {
    if (!n.ref) return markRead(n);
    setBookingId(n.ref);
    present({ sheet: "booking" });
    if (!n.read) void markRead(n);
  };
  const openBookings = () => {
    setBookingId(null);
    setSheet("booking");
  };
  const openFocus = (item: Item) => {
    setFocus(item);
    present({ sheet: "focus" });
  };
  const closeFocus = () => {
    // Return to the detail of the task last in focus.
    if (focus) setTask((t) => (t && t.id === focus.id ? t : focus));
    closeSheet();
  };
  const openPlanner = (seed: Plan | null, title?: string) => {
    setPlanSeed(seed);
    setPlanTitle(title ?? null);
    present({ sheet: "plan" });
  };
  /** Unfinished work from earlier days, as a plan to look over. */
  const startRollForward = () =>
    act(async () =>
      openPlanner(await client.rollForward(), "Move work forward"),
    );
  /**
   * A plan that includes this task (at-risk and due-soon notices), looking
   * ahead as far as its deadline.
   */
  const startPlanIt = (itemId?: string | null) =>
    act(async () => {
      const known = itemId ? items.find((i) => i.id === itemId) : undefined;
      const item =
        known ??
        (itemId ? await client.getItem(itemId).catch(() => null) : null);
      openPlanner(
        await planIncluding(itemId, item ? deadlineOf(item) : null),
        "Plan my day",
      );
    });
  /**
   * "Plan it" on a Today row: a plan for that task alone, looking ahead as
   * far as its deadline.
   */
  const startPlanOnly = (itemId: string) =>
    act(async () => {
      const item =
        items.find((i) => i.id === itemId) ??
        (await client.getItem(itemId).catch(() => null));
      openPlanner(
        await planOnly(itemId, item ? deadlineOf(item) : null),
        "Plan it",
      );
    });
  /** Opens a task or event by id, fetching it when the list doesn't have it. */
  const openTaskById = (id: string) => {
    const found = items.find((i) => i.id === id);
    if (found) openTask(found);
    else
      void act(async () => {
        openTask(await client.getItem(id));
      });
  };
  /** A planner notice's action; the notice is marked read alongside. */
  const noticeAction = (n: Notice, start: () => Promise<void>) => {
    if (!n.read)
      void client
        .markNotificationRead(n.id)
        .then(() => refresh())
        .catch(() => {});
    return start();
  };
  /** Scan a page of notes: the camera, then Uploads, where it's read. */
  const runScan = () =>
    void scanAndSend((m) => setError(m)).then((sent) => {
      if (!sent) return;
      setDocsInUploads(true);
      present({ sheet: "docs" });
      showToast({ text: "Scanned. It’s being read into a page in Uploads." });
    });

  /** Focus on what's most worth doing now, as Up next picks it. */
  const startFocus = () =>
    void act(async () => {
      const next = await client.getUpNext().catch(() => null);
      const id = next?.suggestions[0]?.item_id;
      const picked =
        (id &&
          (items.find((i) => i.id === id) ??
            (await client.getItem(id).catch(() => null)))) ||
        nextUp(items)[0];
      if (!picked)
        return showToast({ text: "Add a task first, then focus on it." });
      openFocus(picked);
    });

  /** What each way of starting something from the + does. */
  const runCreate = (id: CreateActionId) => {
    switch (id) {
      case "task":
        setEditRepeat(null);
        return present({ edit: freshItem() });
      case "page":
        setDocsStart({ kind: "doc" });
        return present({ sheet: "docs" });
      case "template":
        setDocsStart({ template: true });
        return present({ sheet: "docs" });
      case "scan":
        return runScan();
      case "project":
        setProjectsStart({ new: true });
        return present({ sheet: "projects" });
      case "plan":
        return openPlanner(null, "Plan my day");
      case "focus":
        return startFocus();
      case "ask":
        setTab("AI");
        setSearch("");
        return;
    }
  };

  /** A page or task from recent changes (SHR-02). */
  const openChange = (kind: "doc" | "task", id: string) =>
    kind === "doc"
      ? void act(async () => {
          setNote(await client.getDoc(id));
          setNoteBlockId(null);
          present({ sheet: "note" });
        })
      : void act(async () => openTask(await client.getItem(id)));

  /** Open Settings, at a section when a search chose one (NAV-10). */
  const openSettingsAt = (section: string | null) => {
    setSettingsAt(section ? { section, seq: Date.now() } : null);
    present({ sheet: "settings" });
  };

  /**
   * What a command from Search & do does on the phone (MOB-10): the same
   * list as the web's ⌘K. One this phone has no way to do isn't offered.
   */
  const tabTo = (to: Tab) => () => {
    // A screen, not a sheet: the search goes away rather than waiting behind.
    setSheet(null);
    back.current = [];
    setTab(to);
  };
  const commandRun: Record<string, () => void> = {
    "go.overview": tabTo("Today"),
    "go.my-tasks": tabTo("Tasks"),
    "go.calendar": tabTo("Calendar"),
    "go.ai-assistant": () => {
      tabTo("AI")();
      setSearch("");
    },
    "go.notifications": tabTo("Inbox"),
    "go.agenda": () => present({ sheet: "agenda" }),
    "go.projects": () => present({ sheet: "projects" }),
    "go.docs": () => present({ sheet: "docs" }),
    "go.memory": () => present({ sheet: "memory" }),
    "go.agent": () => present({ sheet: "agent" }),
    "go.views": () => present({ sheet: "views" }),
    "go.study": () => present({ sheet: "study" }),
    "go.lists": () => present({ sheet: "lists" }),
    "go.teams": () => present({ sheet: "teams" }),
    "go.booking": () => {
      setBookingId(null);
      present({ sheet: "booking" });
    },
    "go.admin": () => present({ sheet: "admin" }),
    "go.settings": () => openSettingsAt(null),
    "new.task": () => runCreate("task"),
    "new.event": () => {
      setEditRepeat(null);
      present({ edit: { ...freshItem(), kind: "event" } });
    },
    "new.page": () => runCreate("page"),
    "new.from-template": () => runCreate("template"),
    "new.project": () => runCreate("project"),
    "new.import": () => openSettingsAt("Import & export"),
    "plan.day": () => runCreate("plan"),
    "plan.focus": () => runCreate("focus"),
    "plan.today": tabTo("Calendar"),
    "app.changes": () => present({ sheet: "changes" }),
    "app.whats-new": () => present({ sheet: "whatsnew" }),
    "app.security": () => openSettingsAt("Privacy"),
  };
  const canRunCommand = (c: CommandDef) =>
    c.setting
      ? !!settingById(c.setting)?.phone
      : !!commandRun[c.id] &&
        (c.needs !== "admin" ||
          hasSystemPermission(user?.role, "admin:access"));
  const runCommand = (c: CommandDef) => {
    const entry = c.setting ? settingById(c.setting) : undefined;
    const place = entry?.phone;
    if (place && "sheet" in place) return present({ sheet: place.sheet });
    if (place) return openSettingsAt(place.section);
    commandRun[c.id]?.();
  };

  /** A link into the app (orbyn://, a quick action, a shared link) opens its thing. */
  /** Open something from the Starred list (NAV-07). */
  const openStarred = (item: StarredItem) =>
    openLink.current?.(
      item.kind === "heading"
        ? { kind: "doc", id: item.id, block: item.block_id }
        : item.kind === "doc"
          ? { kind: "doc", id: item.id }
          : item.kind === "task"
            ? { kind: "task", id: item.id }
            : item.kind === "project"
              ? { kind: "project", id: item.id }
              : { kind: "view", id: item.id },
    );

  openLink.current = (link) => {
    switch (link.kind) {
      case "add":
        // Words to add fill Today's quick add, to check and add with a tap:
        // a link never adds anything by itself, whoever sent it. A bare
        // link opens a new task to fill in.
        if (link.text) {
          setSheet(null);
          setTab("Today");
          setQuickAddPrefill({ text: link.text, key: Date.now() });
          return;
        }
        return runCreate("task");
      case "review":
        // Waiting approvals are in the Inbox until the Review inbox lands.
        setSheet(null);
        setTab("Inbox");
        return;
      case "search":
        setSearchStart(link.q);
        return present({ sheet: "search" });
      case "today":
        setTab("Today");
        return;
      case "agenda":
        return present({ sheet: "agenda" });
      case "scan":
        return runScan();
      case "assistant":
        setSheet(null);
        back.current = [];
        return runCreate("ask");
      case "focus":
        return startFocus();
      case "share":
        if (link.url || link.text)
          present({ share: { url: link.url, text: link.text ?? "" } });
        return;
      case "task":
        return void act(async () => openTask(await client.getItem(link.id)));
      case "doc":
        return void act(async () => {
          // A link to one line of a page opens the page there (LNK-04).
          setNoteBlockId(link.block ?? null);
          setNote(await client.getDoc(link.id));
          present({ sheet: "note" });
        });
      case "project":
        setProjectsStart({ open: link.id });
        return present({ sheet: "projects" });
      case "review":
        setReviewFocus(link.id);
        return present({ sheet: "review" });
      case "view":
        setViewToOpen(link.id);
        return present({ sheet: "views" });
      case "agents":
        // Settings → Connected agents: each connection and what it did.
        return present({ sheet: "connections" });
    }
  };

  routePush.current = (data) => {
    const text = (key: string) =>
      typeof data[key] === "string" ? (data[key] as string) : "";
    const kind = text("kind");
    const itemId = text("itemId");
    if (kind === "rollforward") void startRollForward();
    else if (kind === "at_risk" || kind === "deadline")
      void startPlanIt(itemId);
    else if (kind === "project" && text("ref")) {
      setProjectToOpen(text("ref").split(":")[0]);
      present({ sheet: "projects" });
    } else if (kind === "conflict" || kind === "question")
      // An agent's question opens on its card, with the choices as buttons.
      setTab("Inbox");
    else if (kind === "template" && text("ref")) {
      setTemplateToOpen(text("ref"));
      present({ sheet: "projects" });
    } else if (kind === "booking" && text("ref")) {
      setBookingId(text("ref"));
      present({ sheet: "booking" });
    } else if (kind === "session" && text("ref") && itemId) {
      // A session's reminder: tapping it starts the session in focus mode.
      const blockId = text("ref").split(":")[0];
      void act(async () => {
        await client.startSession(blockId, "reminder").catch(() => undefined);
        openFocus(await client.getItem(itemId));
      });
    } else if (kind === "mention" && text("ref").startsWith("doc:")) {
      const docId = text("ref").slice(4).split(":")[0];
      void act(async () => {
        setNote(await client.getDoc(docId));
        present({ sheet: "note" });
      });
    } else if (kind === "review" && text("ref").startsWith("proposal:")) {
      setReviewFocus(text("ref").slice("proposal:".length));
      present({ sheet: "review" });
    } else if (kind === "agent" && text("ref").startsWith("grant:")) {
      // An agent finished a big job: see each change, and undo it, there.
      present({ sheet: "connections" });
    } else if (itemId)
      void act(async () => openTask(await client.getItem(itemId)));
  };
  const planChanged = () => void refresh({ animate: true }).catch(() => {});
  const saveEditing = () =>
    act(async () => {
      if (!editing) return;
      let sent: unknown = true;
      if ("id" in editing) {
        // What the edit started from: what "changed" is measured against if
        // it has to wait for a connection.
        const base = items.find((i) => i.id === editing.id) ?? editing;
        // Progress is owned by the checklist and the task sheet; omitting it
        // keeps the saved value (sending it while steps exist is a 409).
        const { progress: _progress, ...body } = itemBody(editing);
        const repeat = editRepeat?.itemId === editing.id ? editRepeat : null;
        if (repeat) {
          const scope = await askScope(editing.kind, "save");
          if (!scope) return;
          sent = await outbox.updateItem(
            base,
            scope === "all"
              ? {
                  ...body,
                  ...seriesTimes(repeat.series, repeat, {
                    start: body.due_at ?? repeat.start,
                    end: body.end_at,
                  }),
                }
              : body,
            { scope, occurrence: repeat.occurrence },
          );
        } else sent = await outbox.updateItem(base, body);
        const saved = editing;
        setTask((t) => (t && t.id === saved.id ? { ...t, ...saved } : t));
      } else sent = await outbox.createItem(editing);
      closeEditor();
      // Kept on the phone: the lists already show it; there's nothing to fetch.
      if (sent) await refresh();
    });
  const deleteEditing = () =>
    act(async () => {
      if (!editing || !("id" in editing)) return;
      const repeat = editRepeat?.itemId === editing.id ? editRepeat : null;
      const scope = repeat ? await askScope(editing.kind, "delete") : "all";
      if (!scope) return;
      const sent = await outbox.deleteItem(
        editing,
        repeat ? { scope, occurrence: repeat.occurrence } : undefined,
      );
      // Don't return to the detail sheet of an item that's gone.
      if (
        scope !== "this" &&
        back.current.at(-1) === "task" &&
        task?.id === editing.id
      )
        back.current.pop();
      closeEditor();
      if (sent !== null) await refresh();
    });
  const sidePadding = {
    paddingLeft: insets.left + spacing.page,
    paddingRight: insets.right + spacing.page,
  };
  /**
   * Scroll the page so `y` points below the top of `view` show near the
   * top. Called once per change by whoever asks (the calendar on a new day
   * or view), never from a layout or content-size callback.
   */
  const scrollToView = (
    view: React.ComponentRef<typeof View> | null,
    y: number,
  ) => {
    const column = content.current;
    if (!view || !column) return;
    view.measureLayout(
      column,
      (_x, top) =>
        scroller.current?.scrollTo({
          // Below the sticky header (the calendar's controls), not under it.
          y: Math.max(
            0,
            contentY.current + top + y - 24 - stickyHeight.current,
          ),
          animated: !isReducedMotion(),
        }),
      () => {},
    );
  };

  const taskBeside = besideOpen && wideScreen && tab === "Tasks" && !!task;
  /** The task, as a sheet or (on an iPad or wide window) beside Tasks (MOB-12). */
  const taskDetail = (inline: boolean) => (
    <TaskDetail
      visible={inline ? !!task : sheet === "task"}
      inline={inline}
      item={task}
      items={items}
      teams={teams}
      onOpenItem={(i) => {
        // Switch in place: a subtask or the task above it.
        setTaskOccurrence(null);
        setTask(i);
      }}
      onOpenProject={(id) => {
        setProjectToOpen(id);
        setSheet("projects");
      }}
      onAskTask={(item) => {
        assistant.setScope({ kind: "task", id: item.id, name: item.title });
        back.current = [];
        pending.current = null;
        setSheet(null);
        setTab("AI");
      }}
      onOpenPage={(id, blockId) =>
        void client.getDoc(id).then(
          (doc) => {
            setNote(doc);
            setNoteBlockId(blockId ?? null);
            // Closing the page returns to the task.
            present({ sheet: "note" });
          },
          (e) => setError(errorText(e)),
        )
      }
      onClose={inline ? () => setBesideOpen(false) : closeSheet}
      onDismiss={onSheetDismissed}
      occurrence={
        task && taskOccurrence?.itemId === task.id
          ? taskOccurrence.occurrence
          : null
      }
      onOpenNote={(event: Item, series?: boolean) =>
        void client
          // Opened on one class of a repeating event: that class's
          // note, unless the series' own was asked for.
          .itemNote(
            event.id,
            !series && event.rrule && taskOccurrence?.itemId === event.id
              ? taskOccurrence.occurrence
              : null,
          )
          .then((made) => {
            setNote(made);
            setSheet("note");
          })
          .catch((e: Error) => setError(errorText(e)))
      }
      onEdit={editItem}
      onFocus={openFocus}
      onChanged={planChanged}
      onShowOnCalendar={(at) => {
        // Straight to the calendar: nothing reopens behind it.
        back.current = [];
        setSheet(null);
        setSearch("");
        setTab("Calendar");
        setCalendarJump({ at, key: Date.now() });
      }}
    />
  );
  return (
    <PlanningProvider
      lists={lists}
      tags={tags}
      reload={reloadPlanning}
      planned={planned}
      today={todayList}
    >
      <View style={s.screen}>
        {tab === "AI" ? (
          // The assistant draws its own bar (menu, name, new chat), as chat apps do.
          <View style={{ paddingTop: insets.top }} />
        ) : (
          <View
            style={[s.header, sidePadding, { paddingTop: insets.top + 10 }]}
          >
            <View style={s.headerRow}>
              <Brand size={24} />
              <View style={s.headerActions}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={
                    notices.some((n) => !n.read)
                      ? "Notifications, unread updates"
                      : "Notifications"
                  }
                  onPress={() => setTab("Inbox")}
                  style={s.notification}
                >
                  <Icon
                    name="bell"
                    size={20}
                    color={tab === "Inbox" ? colors.accent : colors.textSoft}
                  />
                  {notices.some((n) => !n.read) && <View style={s.unreadDot} />}
                </PressableScale>
                {/* One + on every tab: a tap runs the favourite (New task
                  unless another is chosen), a long press offers the rest. */}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={createLabel(arrangement.favourite)}
                  accessibilityHint="Hold for every way to start something."
                  accessibilityActions={[
                    {
                      name: "longpress",
                      label: "Every way to start something",
                    },
                  ]}
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === "longpress")
                      setCreating(true);
                  }}
                  hitSlop={8}
                  delayLongPress={350}
                  onPress={() => runCreate(arrangement.favourite)}
                  onLongPress={() => {
                    tap();
                    setCreating(true);
                  }}
                  style={({ pressed }) => [s.add, pressed && s.addPressed]}
                >
                  <Icon
                    name="plus"
                    size={20}
                    color={colors.white}
                    strokeWidth={2.2}
                  />
                </PressableScale>
              </View>
            </View>
          </View>
        )}
        <View style={sidePadding}>
          <View style={s.column}>
            <MaintenanceBanner
              maintenance={maintenance}
              admin={hasSystemPermission(user?.role, "system:manage")}
            />
          </View>
        </View>
        <View
          ref={keyboardArea}
          collapsable={false}
          onLayout={keyboard.onLayout}
          style={[s.body, { paddingBottom: keyboard.inset }]}
        >
          {tab === "AI" && (
            <View style={sidePadding}>
              <View style={s.column}>
                <AssistantTopBar
                  assistant={assistant}
                  busy={busy}
                  onMenu={() => setAssistantMenu(true)}
                />
              </View>
            </View>
          )}
          <View style={taskBeside ? s.split : s.fill}>
            <ScrollView
              // Sticky headers can't be switched on and off on a mounted
              // ScrollView: on iOS the calendar came back blank from another
              // tab until the app reloaded. The calendar gets its own.
              key={tab === "Calendar" ? "calendar" : "page"}
              ref={scroller}
              style={s.scroll}
              scrollEnabled={!dragging}
              stickyHeaderIndices={tab === "Calendar" ? [1] : undefined}
              contentContainerStyle={[s.content, sidePadding]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => act(() => refresh())}
                  tintColor={colors.accent}
                  colors={[colors.accent]}
                />
              }
            >
              <View style={s.column}>
                {tab === "Today" && (
                  <Text style={shared.eyebrow}>
                    {today
                      .toLocaleDateString([], {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })
                      .toUpperCase()}
                  </Text>
                )}
                {/* Chat and Calendar provide their own compact page headings. */}
                {tab !== "AI" && tab !== "Calendar" && (
                  <FadeIn key={`head-${tab}`} duration={motion.slow}>
                    <Text style={shared.title}>{tabTitle(tab, user)}</Text>
                    {tab === "Today" && (
                      <Text style={[shared.subtitle, s.subtitle]}>
                        {tabSubtitle(tab)}
                      </Text>
                    )}
                  </FadeIn>
                )}
                <ErrorBanner error={error} onDismiss={() => setError("")} />
                <SyncBar
                  outbox={planner.outbox}
                  onOpen={() => present({ sheet: "sync" })}
                />
                <AnnouncementBanner />
                <FocusElsewhere
                  items={items}
                  hidden={sheet === "focus"}
                  onOpen={openFocus}
                />
              </View>
              {/* Sticky on the Calendar tab: its date navigation and view switch. */}
              <View
                collapsable={false}
                onLayout={(e) => {
                  stickyHeight.current = e.nativeEvent.layout.height;
                }}
                style={[s.column, s.sticky]}
              >
                <SlotHost slot={calendarControls} />
              </View>
              <View
                ref={content}
                collapsable={false}
                // Only records where the column starts; it never scrolls.
                onLayout={(e) => {
                  contentY.current = e.nativeEvent.layout.y;
                }}
                style={s.column}
              >
                <FadeIn key={`body-${tab}`} duration={motion.slow}>
                  {tab === "Today" && (
                    <WelcomeBack
                      onOpenItem={(id) =>
                        void act(async () => openTask(await client.getItem(id)))
                      }
                      onOpenDoc={(docId) =>
                        void client.getDoc(docId).then((doc) => {
                          setNote(doc);
                          present({ sheet: "note" });
                        })
                      }
                      onOpenAsks={() => setTab("Inbox")}
                    />
                  )}
                  {tab === "Today" && (
                    <TodayScreen
                      items={items}
                      homeLayout={accountPrefs.prefs.home}
                      agentName={assistant.agentName}
                      onOpenLink={(link) => openLink.current?.(link)}
                      onOpenWorkspace={(what) => present({ sheet: what })}
                      onPlanDay={() => {
                        setTab("AI");
                        void assistant.ask(planDayPrompt);
                      }}
                      onOpenPlanner={openPlanner}
                      userId={user?.id}
                      onQuickAdded={() =>
                        void refresh({ animate: true }).catch(() => {})
                      }
                      quickAddPrefill={quickAddPrefill}
                      onQuickAddPrefillUsed={() => setQuickAddPrefill(null)}
                      onAsk={(text) => {
                        setTab("AI");
                        void assistant.ask(text);
                      }}
                      onShowAll={() => {
                        setTab("Tasks");
                        setSearch("");
                      }}
                      onFocus={openFocus}
                      onOpenById={openTaskById}
                      onPlanTask={(id) => void startPlanOnly(id)}
                      onPlanAgain={(id) =>
                        void act(async () =>
                          openPlanner(
                            await client.rollForward([id]),
                            "Move work forward",
                          ),
                        )
                      }
                      onOpenCalendar={() => setTab("Calendar")}
                      {...listHandlers}
                    />
                  )}
                  {tab === "Tasks" && (
                    <TasksScreen
                      viewChoice={accountPrefs.prefs.views.tasks}
                      onViewChoice={(c) =>
                        accountPrefs.setViewChoice("tasks", c)
                      }
                      items={items}
                      search={search}
                      onSearch={setSearch}
                      user={user}
                      onManageLists={() => setSheet("lists")}
                      onManageTags={() => setSheet("tags")}
                      onDragging={setDragging}
                      onReorder={(i, place) =>
                        void act(async () => {
                          await client.moveItem(i.id, place);
                          await refresh({ animate: true });
                        })
                      }
                      onAddWith={(prefill) => {
                        setEditRepeat(null);
                        present({ edit: { ...freshItem(), ...prefill } });
                      }}
                      onChangeItem={(i, change) =>
                        void act(async () => {
                          // Handing a task to your agent or taking it back
                          // (W3), and giving it to someone at the same time.
                          if ("agent" in change) {
                            const { agent, ...rest } = change;
                            const after =
                              agent === "hand"
                                ? await client.handTaskToAgent(i.id)
                                : await client.takeTaskBack(i.id);
                            if ("assignee_id" in rest)
                              await client.updateItem(i.id, {
                                ...itemBody(after),
                                assignee_id: rest.assignee_id ?? null,
                              });
                          } else
                            await client.updateItem(i.id, {
                              ...itemBody(i),
                              ...change,
                            });
                          await refresh({ animate: true });
                        })
                      }
                      {...listHandlers}
                    />
                  )}
                  {tab === "Calendar" && (
                    <CalendarScreen
                      items={items}
                      act={act}
                      onChanged={planChanged}
                      teams={teams}
                      preview={preview}
                      onPreviewChange={setPreview}
                      onPreviewDone={() => setPreview(null)}
                      onDragging={setDragging}
                      onOpenOccurrence={openTask}
                      onFocus={openFocus}
                      onScrollTo={scrollToView}
                      controlsSlot={calendarControls}
                      jump={calendarJump}
                      onOpenFieldTarget={(target, id) => {
                        if (target === "project") {
                          setProjectsStart({ open: id });
                          present({ sheet: "projects" });
                        } else
                          void act(async () => {
                            setNote(await client.getDoc(id));
                            present({ sheet: "note" });
                          });
                      }}
                      {...listHandlers}
                    />
                  )}
                  {tab === "AI" && (
                    <AssistantScreen
                      assistant={assistant}
                      drawerOpen={assistantMenu}
                      onDrawerChange={setAssistantMenu}
                      onOpenMemory={() => present({ sheet: "memory" })}
                      onOpenAgentNotes={() => present({ sheet: "agent" })}
                      onOpenSettings={() => present({ sheet: "connections" })}
                      onBackToProject={(id) => {
                        setProjectToOpen(id);
                        setSheet("projects");
                      }}
                      items={items}
                      busy={busy}
                      onOpenSource={(source) => {
                        if ("doc_id" in source)
                          void client.getDoc(source.doc_id).then((doc) => {
                            setNoteBlockId(source.block_id ?? null);
                            setNote(doc);
                            setSheet("note");
                          });
                        else if (source.kind === "task")
                          openTaskById(source.id);
                        else if (source.project_id) {
                          setProjectToOpen(source.project_id);
                          setProjectSectionToOpen(
                            source.kind === "decision"
                              ? "decisions"
                              : "history",
                          );
                          setProjectSourceId(source.id);
                          setSheet("projects");
                        }
                      }}
                      onKeptNote={(docId) =>
                        void client.getDoc(docId).then((doc) => {
                          setNote(doc);
                          setSheet("note");
                        })
                      }
                      onShowOnCalendar={(at) => {
                        setSearch("");
                        setTab("Calendar");
                        setCalendarJump({ at, key: Date.now() });
                      }}
                    />
                  )}
                  {tab === "Inbox" && (
                    <InboxScreen
                      notices={notices}
                      busy={busy}
                      onRead={markRead}
                      onReschedule={reschedule}
                      onOpenBooking={openBookingNotice}
                      onRollForward={(n) =>
                        void noticeAction(n, startRollForward)
                      }
                      onPlanIt={(n) =>
                        void noticeAction(n, () => startPlanIt(n.item_id))
                      }
                      onOpenItem={(n) =>
                        void noticeAction(n, () =>
                          act(async () => {
                            if (n.item_id)
                              openTask(await client.getItem(n.item_id));
                          }),
                        )
                      }
                      onOpenItemById={(id) =>
                        void act(async () => openTask(await client.getItem(id)))
                      }
                      reviewPending={reviewPending}
                      onOpenReview={(id, n) => {
                        const open = async () => {
                          setReviewFocus(id);
                          present({ sheet: "review" });
                        };
                        if (n) void noticeAction(n, open);
                        else void open();
                      }}
                      onOpenTemplate={(n) =>
                        void noticeAction(n, async () => {
                          setTemplateToOpen(n.ref ?? null);
                          present({ sheet: "projects" });
                        })
                      }
                      onOpenProject={(n) =>
                        void noticeAction(n, async () => {
                          setProjectToOpen(n.ref?.split(":")[0] ?? null);
                          present({ sheet: "projects" });
                        })
                      }
                      onOpenAgents={(n) =>
                        void noticeAction(n, async () =>
                          present({ sheet: "connections" }),
                        )
                      }
                      onOpenDoc={(n, docId) =>
                        void noticeAction(n, () =>
                          act(async () => {
                            setNote(await client.getDoc(docId));
                            present({ sheet: "note" });
                          }),
                        )
                      }
                      onOpenPage={(docId) =>
                        void act(async () => {
                          setNote(await client.getDoc(docId));
                          present({ sheet: "note" });
                        })
                      }
                      onStartSession={(n) =>
                        void noticeAction(n, () =>
                          act(async () => {
                            await client
                              .startSession(n.ref!.split(":")[0], "reminder")
                              .catch(() => undefined);
                            if (n.item_id)
                              openFocus(await client.getItem(n.item_id));
                          }),
                        )
                      }
                    />
                  )}
                  {tab === "Browse" && (
                    <BrowseScreen
                      user={user}
                      starred={starred}
                      onOpenStarred={openStarred}
                      arrangement={accountPrefs.prefs.sidebar}
                      pinnedViews={pinnedViews}
                      onOpenView={(id) => {
                        setViewToOpen(id);
                        setSheet("views");
                      }}
                      onOpen={(to) =>
                        to === "booking"
                          ? openBookings()
                          : to === "search"
                            ? (setSearchStart(""), setSheet("search"))
                            : to === "settings"
                              ? (setSettingsAt(null), setSheet("settings"))
                              : setSheet(to)
                      }
                    />
                  )}
                </FadeIn>
              </View>
            </ScrollView>
            {taskBeside && <View style={s.splitPanel}>{taskDetail(true)}</View>}
          </View>
          {tab === "AI" && (
            <View style={[s.footer, sidePadding]}>
              <View style={s.column}>
                <AssistantComposer assistant={assistant} busy={busy} />
              </View>
            </View>
          )}
        </View>
        <TabBar
          tab={tab}
          onChange={(t) => {
            // Tapping the tab you're on goes back to its top and refreshes,
            // the way Instagram and Facebook do. The assistant reads from
            // the bottom, so there it goes to the newest message instead.
            if (t === tab) {
              const animated = !isReducedMotion();
              if (t === "AI") scroller.current?.scrollToEnd({ animated });
              else scroller.current?.scrollTo({ y: 0, animated });
              if (!refreshing) void act(() => refresh());
              return;
            }
            setTab(t);
            setSearch("");
          }}
        />
        <CelebrationHost bottom={Math.max(insets.bottom, 10) + 64} />
        <CreateSheet
          visible={creating}
          arrangement={arrangement}
          onArrange={(next) => {
            setArrangement(next);
            saveLocal(ARRANGE_KEY, JSON.stringify(next));
          }}
          onRun={runCreate}
          onClose={() => setCreating(false)}
        />
        <ShareIntoSheet
          shared={sharedIn}
          canWriteIn={canWriteIn}
          onClose={() => setSharedIn(null)}
          onSaved={(result) => {
            setSharedIn(null);
            void refresh({ animate: true }).catch(() => {});
            const item = result.item;
            const doc = result.doc;
            showToast({
              text: result.note,
              action: item
                ? { label: "Open", run: () => openTask(item) }
                : doc
                  ? {
                      label: "Open",
                      run: () =>
                        void client.getDoc(doc.id).then(
                          (d) => {
                            setNote(d);
                            present({ sheet: "note" });
                          },
                          () => {},
                        ),
                    }
                  : undefined,
            });
          }}
        />
        <ItemEditor
          editing={editing}
          teams={teams}
          items={items}
          busy={busy}
          error={error}
          onChange={(patch) =>
            setEditing((prev) => (prev ? { ...prev, ...patch } : prev))
          }
          onSave={saveEditing}
          onDelete={deleteEditing}
          onClose={closeEditor}
          onDismissed={goBack}
        />
        {!taskBeside && taskDetail(false)}
        <FocusScreen
          item={sheet === "focus" ? focus : null}
          items={items}
          onClose={closeFocus}
          onDismiss={onSheetDismissed}
          onSwitch={setFocus}
          onChanged={planChanged}
          readOnly={!!focus && !listHandlers.canToggle(focus)}
        />
        <PlanSheet
          visible={sheet === "plan"}
          seed={planSeed}
          title={planTitle ?? undefined}
          teams={teams}
          items={items}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onApplied={() => {
            setPreview(null);
            planChanged();
          }}
          onShowOnCalendar={(plan) => {
            setPreview(plan);
            setTab("Calendar");
            setSearch("");
            closeSheet();
          }}
          onShowDay={(at) => {
            // Straight to the calendar: nothing reopens behind it.
            back.current = [];
            setSheet(null);
            setSearch("");
            setTab("Calendar");
            setCalendarJump({ at, key: Date.now() });
          }}
        />
        <ViewsSheet
          visible={sheet === "views"}
          teams={teams}
          userId={user?.id}
          openViewId={viewToOpen}
          onViewOpened={() => setViewToOpen(null)}
          actions={{
            onToggle: listHandlers.onToggle,
            onSetStatus: listHandlers.onSetStatus,
          }}
          onOpenRow={(row) => {
            if (row.kind === "task")
              void act(async () => openTask(await client.getItem(row.id)));
            else if (row.kind === "page")
              void act(async () => {
                setNote(await client.getDoc(row.id));
                present({ sheet: "note" });
              });
            else {
              setProjectsStart({ open: row.id });
              present({ sheet: "projects" });
            }
          }}
          onClose={() => {
            closeSheet();
            loadPinnedViews();
          }}
          onDismiss={onSheetDismissed}
        />
        <ListsSheet
          visible={sheet === "lists"}
          teams={teams}
          items={items}
          handlers={listHandlers}
          onNewTask={newInList}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <Sheet
          visible={sheet === "settings"}
          title="Settings"
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        >
          {/* Scrolls, with the page's padding, like every other sheet. */}
          <ScrollView
            ref={settingsScroller}
            contentContainerStyle={sheetStyles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
          >
            <View style={sheetStyles.column}>
              <SettingsScreen
                user={user}
                busy={busy}
                act={act}
                onUser={setUser}
                onSignOut={() => {
                  setPreview(null);
                  signOut();
                }}
                onOpenStatus={() => setSheet("status")}
                onOpenPlanning={() => setSheet("planning")}
                onOpenConnections={() => setSheet("connections")}
                onOpenTags={() => setSheet("tags")}
                onOpenHabits={() => setSheet("habits")}
                onOpenSync={() => setSheet("sync")}
                onOpenWhatsNew={() => setSheet("whatsnew")}
                openAt={settingsAt}
                arrangement={accountPrefs.prefs.sidebar}
                onArrange={(sidebar) => accountPrefs.save({ sidebar })}
                scrollTo={(y) =>
                  settingsScroller.current?.scrollTo({ y, animated: true })
                }
                onAccountDeleted={() => {
                  setSheet(null);
                  setPreview(null);
                  void forgetSession();
                }}
              />
            </View>
          </ScrollView>
        </Sheet>
        <SearchSheet
          visible={sheet === "search"}
          initialQuery={searchStart}
          teams={teams}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onOpen={(type, id, blockId) => {
            if (type === "doc")
              void act(async () => {
                setNote(await client.getDoc(id));
                setNoteBlockId(blockId);
                present({ sheet: "note" });
              });
            else if (type === "project") {
              setProjectsStart({ open: id });
              present({ sheet: "projects" });
            } else if (type === "task" || type === "event")
              void act(async () => openTask(await client.getItem(id)));
          }}
          canRun={canRunCommand}
          // What a command opens comes over the search, as a result does.
          onCommand={runCommand}
        />
        <RecentChangesSheet
          visible={sheet === "changes"}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onOpen={openChange}
        />
        <WhatsNewSheet
          visible={sheet === "whatsnew"}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        {user && user.first_run_done === false && (
          <FirstRunSheet
            visible={!sheet && !editing}
            user={user}
            onDone={(next, made) => {
              markReleaseSeen();
              setUser(next);
              void refresh();
              if (made?.brief_id)
                void act(async () => {
                  setNote(await client.getDoc(made.brief_id!));
                  setNoteBlockId(null);
                  present({ sheet: "note" });
                });
            }}
          />
        )}
        <ProgressSheet
          visible={sheet === "progress"}
          teams={teams}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <SyncSheet
          visible={sheet === "sync"}
          outbox={planner.outbox}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <StudySheet
          visible={sheet === "study"}
          suggestFrom={studySuggest}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onOpenPage={(doc) => {
            setNote(doc);
            present({ sheet: "note" });
          }}
          onPlanned={() => void refresh()}
        />
        <DocsSheet
          onSearch={() => {
            setSearchStart("");
            present({ sheet: "search" });
          }}
          visible={sheet === "docs" || sheet === "memory" || sheet === "agent"}
          fixedKind={
            sheet === "memory"
              ? "memory"
              : sheet === "agent"
                ? "agent"
                : undefined
          }
          onOpenProject={(id) => {
            setProjectToOpen(id);
            present({ sheet: "projects" });
          }}
          userId={user?.id}
          canWriteDoc={canWriteIn}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onItemsChanged={() => void refresh()}
          onMakeCards={(docId, title, max) => {
            setStudySuggest({ docId, title, max });
            present({ sheet: "study" });
          }}
          startInUploads={docsInUploads}
          startInTemplates={!!docsStart?.template}
          startNew={docsStart?.kind ?? null}
          onStarted={() => {
            setDocsInUploads(false);
            setDocsStart(null);
          }}
        />
        <DocsSheet
          onSearch={() => {
            setSearchStart("");
            present({ sheet: "search" });
          }}
          visible={sheet === "note"}
          onOpenProject={(id) => {
            setProjectToOpen(id);
            present({ sheet: "projects" });
          }}
          initialDoc={note}
          initialBlockId={noteBlockId}
          userId={user?.id}
          canWriteDoc={canWriteIn}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onItemsChanged={() => void refresh()}
        />
        <DocsSheet
          onSearch={() => {
            setSearchStart("");
            present({ sheet: "search" });
          }}
          visible={sheet === "agenda"}
          agenda
          userId={user?.id}
          canWriteDoc={canWriteIn}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onItemsChanged={() => void refresh()}
        />
        <ProjectsSheet
          initialProjectId={projectToOpen}
          initialSection={projectSectionToOpen}
          initialSourceId={projectSourceId}
          onInitialProjectShown={() => {
            setProjectToOpen(null);
            setProjectSectionToOpen(null);
            setProjectSourceId(null);
          }}
          canWriteIn={canWriteIn}
          userId={user?.id}
          visible={sheet === "projects"}
          items={items}
          teams={teams}
          openTemplate={templateToOpen}
          startNew={!!projectsStart?.new}
          openProject={projectsStart?.open ?? null}
          onStarted={() => setProjectsStart(null)}
          onClose={() => {
            setTemplateToOpen(null);
            setProjectsStart(null);
            closeSheet();
          }}
          onDismiss={onSheetDismissed}
          onOpenItem={openTask}
          onOpenPlanner={openPlanner}
          onAskProject={(project, question) => {
            assistant.setScope({
              kind: "project",
              id: project.id,
              name: project.name,
            });
            if (question) assistant.setMessage(question);
            back.current = [];
            pending.current = null;
            setSheet(null);
            setTab("AI");
          }}
          onOpenNote={(docId, blockId) =>
            void client.getDoc(docId).then((doc) => {
              setNote(doc);
              setNoteBlockId(blockId ?? null);
              present({ sheet: "note" });
            })
          }
          onItemsChanged={() => void refresh()}
        />
        <TagsSheet
          visible={sheet === "tags"}
          teams={teams}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <HabitsSheet
          visible={sheet === "habits"}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <PlanningSheet
          visible={sheet === "planning"}
          teams={teams}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <ConnectionsSheet
          visible={sheet === "connections"}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <BookingSheet
          visible={sheet === "booking"}
          user={user}
          teams={teams}
          bookingId={bookingId}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <TeamsSheet
          visible={sheet === "teams"}
          user={user}
          teams={teams}
          busy={busy}
          error={error}
          clearError={clearError}
          act={act}
          refresh={refresh}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onOpenItem={openFromSheet}
          onOpenChange={openChange}
        />
        <ReviewSheet
          visible={sheet === "review"}
          focusId={reviewFocus}
          onFocused={() => setReviewFocus(null)}
          onCount={setReviewPending}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <StatusSheet
          visible={sheet === "status"}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        {hasSystemPermission(user?.role, "admin:access") && (
          <AdminSheet
            visible={sheet === "admin"}
            user={user}
            busy={busy}
            error={error}
            clearError={clearError}
            act={act}
            refresh={refresh}
            onClose={closeSheet}
            onDismiss={onSheetDismissed}
            onOpenItem={openFromSheet}
            onMaintenance={setMaintenance}
          />
        )}
      </View>
    </PlanningProvider>
  );
}

/** From this width, Tasks keeps the open task beside it (MOB-12). */
const SPLIT_WIDTH = 1000;

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    headerActions: { flexDirection: "row", gap: 10, alignItems: "center" },
    notification: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    unreadDot: {
      position: "absolute",
      top: 9,
      right: 10,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.highText,
    },
    header: {
      backgroundColor: colors.background,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      maxWidth: spacing.maxContent,
      alignSelf: "center",
    },
    // The way to make anything, on every screen: it gets a thumb's worth.
    add: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    addPressed: { backgroundColor: colors.accentPressed },
    scroll: { flex: 1 },
    fill: { flex: 1 },
    split: { flex: 1, flexDirection: "row" },
    splitPanel: { width: 420, maxWidth: "45%" },
    body: { flex: 1 },
    footer: {
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 8,
      paddingBottom: 8,
    },
    content: { paddingTop: 18, paddingBottom: 32 },
    column: {
      width: "100%",
      maxWidth: spacing.maxContent,
      alignSelf: "center",
    },
    subtitle: { marginBottom: 20 },
    /** The sticky header: opaque, so the page scrolls under it. */
    sticky: { backgroundColor: colors.background },
  }),
);
