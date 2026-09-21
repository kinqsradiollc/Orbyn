import React from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { blockText, mathToText, type DocBlock } from "@orbyn/core";
import { Inline } from "./Inline";
import type { Mark } from "./marks";
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
  onBlurLine,
  selection,
  counts,
  marks = {},
  renderUnder,
  onOpenComments,
  onEditBlock,
}: {
  content: DocBlock[];
  /** Stretches of each line carrying a remark, to tint the words they name. */
  marks?: Record<string, Mark[]>;
  onToggleTodo?: (index: number) => void;
  /** Which line is open for editing, if any. */
  editing?: number | null;
  /** The Markdown behind the open line, while it is being typed. */
  draft?: string;
  onDraftChange?: (text: string) => void;
  onCommit?: () => void;
  /**
   * The field lost focus. On a phone that happens whenever the keyboard is
   * put away, and on the web the moment another control is tapped, so it
   * must not close or remove the line — only keep the words safe.
   */
  onBlurLine?: () => void;
  /**
   * Where the caret should sit, set once when a line opens. Without it the
   * web build leaves the caret at the start after the value is replaced, so
   * typing after Return lands before the "- " the new list item begins with.
   */
  selection?: { start: number; end: number };
  /** How many open remarks each named line carries. */
  counts?: Record<string, number>;
  /** What to show under a line — its remarks, when they are open. */
  renderUnder?: (blockId: string) => React.ReactNode;
  onOpenComments?: (blockId: string) => void;
  onEditBlock?: (index: number) => void;
}) {
  /**
   * Wrap a line so tapping it opens it, and hang its remarks underneath —
   * a phone has no margin, so under the line is as beside it as it gets.
   */
  /**
   * Mark a line that carries remarks and hang them underneath — a phone has
   * no margin, so under the line is as beside it as it gets. Kept apart from
   * the tap-to-edit wrapper below, because a checklist line builds its own
   * row (its switch must stay outside the tappable label) and still needs
   * its remarks shown.
   */
  const decorate = (index: number, body: React.ReactNode) => {
    const id = content[index].id;
    const count = (id && counts?.[id]) || 0;
    const under = id ? renderUnder?.(id) : null;
    if (!count && !under) return <View key={index}>{body}</View>;
    return (
      <View key={index} style={styles.commented}>
        <View style={styles.commentedRow}>
          <View style={styles.commentedBody}>{body}</View>
          {count > 0 && (
            <Pressable
              onPress={() => id && onOpenComments?.(id)}
              // The way into a line's remarks. A 24pt pill is the right size
              // beside a line of text and the wrong size for a thumb, so the
              // target grows without the pill doing the same.
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`${count} comment${count === 1 ? "" : "s"} on this line`}
              style={({ pressed }) => [
                styles.badge,
                pressed && styles.linePressed,
              ]}
            >
              <Text style={styles.badgeText}>{count}</Text>
            </Pressable>
          )}
        </View>
        {under}
      </View>
    );
  };

  /** Wrap a line so tapping it opens it, when the page can be edited. */
  const line = (index: number, node: React.ReactNode) =>
    decorate(
      index,
      onEditBlock ? (
        <Pressable
          onPress={() => onEditBlock(index)}
          style={({ pressed }) => [
            styles.line,
            // An empty line draws nothing, so it came out 4pt tall and no
            // thumb could find it: a new note was a blank wall with a
            // "+ Add a block" under it, though it already had a line to
            // write on. Only empty lines get the room; the rest keep their
            // rhythm.
            !blockText(content[index]).trim() && styles.emptyLine,
            pressed && styles.linePressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Edit this line"
        >
          {node}
        </Pressable>
      ) : (
        node
      ),
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
                onBlur={onBlurLine}
                selection={selection}
                accessibilityLabel="Line being edited"
              />
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
                <Inline text={block.text} marks={marks[block.id ?? ""]} />
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
                <Text style={styles.text}>
                  <Inline text={block.text} marks={marks[block.id ?? ""]} />
                </Text>
              </View>,
            );
          case "todo":
            // The switch stays outside the tappable label: wrapping the whole
            // row would mean a tap meant to tick a line opened it for editing
            // instead.
            return decorate(
              index,
              <View style={[styles.row, styles.line]}>
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
                    <Inline text={block.text} marks={marks[block.id ?? ""]} />
                  </Text>
                  {block.id ? <Text style={styles.tag}>task</Text> : null}
                </Pressable>
              </View>,
            );
          case "quote":
            return line(
              index,
              <View style={styles.quote}>
                <Text style={styles.quoteText}>
                  <Inline text={block.text} marks={marks[block.id ?? ""]} />
                </Text>
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
              <Text style={styles.text}>
                <Inline text={block.text} marks={marks[block.id ?? ""]} />
              </Text>,
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
    emptyLine: { minHeight: 44, justifyContent: "center" },
    linePressed: { backgroundColor: colors.surfaceMuted },
    /* A line with remarks is marked the way a highlighter would mark it. */
    commented: {
      gap: 8,
      marginHorizontal: -8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radii.input,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
      backgroundColor: colors.warningSoft,
    },
    commentedRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    commentedBody: { flex: 1, minWidth: 0 },
    badge: {
      minWidth: 24,
      height: 24,
      paddingHorizontal: 6,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    badgeText: {
      color: colors.accent,
      fontSize: 12,
      fontFamily: fonts.semibold,
    },
    editing: { gap: 6, alignItems: "flex-start" },
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
