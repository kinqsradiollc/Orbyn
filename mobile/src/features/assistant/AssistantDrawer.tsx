import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { groupAssistantChats, type AiChatSummary } from "@orbyn/core";
import { Icon, type IconName } from "../../components/Icon";
import { ActionSheet, type MoreAction } from "../../components/MoreMenu";
import { ToastHost } from "../../components/Toast";
import { Pressable, isReducedMotion } from "../../motion";
import {
  colors,
  controls,
  fonts,
  radii,
  spacing,
  themed,
  tint,
} from "../../theme";
import { shared } from "../../styles";

/**
 * The assistant's side menu: shortcuts, then pinned and recent chats, with
 * New chat above the history. It slides in from the left over the screen; a tap
 * on the dimmed side, a swipe to the left or Back closes it. `afterClose`
 * runs once it has gone, for a sheet that opens next (iOS shows one at a
 * time).
 */
export function AssistantDrawer({
  visible,
  onClose,
  afterClose,
  agentName,
  primaryConversation,
  chats,
  activeChatId,
  search,
  onSearch,
  locked,
  chatActions,
  onOpenChat,
  onNewChat,
  shortcuts,
  onSettings,
}: {
  visible: boolean;
  onClose: () => void;
  afterClose?: () => void;
  agentName: string;
  primaryConversation?: { id: string | null; onOpen: () => void };
  /** null while loading. */
  chats: AiChatSummary[] | null;
  activeChatId: string | null;
  search: string;
  onSearch: (text: string) => void;
  locked: boolean;
  chatActions: (chat: AiChatSummary) => MoreAction[];
  onOpenChat: (chat: AiChatSummary) => void;
  onNewChat: () => void;
  shortcuts: { icon: IconName; label: string; onPress: () => void }[];
  onSettings?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panel = Math.min(Math.round(width * 0.85), 360);
  const offset = useRef(new Animated.Value(-panel)).current;
  const [mounted, setMounted] = useState(visible);
  const [searching, setSearching] = useState(false);
  const [menuFor, setMenuFor] = useState<AiChatSummary | null>(null);
  const after = useRef(afterClose);
  after.current = afterClose;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const duration = Platform.OS === "web" || isReducedMotion() ? 0 : 160;
    let animation: Animated.CompositeAnimation | undefined;
    if (visible) {
      setMounted(true);
      offset.setValue(-panel);
      animation = Animated.timing(offset, {
        toValue: 0,
        duration,
        useNativeDriver: true,
      });
      animation.start();
    } else if (mounted) {
      animation = Animated.timing(offset, {
        toValue: -panel,
        duration,
        useNativeDriver: true,
      });
      animation.start(({ finished }) => {
        if (!finished) return;
        setMounted(false);
        setSearching(false);
        if (Platform.OS !== "ios") after.current?.();
      });
    }
    return () => animation?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, panel, offset]);
  useEffect(() => {
    if (!visible || locked) setMenuFor(null);
  }, [visible, locked]);

  // Swiping the panel to the left closes it, as a drawer does.
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_e, g) => offset.setValue(Math.min(0, g.dx)),
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -80 || g.vx < -0.6) close.current();
          else
            Animated.timing(offset, {
              toValue: 0,
              duration: Platform.OS === "web" || isReducedMotion() ? 0 : 120,
              useNativeDriver: true,
            }).start();
        },
        onPanResponderTerminate: () =>
          Animated.timing(offset, {
            toValue: 0,
            duration: Platform.OS === "web" || isReducedMotion() ? 0 : 120,
            useNativeDriver: true,
          }).start(),
      }),
    [offset],
  );

  const {
    projects,
    pinned,
    recent: recents,
  } = groupAssistantChats(chats ?? [], primaryConversation?.id ?? null);
  const menuChat = chats?.find((chat) => chat.id === menuFor?.id) ?? null;
  const backdrop = offset.interpolate({
    inputRange: [-panel, 0],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const row = (chat: AiChatSummary, icon: boolean) => (
    <View
      key={chat.id}
      style={[s.chat, chat.id === activeChatId && s.chatActive]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the chat “${chat.title}”`}
        accessibilityState={{
          selected: chat.id === activeChatId,
          disabled: locked,
        }}
        accessibilityHint="Hold for more options"
        disabled={locked}
        delayLongPress={350}
        onPress={() => onOpenChat(chat)}
        onLongPress={() => setMenuFor(chat)}
        style={({ pressed }) => [
          s.chatOpen,
          pressed && { backgroundColor: colors.surfaceMuted },
          locked && { opacity: 0.5 },
        ]}
      >
        {icon && <Icon name="comment" size={18} color={colors.textSoft} />}
        <View style={s.chatMain}>
          <Text style={s.chatTitle}>{chat.title}</Text>
          {chat.active && (
            <Text style={s.activeJob} accessibilityRole="text">
              {chat.active === "needs_you" ? "Needs you" : "Working"}
            </Text>
          )}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Options for ${chat.title}`}
        disabled={locked}
        onPress={() => setMenuFor(chat)}
        style={({ pressed }) => [
          s.more,
          pressed && { backgroundColor: colors.border },
        ]}
      >
        <Icon name="more" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={Platform.OS === "ios" ? () => after.current?.() : undefined}
    >
      <View style={s.fill}>
        <Animated.View style={[s.backdrop, { opacity: backdrop }]}>
          <Pressable
            quiet
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          {...swipe.panHandlers}
          style={[
            s.panel,
            {
              width: panel,
              paddingTop: insets.top + 12,
              paddingBottom: Math.max(insets.bottom, 12),
              transform: [{ translateX: offset }],
            },
          ]}
          accessibilityViewIsModal
          accessibilityLabel="Chats and more"
        >
          <View style={s.head}>
            <Text style={s.name} accessibilityRole="header">
              {primaryConversation ? "Chats" : agentName}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={searching ? "Close search" : "Search chats"}
              onPress={() => {
                if (searching) onSearch("");
                setSearching((on) => !on);
              }}
              style={({ pressed }) => [
                s.round,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Icon
                name={searching ? "x" : "search"}
                size={19}
                color={colors.textSoft}
              />
            </Pressable>
          </View>
          <View style={s.start}>
            <Pressable
              accessibilityRole="button"
              disabled={locked}
              onPress={primaryConversation?.onOpen ?? onNewChat}
              accessibilityLabel={
                primaryConversation ? `Open ${agentName}` : "New chat"
              }
              accessibilityState={{
                selected:
                  !!primaryConversation?.id &&
                  primaryConversation.id === activeChatId,
                disabled: locked,
              }}
              style={({ pressed }) => [
                s.newChat,
                primaryConversation &&
                  primaryConversation.id !== activeChatId && {
                    backgroundColor: "transparent",
                  },
                pressed && { backgroundColor: colors.border },
                locked && { opacity: 0.5 },
              ]}
            >
              <Icon
                name={primaryConversation ? "sparkles" : "squarePen"}
                size={18}
                color={colors.text}
              />
              <Text style={s.newChatText}>
                {primaryConversation ? agentName : "New chat"}
              </Text>
            </Pressable>
          </View>
          {searching && (
            <TextInput
              autoFocus
              style={[shared.input, s.search]}
              value={search}
              onChangeText={onSearch}
              placeholder="Search chats"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Search chats"
              returnKeyType="search"
            />
          )}
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.list}
            keyboardShouldPersistTaps="handled"
          >
            {!searching &&
              shortcuts.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  disabled={locked}
                  onPress={item.onPress}
                  style={({ pressed }) => [
                    s.shortcut,
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <Icon name={item.icon} size={20} color={colors.textSoft} />
                  <Text style={s.shortcutText}>{item.label}</Text>
                </Pressable>
              ))}
            {projects.length > 0 && (
              <>
                <Text style={s.section} accessibilityRole="header">
                  Projects
                </Text>
                {projects.map((project) => (
                  <View key={project.id}>
                    <Text style={s.section} accessibilityRole="header">
                      {project.name}
                    </Text>
                    {project.chats.map((chat) => row(chat, false))}
                  </View>
                ))}
              </>
            )}
            {pinned.length > 0 && (
              <>
                <Text style={s.section} accessibilityRole="header">
                  Pinned
                </Text>
                {pinned.map((chat) => row(chat, true))}
              </>
            )}
            {recents.length > 0 && (
              <>
                <Text style={s.section} accessibilityRole="header">
                  Recent
                </Text>
                {recents.map((chat) => row(chat, false))}
              </>
            )}
            {chats === null && <Text style={s.empty}>Loading chats…</Text>}
            {chats?.length === 0 && (
              <Text style={s.empty}>
                {search.trim() ? "No chats match" : "No chats yet"}
              </Text>
            )}
          </ScrollView>
          <View style={s.foot}>
            {primaryConversation && (
              <Pressable
                accessibilityRole="button"
                disabled={locked}
                onPress={onNewChat}
                style={({ pressed }) => [
                  s.newChat,
                  pressed && { backgroundColor: colors.border },
                  locked && { opacity: 0.5 },
                ]}
              >
                <Icon name="squarePen" size={18} color={colors.text} />
                <Text style={s.newChatText}>New chat</Text>
              </Pressable>
            )}
            {onSettings && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                onPress={onSettings}
                style={({ pressed }) => [
                  s.round,
                  s.roundOutlined,
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Icon name="settings" size={19} color={colors.textSoft} />
              </Pressable>
            )}
          </View>
        </Animated.View>
        <ActionSheet
          visible={!!menuChat && !locked}
          label={menuFor ? `Options for ${menuFor.title}` : "Chat options"}
          title={menuFor?.title}
          actions={menuChat ? chatActions(menuChat) : []}
          onClose={() => setMenuFor(null)}
        />
        <ToastHost />
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    fill: { flex: 1 },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: tint(colors.shadow, 0.35),
    },
    panel: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.background,
      borderTopRightRadius: radii.card,
      borderBottomRightRadius: radii.card,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: spacing.page + 4,
      paddingRight: spacing.page - 4,
      minHeight: controls.tap,
    },
    name: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.bold,
      fontSize: 18,
      color: colors.text,
    },
    round: {
      width: controls.tap,
      height: controls.tap,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    roundOutlined: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    search: { marginHorizontal: spacing.page, marginTop: 8 },
    scroll: { flex: 1 },
    list: { paddingHorizontal: spacing.page - 6, paddingTop: 8, gap: 2 },
    shortcut: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: controls.tap,
      paddingHorizontal: 10,
      borderRadius: radii.input,
    },
    shortcutText: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    section: {
      marginTop: 18,
      marginBottom: 4,
      paddingHorizontal: 10,
      fontFamily: fonts.bold,
      fontSize: 13,
      color: colors.muted,
    },
    chat: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: controls.tap,
      paddingLeft: 10,
      paddingRight: 2,
      borderRadius: radii.input,
    },
    chatActive: { backgroundColor: colors.surfaceMuted },
    chatTitle: {
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    more: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    activeJob: {
      alignSelf: "flex-start",
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.textSoft,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    empty: {
      marginTop: 18,
      paddingHorizontal: 10,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
    },
    foot: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      paddingHorizontal: spacing.page,
      paddingTop: 10,
    },
    start: { paddingHorizontal: spacing.page, paddingVertical: 8 },
    newChat: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: controls.tap,
      paddingHorizontal: 18,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
    },
    newChatText: {
      fontFamily: fonts.bold,
      fontSize: 15,
      color: colors.text,
    },
    chatOpen: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
    },
    chatMain: { flex: 1, minWidth: 0, gap: 3 },
  }),
);
