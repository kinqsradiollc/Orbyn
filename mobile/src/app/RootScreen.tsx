import React, { useRef, useState } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  freshItem,
  motion,
  planDayPrompt,
  hasSystemPermission,
  hasTeamPermission,
  itemBody,
  type Item,
  type Notice,
  type Plan,
} from "@orbyn/core";
import { tabSubtitle, tabTitle, type Tab } from "./tabs";
import { Brand } from "../components/Brand";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { ItemEditor, type Editing } from "../components/ItemEditor";
import { MaintenanceBanner } from "../components/MaintenanceBanner";
import { TabBar } from "../components/TabBar";
import { useAssistant } from "../hooks/useAssistant";
import { usePlanner } from "../hooks/usePlanner";
import { client } from "../lib/api";
import { PlanningProvider } from "../lib/planningContext";
import { toggledStatus } from "../lib/progress";
import { FadeIn, PressableScale } from "../motion";
import { AdminSheet } from "../screens/AdminSheet";
import { AssistantScreen } from "../screens/AssistantScreen";
import { AuthScreen } from "../screens/AuthScreen";
import { BookingSheet } from "../screens/BookingSheet";
import { CalendarScreen } from "../screens/CalendarScreen";
import { ConnectionsSheet } from "../screens/ConnectionsSheet";
import { FocusScreen } from "../screens/FocusScreen";
import { InboxScreen } from "../screens/InboxScreen";
import { ListsSheet } from "../screens/ListsSheet";
import { PlanningSheet } from "../screens/PlanningSheet";
import { PlanSheet } from "../screens/PlanSheet";
import { SettingsScreen } from "../screens/SettingsScreen";
import { StatusSheet } from "../screens/StatusSheet";
import { TaskDetail } from "../screens/TaskDetail";
import { TasksScreen } from "../screens/TasksScreen";
import { TeamsSheet } from "../screens/TeamsSheet";
import { TodayScreen } from "../screens/TodayScreen";
import { colors, spacing } from "../theme";
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
  | "booking";
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
  } = planner;
  const assistant = useAssistant({ token, act, refresh, items });
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("Today");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  /** The task shown in the detail sheet. */
  const [task, setTask] = useState<Item | null>(null);
  /** The task in focus mode. */
  const [focus, setFocus] = useState<Item | null>(null);
  /** A plan to open the Plan my day sheet on (unfinished work moved forward). */
  const [planSeed, setPlanSeed] = useState<Plan | null>(null);
  /** Modal waiting for the sheet's dismiss animation before it opens (iOS). */
  const pending = useRef<Next | null>(null);
  /** Sheets to reopen, most recent last, once the modal above them closes. */
  const back = useRef<SheetName[]>([]);

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
  const openTask = (item: Item) => {
    setTask(item);
    present({ sheet: "task" });
  };
  /** Team / Admin sheets: saved plans open the task detail, new ones the editor. */
  const openFromSheet = (item: Editing) =>
    "id" in item ? openTask(item) : present({ edit: item });
  const clearError = () => setError("");

  const today = new Date();
  const openNew = () => setEditing(freshItem());
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
        await client.postItemUpdate(i.id, { status: toggledStatus(i) });
        // The row may move to another group or leave this list.
        await refresh({ animate: true });
      }),
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
  const openFocus = (item: Item) => {
    setFocus(item);
    present({ sheet: "focus" });
  };
  const closeFocus = () => {
    // Return to the detail of the task last in focus.
    if (focus) setTask((t) => (t && t.id === focus.id ? t : focus));
    closeSheet();
  };
  const openPlanner = (seed: Plan | null) => {
    setPlanSeed(seed);
    present({ sheet: "plan" });
  };
  const planChanged = () => void refresh({ animate: true }).catch(() => {});
  const saveEditing = () =>
    act(async () => {
      if (!editing) return;
      if ("id" in editing) {
        // Progress is owned by the checklist and the task sheet; omitting it
        // keeps the saved value (sending it while steps exist is a 409).
        const { progress: _progress, ...body } = itemBody(editing);
        await client.updateItem(editing.id, body);
        const saved = editing;
        setTask((t) => (t && t.id === saved.id ? { ...t, ...saved } : t));
      } else await client.createItem(editing);
      closeEditor();
      await refresh();
    });
  const deleteEditing = () =>
    act(async () => {
      if (!editing || !("id" in editing)) return;
      await client.deleteItem(editing.id, editing.version);
      // Don't return to the detail sheet of the item that was just deleted.
      if (back.current.at(-1) === "task" && task?.id === editing.id)
        back.current.pop();
      closeEditor();
      await refresh();
    });
  const sidePadding = {
    paddingLeft: insets.left + spacing.page,
    paddingRight: insets.right + spacing.page,
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
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, sidePadding]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
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
            <FadeIn key={`body-${tab}`} duration={motion.slow}>
              {tab === "Today" && (
                <TodayScreen
                  items={items}
                  onPlanDay={() => {
                    setTab("AI");
                    void assistant.ask(planDayPrompt);
                  }}
                  onOpenPlanner={openPlanner}
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
                  {...listHandlers}
                />
              )}
              {tab === "Calendar" && (
                <CalendarScreen
                  items={items}
                  act={act}
                  onChanged={planChanged}
                  {...listHandlers}
                />
              )}
              {tab === "AI" && (
                <AssistantScreen
                  assistant={assistant}
                  items={items}
                  busy={busy}
                />
              )}
              {tab === "Inbox" && (
                <InboxScreen
                  notices={notices}
                  busy={busy}
                  onRead={markRead}
                  onReschedule={reschedule}
                />
              )}
              {tab === "Settings" && (
                <SettingsScreen
                  user={user}
                  busy={busy}
                  act={act}
                  onUser={setUser}
                  onSignOut={signOut}
                  teamCount={teams.length}
                  onOpenTeams={() => setSheet("teams")}
                  onOpenAdmin={() => setSheet("admin")}
                  onOpenStatus={() => setSheet("status")}
                  onOpenPlanning={() => setSheet("planning")}
                  onOpenConnections={() => setSheet("connections")}
                  onOpenBooking={() => setSheet("booking")}
                />
              )}
            </FadeIn>
          </View>
        </ScrollView>
        <TabBar
          tab={tab}
          unread={notices.some((n) => !n.read)}
          onChange={(t) => {
            setTab(t);
            setSearch("");
          }}
        />
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
          teams={teams}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onEdit={(item) => present({ edit: { ...item } })}
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
        />
        <PlanSheet
          visible={sheet === "plan"}
          seed={planSeed}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
          onApplied={planChanged}
        />
        <ListsSheet
          visible={sheet === "lists"}
          teams={teams}
          onClose={closeSheet}
          onDismiss={onSheetDismissed}
        />
        <PlanningSheet
          visible={sheet === "planning"}
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

const s = StyleSheet.create({
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
  content: { paddingTop: 22, paddingBottom: 32 },
  column: { width: "100%", maxWidth: spacing.maxContent, alignSelf: "center" },
  subtitle: { marginBottom: 20 },
});
