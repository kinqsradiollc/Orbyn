import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { freshItem, itemBody, type Item, type Notice } from "@orbyn/core";
import { tabSubtitle, tabTitle, type Tab } from "./tabs";
import { Brand } from "../components/Brand";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { ItemEditor, type Editing } from "../components/ItemEditor";
import { TabBar } from "../components/TabBar";
import { useAssistant } from "../hooks/useAssistant";
import { usePlanner } from "../hooks/usePlanner";
import { client } from "../lib/api";
import { AssistantScreen } from "../screens/AssistantScreen";
import { AuthScreen } from "../screens/AuthScreen";
import { CalendarScreen } from "../screens/CalendarScreen";
import { InboxScreen } from "../screens/InboxScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { TasksScreen } from "../screens/TasksScreen";
import { TodayScreen } from "../screens/TodayScreen";
import { colors, spacing } from "../theme";
import { shared } from "../styles";

/** Auth gate, tab switching and the shared item editor modal. */
export function RootScreen() {
  const planner = usePlanner();
  const {
    token,
    ready,
    user,
    setUser,
    items,
    notices,
    error,
    setError,
    busy,
    refreshing,
    act,
    refresh,
    signIn,
    signOut,
  } = planner;
  const assistant = useAssistant({ token, act, refresh });
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("Today");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

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

  const today = new Date();
  const openNew = () => setEditing(freshItem());
  const listHandlers = {
    busy,
    onAdd: openNew,
    onEdit: (i: Item) => setEditing({ ...i }),
    onToggle: (i: Item) =>
      act(async () => {
        await client.updateItem(i.id, {
          ...itemBody(i),
          status: i.status === "done" ? "todo" : "done",
        });
        await refresh();
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
      setEditing(null);
      await refresh();
    });
  const deleteEditing = () =>
    act(async () => {
      if (!editing || !("id" in editing)) return;
      await client.deleteItem(editing.id, editing.version);
      setEditing(null);
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
          <Pressable
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
          </Pressable>
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
            onRefresh={() => act(refresh)}
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
          <Text style={shared.title}>{tabTitle(tab, user)}</Text>
          <Text style={[shared.subtitle, s.subtitle]}>{tabSubtitle(tab)}</Text>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {tab === "Today" && (
            <TodayScreen
              items={items}
              onPlanDay={() => {
                setTab("AI");
                void assistant.ask(
                  "Summarize my day and suggest what needs attention.",
                );
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
            <AssistantScreen assistant={assistant} items={items} busy={busy} />
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
            />
          )}
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
        busy={busy}
        error={error}
        onChange={setEditing}
        onSave={saveEditing}
        onDelete={deleteEditing}
        onClose={() => setEditing(null)}
      />
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
