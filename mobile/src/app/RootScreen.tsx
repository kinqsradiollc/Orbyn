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
} from "@orbyn/core";
import { tabSubtitle, tabTitle, type Tab } from "./tabs";
import { Brand } from "../components/Brand";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { ItemEditor, type Editing } from "../components/ItemEditor";
import { TabBar } from "../components/TabBar";
import { useAssistant } from "../hooks/useAssistant";
import { usePlanner } from "../hooks/usePlanner";
import { client } from "../lib/api";
import { toggledStatus } from "../lib/progress";
import { FadeIn, PressableScale } from "../motion";
import { AdminSheet } from "../screens/AdminSheet";
import { AssistantScreen } from "../screens/AssistantScreen";
import { AuthScreen } from "../screens/AuthScreen";
import { CalendarScreen } from "../screens/CalendarScreen";
import { InboxScreen } from "../screens/InboxScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { StatusSheet } from "../screens/StatusSheet";
import { TaskDetail } from "../screens/TaskDetail";
import { TasksScreen } from "../screens/TasksScreen";
import { TeamsSheet } from "../screens/TeamsSheet";
import { TodayScreen } from "../screens/TodayScreen";
import { colors, spacing } from "../theme";
import { shared } from "../styles";

type SheetName = "teams" | "admin" | "status" | "task";
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
    error,
    setError,
    busy,
    refreshing,
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
                {...listHandlers}
              />
            )}
            {tab === "Tasks" && (
              <TasksScreen
                items={items}
                search={search}
                onSearch={setSearch}
                {...listHandlers}
              />
            )}
            {tab === "Calendar" && (
              <CalendarScreen items={items} {...listHandlers} />
            )}
            {tab === "AI" && (
              <AssistantScreen
                assistant={assistant}
                items={items}
                busy={busy}
              />
            )}
            {tab === "Inbox" && (
              <InboxScreen notices={notices} onRead={markRead} />
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
        onChanged={() => void refresh({ animate: true }).catch(() => {})}
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
        />
      )}
    </View>
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
