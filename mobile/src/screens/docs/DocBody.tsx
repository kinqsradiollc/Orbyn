import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { mathToText, type DocBlock } from "@orbyn/core";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * A document as it reads on a phone. Formulas are shown as their symbols —
 * "0 < η < 1/μ" rather than the LaTeX behind them — because the phone has no
 * typesetting engine; the source is kept untouched and the desktop app
 * renders it properly.
 */
export function DocBody({
  content,
  onToggleTodo,
}: {
  content: DocBlock[];
  onToggleTodo?: (index: number) => void;
}) {
  return (
    <View style={styles.body}>
      {content.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <Text
                key={index}
                style={[
                  styles.heading,
                  block.level === 1 ? styles.h1 : styles.h2,
                ]}
              >
                {mathToText(block.text)}
              </Text>
            );
          case "bullet":
          case "numbered":
            return (
              <View key={index} style={styles.row}>
                <Text style={styles.marker}>
                  {block.type === "bullet" ? "•" : "1."}
                </Text>
                <Text style={styles.text}>{mathToText(block.text)}</Text>
              </View>
            );
          case "todo":
            return (
              <View key={index} style={styles.row}>
                <Switch
                  value={block.done}
                  onValueChange={() => onToggleTodo?.(index)}
                  disabled={!onToggleTodo}
                  trackColor={{ true: colors.accent, false: colors.softBorder }}
                  thumbColor={colors.white}
                  style={styles.check}
                  accessibilityLabel={block.text || "Checklist item"}
                />
                <Text style={[styles.text, block.done && styles.done]}>
                  {mathToText(block.text)}
                  {block.id ? <Text style={styles.tag}> task</Text> : null}
                </Text>
              </View>
            );
          case "quote":
            return (
              <View key={index} style={styles.quote}>
                <Text style={styles.quoteText}>{mathToText(block.text)}</Text>
              </View>
            );
          case "code":
            return (
              <View key={index} style={styles.block}>
                <Text style={styles.code}>{block.text}</Text>
              </View>
            );
          case "math":
            return (
              <View key={index} style={styles.block}>
                <Text style={styles.math}>{mathToText(block.text)}</Text>
              </View>
            );
          case "divider":
            return <View key={index} style={styles.divider} />;
          default:
            return (
              <Text key={index} style={styles.text}>
                {mathToText(block.text)}
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    body: { gap: 10 },
    heading: { color: colors.text, fontFamily: fonts.display },
    h1: { fontSize: 20 },
    h2: { fontSize: 16 },
    text: { color: colors.text, fontSize: 15, lineHeight: 22, flex: 1 },
    done: { color: colors.muted, textDecorationLine: "line-through" },
    tag: { color: colors.muted, fontSize: 12, fontFamily: fonts.semibold },
    row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    marker: { color: colors.muted, fontSize: 15, lineHeight: 22, width: 16 },
    check: { transform: [{ scale: 0.8 }], marginTop: -2 },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: colors.softBorder,
      paddingLeft: 10,
    },
    quoteText: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    block: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 12,
    },
    code: { color: colors.text, fontSize: 13, fontFamily: "monospace" },
    math: { color: colors.text, fontSize: 16, textAlign: "center" },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  }),
);
