import React from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
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
  editing = null,
  draft = "",
  onDraftChange,
  onCommit,
  onEditBlock,
}: {
  content: DocBlock[];
  onToggleTodo?: (index: number) => void;
  /** Which line is open for editing, if any. */
  editing?: number | null;
  /** The Markdown behind the open line, while it is being typed. */
  draft?: string;
  onDraftChange?: (text: string) => void;
  onCommit?: () => void;
  onEditBlock?: (index: number) => void;
}) {
  /** Wrap a line so tapping it opens it, when the page can be edited. */
  const line = (index: number, node: React.ReactNode) =>
    onEditBlock ? (
      <Pressable
        key={index}
        onPress={() => onEditBlock(index)}
        style={({ pressed }) => [styles.line, pressed && styles.linePressed]}
        accessibilityRole="button"
        accessibilityLabel="Edit this line"
      >
        {node}
      </Pressable>
    ) : (
      <View key={index}>{node}</View>
    );

  return (
    <View style={styles.body}>
      {content.map((block, index) => {
        // The open line shows the Markdown behind it, so the shorthand that
        // made a heading or a checkbox is there to change.
        if (index === editing)
          return (
            <View key={index} style={styles.editing}>
              <TextInput
                style={styles.input}
                value={draft}
                multiline
                autoFocus
                placeholder="Write something…"
                placeholderTextColor={colors.faint}
                onChangeText={onDraftChange}
                onBlur={onCommit}
                accessibilityLabel="Line being edited"
              />
              {/* Putting the line away should not depend on the keyboard
                  going away: on a phone it often does not. */}
              <Pressable
                onPress={onCommit}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.doneBtn,
                  pressed && styles.linePressed,
                ]}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          );
        switch (block.type) {
          case "heading":
            return line(
              index,
              <Text
                style={[
                  styles.heading,
                  block.level === 1 ? styles.h1 : styles.h2,
                ]}
              >
                {mathToText(block.text)}
              </Text>,
            );
          case "bullet":
          case "numbered":
            return line(
              index,
              <View style={styles.row}>
                <Text style={styles.marker}>
                  {block.type === "bullet" ? "•" : "1."}
                </Text>
                <Text style={styles.text}>{mathToText(block.text)}</Text>
              </View>,
            );
          case "todo":
            // The switch stays outside the tappable label: wrapping the whole
            // row would mean a tap meant to tick a line opened it for editing
            // instead.
            return (
              <View key={index} style={[styles.row, styles.line]}>
                <Switch
                  value={block.done}
                  onValueChange={() => onToggleTodo?.(index)}
                  disabled={!onToggleTodo}
                  trackColor={{ true: colors.accent, false: colors.softBorder }}
                  thumbColor={colors.white}
                  style={styles.check}
                  accessibilityLabel={block.text || "Checklist item"}
                />
                {/* The tag sits beside the label, not inside it, so a done
                    line does not strike through the tag as well. */}
                <Pressable
                  style={({ pressed }) => [
                    styles.todoText,
                    pressed && onEditBlock ? styles.linePressed : null,
                  ]}
                  onPress={onEditBlock ? () => onEditBlock(index) : undefined}
                  disabled={!onEditBlock}
                  accessibilityRole={onEditBlock ? "button" : undefined}
                  accessibilityLabel={
                    onEditBlock ? "Edit this line" : undefined
                  }
                >
                  <Text style={[styles.text, block.done && styles.done]}>
                    {mathToText(block.text)}
                  </Text>
                  {block.id ? <Text style={styles.tag}>task</Text> : null}
                </Pressable>
              </View>
            );
          case "quote":
            return line(
              index,
              <View style={styles.quote}>
                <Text style={styles.quoteText}>{mathToText(block.text)}</Text>
              </View>,
            );
          case "code":
            return line(
              index,
              <View style={styles.block}>
                <Text style={styles.code}>{block.text}</Text>
              </View>,
            );
          case "math":
            return line(
              index,
              <View style={styles.block}>
                <Text style={styles.math}>{mathToText(block.text)}</Text>
              </View>,
            );
          case "divider":
            return line(index, <View style={styles.divider} />);
          default:
            return line(
              index,
              <Text style={styles.text}>{mathToText(block.text)}</Text>,
            );
        }
      })}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    body: { gap: 10 },
    /* A line reads as text but is tappable when the page can be edited. */
    line: {
      borderRadius: radii.input,
      marginHorizontal: -6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    linePressed: { backgroundColor: colors.surfaceMuted },
    editing: { gap: 6, alignItems: "flex-start" },
    doneBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
    },
    doneText: {
      color: colors.accent,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
    input: {
      alignSelf: "stretch",
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radii.input,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 44,
    },
    heading: { color: colors.text, fontFamily: fonts.display },
    h1: { fontSize: 20 },
    h2: { fontSize: 16 },
    text: { color: colors.text, fontSize: 15, lineHeight: 22, flex: 1 },
    done: { color: colors.muted, textDecorationLine: "line-through" },
    todoText: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
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
