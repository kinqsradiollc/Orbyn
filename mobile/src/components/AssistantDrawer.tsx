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
import type { AiChatSummary } from "@orbyn/core";
import { Icon, type IconName } from "./Icon";
import { ActionSheet, type MoreAction } from "./MoreMenu";
import { ToastHost } from "./Toast";
import { Pressable, PressableScale, isReducedMotion } from "../motion";
import {
  colors,
  controls,
  fonts,
  radii,
  spacing,
  themed,
  tint,
} from "../theme";
import { shared } from "../styles";

/**
 * The assistant's side menu: shortcuts, then pinned and recent chats, with
 * New chat at the bottom. It slides in from the left over the screen; a tap
 * on the dimmed side, a swipe to the left or Back closes it. `afterClose`
 * runs once it has gone, for a sheet that opens next (iOS shows one at a
 * time).
 */
export function AssistantDrawer({
  visible,
  onClose,
  afterClose,
  agentName,
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
    const duration = isReducedMotion() ? 0 : 220;
    if (visible) {
      setMounted(true);
      offset.setValue(-panel);
      Animated.timing(offset, {
        toValue: 0,
        duration,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(offset, {
        toValue: -panel,
        duration: isReducedMotion() ? 0 : 180,
        useNativeDriver: true,
      }).start(() => {
        setMounted(false);
        setSearching(false);
        if (Platform.OS !== "ios") after.current?.();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
            Animated.spring(offset, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(offset, {
            toValue: 0,
            useNativeDriver: true,
          }).start(),
      }),
    [offset],
  );

  const pinned = chats?.filter((c) => c.pinned) ?? [];
  const recents = chats?.filter((c) => !c.pinned) ?? [];
  const backdrop = offset.interpolate({
    inputRange: [-panel, 0],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const row = (chat: AiChatSummary, icon: boolean) => (
    <Pressable
      key={chat.id}
      accessibilityRole="button"
      accessibilityLabel={`Open the chat “${chat.title}”`}
      accessibilityHint="Hold for more options"
      disabled={locked}
      delayLongPress={350}
      onPress={() => onOpenChat(chat)}
      onLongPress={() => setMenuFor(chat)}
      style={({ pressed }) => [
        s.chat,
        chat.id === activeChatId && s.chatActive,
        pressed && { backgroundColor: colors.surfaceMuted },
        locked && { opacity: 0.5 },
      ]}
    >
      {icon && <Icon name="comment" size={18} color={colors.textSoft} />}
      <Text style={s.chatTitle} numberOfLines={1}>
        {chat.title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Options for ${chat.title}`}
        disabled={locked}
        hitSlop={6}
        onPress={() => setMenuFor(chat)}
        style={({ pressed }) => [
          s.more,
          pressed && { backgroundColor: colors.border },
        ]}
      >
        <Icon name="more" size={18} color={colors.muted} />
      </Pressable>
    </Pressable>
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
            <Text style={s.name} numberOfLines={1} accessibilityRole="header">
              {agentName}
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
                  Recents
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
            <PressableScale
              accessibilityRole="button"
              disabled={locked}
              onPress={onNewChat}
              style={({ pressed }) => [
                s.newChat,
                pressed && { backgroundColor: colors.accentPressed },
                locked && { opacity: 0.5 },
              ]}
            >
              <Icon name="squarePen" size={18} color={colors.white} />
              <Text style={s.newChatText}>New chat</Text>
            </PressableScale>
            {onSettings && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${agentName} settings`}
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
          visible={!!menuFor}
          label={menuFor ? `Options for ${menuFor.title}` : "Chat options"}
          title={menuFor?.title}
          actions={menuFor ? chatActions(menuFor) : []}
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
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    more: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
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
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      paddingHorizontal: spacing.page,
      paddingTop: 10,
    },
    newChat: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: controls.tap,
      paddingHorizontal: 18,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    newChatText: {
      fontFamily: fonts.bold,
      fontSize: 15,
      color: colors.white,
    },
  }),
);
