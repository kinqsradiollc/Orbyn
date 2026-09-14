import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { colors, fonts } from "../theme";

/** The Orbyn wordmark, matching the desktop `.brand`: orbit icon, "orbyn", green dot. */
export function Brand({ size = 26 }: { size?: number }) {
  return (
    <View
      style={[s.row, { gap: size * 0.28 }]}
      accessible
      accessibilityRole="header"
      accessibilityLabel="Orbyn"
    >
      <Icon name="orbit" size={size} color={colors.accent} strokeWidth={1.6} />
      <Text
        style={[
          s.word,
          {
            fontSize: size,
            lineHeight: size * 1.2,
            letterSpacing: -size * 0.047,
          },
        ]}
      >
        orbyn<Text style={s.dot}>•</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  word: { fontFamily: fonts.brand, color: colors.text },
  dot: { color: colors.dot },
});
