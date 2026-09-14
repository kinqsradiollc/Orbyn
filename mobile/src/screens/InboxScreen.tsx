import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dateLabel, type Notice } from "@orbyn/core";
import { Icon } from "../components/Icon";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

export function InboxScreen({
  notices,
  onRead,
}: {
  notices: Notice[];
  onRead: (notice: Notice) => void;
}) {
  if (!notices.length)
    return (
      <View style={[shared.card, shared.empty]}>
        <View style={shared.emptyIcon}>
          <Icon name="bell" size={24} color={colors.accent} />
        </View>
        <Text style={shared.sectionTitle}>You’re all caught up.</Text>
        <Text style={[shared.subtitle, { textAlign: "center" }]}>
          Deadline reminders will appear here.
        </Text>
      </View>
    );
  return (
    <View style={s.list}>
      {notices.map((n, i) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          accessibilityLabel={n.title + (n.read ? "" : ", unread")}
          accessibilityHint={n.read ? undefined : "Marks this reminder as read"}
          onPress={() => onRead(n)}
          style={({ pressed }) => [
            s.row,
            i > 0 && s.divider,
            !n.read && s.unread,
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={s.icon}>
            <Icon name="bell" size={16} color={colors.accent} />
            {!n.read && <View style={s.dot} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, n.read && { color: colors.textSoft }]}>
              {n.title}
            </Text>
            <Text style={s.body}>{n.body}</Text>
            <Text style={shared.small}>
              {dateLabel(n.created_at)}
              {n.read ? " · Read" : " · Tap to mark read"}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  list: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: "hidden",
  },
  row: { flexDirection: "row", gap: 12, padding: 16 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  unread: { backgroundColor: "#f6f9f4" },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.highText,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 3,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSoft,
    marginBottom: 6,
  },
});
