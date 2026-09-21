import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import {
  freshItem,
  motion,
  planDayPrompt,
  hasSystemPermission,
  hasTeamPermission,
  itemBody,
  type Doc,
  type Item,
  type Notice,
  type Plan,
  type Status,
  type TaskList,
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
import { PlanningProvider } from "../lib/planningContext";
import { planIncluding } from "../lib/plans";
import { askScope, seriesTimes, type OccurrenceRef } from "../lib/scope";
import { toggledStatus } from "../lib/progress";
import { FadeIn, PressableScale, isReducedMotion } from "../motion";
import { AdminSheet } from "../screens/AdminSheet";
import { AssistantComposer, AssistantScreen } from "../screens/AssistantScreen";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { AuthScreen } from "../screens/AuthScreen";
import { VerifyGateScreen } from "../screens/VerifyGateScreen";
import { BookingSheet } from "../screens/BookingSheet";
import { CalendarScreen } from "../screens/CalendarScreen";
import { ConnectionsSheet } from "../screens/ConnectionsSheet";
import { FocusScreen } from "../screens/FocusScreen";
import { HabitsSheet } from "../screens/HabitsSheet";
import { InboxScreen } from "../screens/InboxScreen";
import { ListsSheet } from "../screens/ListsSheet";
import { PlanningSheet } from "../screens/PlanningSheet";
import { PlanSheet } from "../screens/PlanSheet";
import { SettingsScreen } from "../screens/SettingsScreen";
import { StatusSheet } from "../screens/StatusSheet";
import { TagsSheet } from "../screens/TagsSheet";
import { DocsSheet } from "../screens/docs/DocsSheet";
import { ProjectsSheet } from "../screens/docs/ProjectsSheet";
import { TaskDetail } from "../screens/TaskDetail";
import { TasksScreen } from "../screens/TasksScreen";
import { TeamsSheet } from "../screens/TeamsSheet";
import { TodayScreen } from "../screens/TodayScreen";
import { colors, spacing, themed } from "../theme";
import { shared } from "../styles";

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
  | "agenda"
  | "note"
  | "projects";
/** What to present next: a sheet or the item editor. */
type Next = { sheet: SheetName } | { edit: Editing };

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
    refreshUser,
    twoFactorRequired,
  } = planner;
  const assistant = useAssistant({ token, act, refresh, items });
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("Today");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  /** The task shown in the detail sheet. */
  const [task, setTask] = useState<Item | null>(null);
  /** The meeting note being read, opened from its event. */
  const [note, setNote] = useState<Doc | null>(null);
  /** The task in focus mode. */
  const [focus, setFocus] = useState<Item | null>(null);
  /** A plan to open the Plan my day sheet on (unfinished work moved forward). */
  const [planSeed, setPlanSeed] = useState<Plan | null>(null);
  /** The booking to open the Booking sheet on (from a notification). */
  const [bookingId, setBookingId] = useState<string | null>(null);
  /** Modal waiting for the sheet's dismiss animation before it opens (iOS). */
  const pending = useRef<Next | null>(null);
  /** Sheets to reopen, most recent last, once the modal above them closes. */
  const back = useRef<SheetName[]>([]);
  /** An unapplied plan shown as faint blocks on the calendar. */
  const [preview, setPreview] = useState<Plan | null>(null);
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
  const handledPush = useRef("");
  useEffect(() => {
    if (!token) return;
    const handle = (response: Notifications.NotificationResponse) => {
      const request = response.notification.request;
      if (handledPush.current === request.identifier) return;
      handledPush.current = request.identifier;
      routePush.current?.(request.content.data ?? {});
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    // The tap that opened the app, if it wasn't running.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => response && handle(response))
      .catch(() => {});
    return () => sub.remove();
  }, [token]);

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

  const show = (next: Next) =>
    "sheet" in next ? setSheet(next.sheet) : setEditing(next.edit);
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
  const goBack = () => {
    const previous = back.current.pop();
    if (previous) setSheet(previous);
  };
  const onSheetDismissed = () => {
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
        await client.postItemUpdate(i.id, { status });
        if (status === "done") celebrate(i.title);
        // The row may move to another group or leave this list.
        await refresh({ animate: true });
      }),
    /** Long-press a row, or "Move to…" on the board. */
    onSetStatus: (i: Item, status: Status) =>
      void act(async () => {
        await client.postItemUpdate(i.id, { status });
        if (status === "done") celebrate(i.title);
        await refresh({ animate: true });
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
  /** A plan that includes this task (at-risk and due-soon notices). */
  const startPlanIt = (itemId?: string | null) =>
    act(async () => openPlanner(await planIncluding(itemId), "Plan my day"));
  /** A planner notice's action; the notice is marked read alongside. */
  const noticeAction = (n: Notice, start: () => Promise<void>) => {
    if (!n.read)
      void client
        .markNotificationRead(n.id)
        .then(() => refresh())
        .catch(() => {});
    return start();
  };
  routePush.current = (data) => {
    const text = (key: string) =>
      typeof data[key] === "string" ? (data[key] as string) : "";
    const kind = text("kind");
    const itemId = text("itemId");
    if (kind === "rollforward") void startRollForward();
    else if (kind === "at_risk" || kind === "deadline")
      void startPlanIt(itemId);
    else if (kind === "conflict") setTab("Inbox");
    else if (kind === "booking" && text("ref")) {
      setBookingId(text("ref"));
      present({ sheet: "booking" });
    } else if (itemId)
      void act(async () => openTask(await client.getItem(itemId)));
  };
  const planChanged = () => void refresh({ animate: true }).catch(() => {});
  const saveEditing = () =>
    act(async () => {
      if (!editing) return;
      if ("id" in editing) {
        // Progress is owned by the checklist and the task sheet; omitting it
        // keeps the saved value (sending it while steps exist is a 409).
        const { progress: _progress, ...body } = itemBody(editing);
        const repeat = editRepeat?.itemId === editing.id ? editRepeat : null;
        if (repeat) {
          const scope = await askScope(editing.kind, "save");
          if (!scope) return;
          await client.updateItem(
            editing.id,
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
        } else await client.updateItem(editing.id, body);
        const saved = editing;
        setTask((t) => (t && t.id === saved.id ? { ...t, ...saved } : t));
      } else await client.createItem(editing);
      closeEditor();
      await refresh();
    });
  const deleteEditing = () =>
    act(async () => {
      if (!editing || !("id" in editing)) return;
      const repeat = editRepeat?.itemId === editing.id ? editRepeat : null;
      const scope = repeat ? await askScope(editing.kind, "delete") : "all";
      if (!scope) return;
      await client.deleteItem(
        editing.id,
        editing.version,
        repeat ? { scope, occurrence: repeat.occurrence } : {},
      );
      // Don't return to the detail sheet of an item that's gone.
      if (
        scope !== "this" &&
        back.current.at(-1) === "task" &&
        task?.id === editing.id
      )
        back.current.pop();
      closeEditor();
      await refresh();
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

  return (
    <PlanningProvider lists={lists} tags={tags} reload={reloadPlanning}>
      <View style={s.screen}>
        <View style={[s.header, sidePadding, { paddingTop: insets.top + 10 }]}>
          <View style={s.headerRow}>
            <Brand size={24} />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="New item"
              hitSlop={8}
              onPress={openNew}
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
          <ScrollView
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
              <Text style={shared.eyebrow}>
                {today
                  .toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                  .toUpperCase()}
              </Text>
              {/* Keyed by tab: replays on navigation only, never on refresh. */}
              <FadeIn key={`head-${tab}`} duration={motion.slow}>
                <Text style={shared.title}>{tabTitle(tab, user)}</Text>
                <Text style={[shared.subtitle, s.subtitle]}>
                  {tabSubtitle(tab)}
                </Text>
              </FadeIn>
              <ErrorBanner error={error} onDismiss={() => setError("")} />
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
                  <TodayScreen
                    items={items}
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
                    onAsk={(text) => {
                      setTab("AI");
                      void assistant.ask(text);
                    }}
                    onShowAll={() => {
                      setTab("Tasks");
                      setSearch("");
                    }}
                    {...listHandlers}
                  />
                )}
                {tab === "Tasks" && (
                  <TasksScreen
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
                    {...listHandlers}
                  />
                )}
                {tab === "AI" && (
                  <AssistantScreen
                    assistant={assistant}
                    items={items}
                    busy={busy}
                    onOpenSource={(source) =>
                      void client.getDoc(source.doc_id).then((doc) => {
                        setNote(doc);
                        setSheet("note");
                      })
                    }
                    onKeptNote={(docId) =>
                      void client.getDoc(docId).then((doc) => {
                        setNote(doc);
                        setSheet("note");
                      })
                    }
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
                  />
                )}
                {tab === "Settings" && (
                  <SettingsScreen
                    user={user}
                    busy={busy}
                    act={act}
                    onUser={setUser}
                    onSignOut={() => {
                      setPreview(null);
                      signOut();
                    }}
                    teamCount={teams.length}
                    onOpenTeams={() => setSheet("teams")}
                    onOpenAdmin={() => setSheet("admin")}
                    onOpenStatus={() => setSheet("status")}
                    onOpenPlanning={() => setSheet("planning")}
                    onOpenConnections={() => setSheet("connections")}
                    onOpenBooking={openBookings}
                    onOpenTags={() => setSheet("tags")}
                    onOpenDocs={() => setSheet("docs")}
                    onOpenHabits={() => setSheet("habits")}
                  />
                )}
              </FadeIn>
            </View>
          </ScrollView>
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
          unread={notices.some((n) => !n.read)}
          onChange={(t) => {
            setTab(t);
            setSearch("");
          }}
        />
        <CelebrationHost bottom={Math.max(insets.bottom, 10) + 64} />
        <ItemEditor
          editing={editing}
          teams={teams}
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
        <TaskDetail
          visible={sheet === "task"}
          item={task}
          items={items}
          teams={teams}
          onOpenItem={(i) => {
            // Switch in place: a subtask or the task above it.
            setTaskOccurrence(null);
            setTask(i);
          }}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onOpenNote={(event: Item) =>
            void client
              .itemNote(event.id)
              .then((made) => {
                setNote(made);
                setSheet("note");
              })
              .catch((e: Error) => setError(e.message))
          }
          onEdit={editItem}
          onFocus={openFocus}
          onChanged={planChanged}
        />
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
        <DocsSheet
          visible={sheet === "docs"}
          userId={user?.id}
          canWriteDoc={canWriteIn}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onItemsChanged={() => void refresh()}
        />
        <DocsSheet
          visible={sheet === "note"}
          initialDoc={note}
          userId={user?.id}
          canWriteDoc={canWriteIn}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onItemsChanged={() => void refresh()}
        />
        <DocsSheet
          visible={sheet === "agenda"}
          agenda
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onItemsChanged={() => void refresh()}
        />
        <ProjectsSheet
          visible={sheet === "projects"}
          items={items}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onOpenItem={openTask}
          onOpenNote={(docId) =>
            void client.getDoc(docId).then((doc) => {
              setNote(doc);
              setSheet("note");
            })
          }
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

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
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
    add: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    addPressed: { backgroundColor: colors.accentPressed },
    scroll: { flex: 1 },
    body: { flex: 1 },
    footer: {
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 8,
      paddingBottom: 8,
    },
    content: { paddingTop: 22, paddingBottom: 32 },
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
