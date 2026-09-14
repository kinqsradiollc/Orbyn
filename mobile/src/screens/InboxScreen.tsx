import React from "react";
import { Pressable, Text, View } from "react-native";
import { dateLabel, type Notice } from "@orbyn/core";
import { colors } from "../theme";
import { shared } from "../styles";

export function InboxScreen({
  notices,
  onRead,
}: {
  notices: Notice[];
  onRead: (notice: Notice) => void;
}) {
  return (
    <>
      {notices.map((n) => (
        <Pressable
          key={n.id}
          style={[shared.card, !n.read && { backgroundColor: colors.unread }]}
          onPress={() => onRead(n)}
        >
          <Text style={shared.itemTitle}>{n.title}</Text>
          <Text style={shared.body}>{n.body}</Text>
          <Text style={shared.small}>
            {dateLabel(n.created_at)}
            {n.read ? " · Read" : " · Tap to mark read"}
          </Text>
        </Pressable>
      ))}
      {!notices.length && (
        <View style={shared.empty}>
          <Text style={shared.sectionTitle}>You’re all caught up.</Text>
          <Text style={shared.subtitle}>
            Reminders will land here when it’s time.
          </Text>
        </View>
      )}
    </>
  );
}
