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
import { FadeIn, PressableScale } from "../motion";
import { AdminSheet } from "../screens/AdminSheet";
import { AssistantScreen } from "../screens/AssistantScreen";
import { AuthScreen } from "../screens/AuthScreen";
import { CalendarScreen } from "../screens/CalendarScreen";
import { InboxScreen } from "../screens/InboxScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { TasksScreen } from "../screens/TasksScreen";
import { TeamsSheet } from "../screens/TeamsSheet";
import { TodayScreen } from "../screens/TodayScreen";
import { colors, spacing } from "../theme";
import { shared } from "../styles";

type SheetName = "teams" | "admin";

/**
 * Auth gate, tab switching, the shared item editor modal and the Teams /
 * Admin sheets.
 *
 * Opening a team plan from a sheet never stacks two modals: the sheet closes,
 * and on iOS the editor presents from the sheet's `onDismiss` (presenting
 * while another sheet is still animating away is dropped by UIKit). When the
 * editor goes away the sheet reopens where it was (its navigation state lives
 * outside the Modal, so it survives being hidden).
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
  /** Item waiting for the sheet's dismiss animation before the editor opens (iOS). */
  const pendingEdit = useRef<Editing | null>(null);
  /** Sheet to reopen once the editor closes. */
  const returnTo = useRef<SheetName | null>(null);

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

  const openFromSheet = (item: Editing) => {
    returnTo.current = sheet;
    setSheet(null);
    if (Platform.OS === "ios") pendingEdit.current = item;
    else setEditing(item);
  };
  const onSheetDismissed = () => {
    const item = pendingEdit.current;
    pendingEdit.current = null;
    if (item) setEditing(item);
  };
  const reopenSheet = () => {
    const back = returnTo.current;
    returnTo.current = null;
    if (back) setSheet(back);
  };
  /** Close the editor; on Android there is no onDismiss, so return to the sheet now. */
  const closeEditor = () => {
    setEditing(null);
    if (Platform.OS !== "ios") reopenSheet();
  };
  const clearError = () => setError("");

  const today = new Date();
  const openNew = () => setEditing(freshItem());
  const listHandlers = {
    busy,
    onAdd: openNew,
    onEdit: (i: Item) => setEditing({ ...i }),
    canToggle: (i: Item) => {
      const team = i.team_id && teams.find((t) => t.id === i.team_id);
      return !team || hasTeamPermission(team.role, "items:write");
    },
    onToggle: (i: Item) =>
      act(async () => {
        await client.updateItem(i.id, {
          ...itemBody(i),
          status: i.status === "done" ? "todo" : "done",
        });
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
      if ("id" in editing)
        await client.updateItem(editing.id, itemBody(editing));
      else await client.createItem(editing);
      closeEditor();
      await refresh();
    });
  const deleteEditing = () =>
    act(async () => {
      if (!editing || !("id" in editing)) return;
      await client.deleteItem(editing.id, editing.version);
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
        onDismissed={reopenSheet}
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
        onClose={() => setSheet(null)}
        onDismiss={onSheetDismissed}
        onOpenItem={openFromSheet}
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
          onClose={() => setSheet(null)}
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
