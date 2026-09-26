import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { colors, fonts, themed } from "../theme";

type Action = { label: string; onPress: () => void; disabled?: boolean };

/**
 * The one calm empty state, as on the web: a small muted icon, a short
 * title, one sentence, and at most two buttons that do the obvious thing
 * (the first is the primary one). No paragraphs of explanation.
 */
export function EmptyState({
  icon,
  title,
  body,
  actions = [],
}: {
  icon: IconName;
  title: string;
  body: string;
  actions?: [] | [Action] | [Action, Action];
}) {
  return (
    <View style={s.wrap}>
      <Icon name={icon} size={24} color={colors.faint} />
      <Text style={s.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={s.body}>{body}</Text>
      {actions.length > 0 && (
        <View style={s.actions}>
          {actions.map((a, n) => (
            <Button
              key={a.label}
              title={a.label}
              secondary={n > 0}
              disabled={a.disabled}
              onPress={a.onPress}
              style={s.action}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: {
      alignItems: "center",
      gap: 6,
      paddingVertical: 28,
      paddingHorizontal: 16,
    },
    title: {
      marginTop: 4,
      fontFamily: fonts.bold,
      fontSize: 15,
      color: colors.text,
      textAlign: "center",
    },
    body: {
      maxWidth: 320,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
      textAlign: "center",
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 8,
      marginTop: 10,
    },
    action: { marginBottom: 0 },
  }),
);
