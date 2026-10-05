import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../motion";
import {
  blockText,
  canFold,
  EMBED_LANG,
  foldedLines,
  footnoteNumbers,
  isDiagram,
  LIVE_LIST_LANG,
  lineDirection,
  listLayout,
  type DocBlock,
} from "@orbyn/core";
import { Inline } from "./Inline";
import { MathView } from "./MathView";
import {
  CalloutView,
  CodeView,
  DiagramView,
  EmbedBlock,
  FileCard,
  FootnoteLine,
  ImageBlock,
  TableView,
} from "./RichBlocks";
import { LiveList } from "../views/LiveList";
import { Icon } from "../../components/Icon";
import type { Mark } from "./marks";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * A document as it reads on a phone. Formulas are typeset on the phone
 * itself (EDT-12, MathView), from the same LaTeX the desktop draws.
 */
export function DocBody({
  content,
  pageContent,
  pageIndex,
  tasks,
  onToggleTodo,
  editing = null,
  draft = "",
  onDraftChange,
  onCommit,
  onBlurLine,
  selection,
  onSelectionChange,
  inputRef,
  counts,
  marks = {},
  renderUnder,
  underEditing,
  onOpenComments,
  onEditBlock,
  onDoubleTapBlock,
  targetBlockId,
  onTargetLayout,
  onLineLayout,
  folds,
  onToggleFold,
  flash = null,
  onReplace,
  onEditTable,
}: {
  content: DocBlock[];
  /** Full structured page context when this body renders one owned child. */
  pageContent?: DocBlock[];
  pageIndex?: number;
  /** The checklist lines tied to a task, by id; only these say "task". */
  tasks?: ReadonlySet<string>;
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
  /** Where the caret or selection is in the open line, as it moves. */
  onSelectionChange?: (range: { start: number; end: number }) => void;
  /** The open line's field, so the keyboard toolbar can hand focus back. */
  inputRef?: React.Ref<TextInput>;
  /** How many open remarks each named line carries. */
  counts?: Record<string, number>;
  /** What to show under a line — its remarks, when they are open. */
  renderUnder?: (blockId: string) => React.ReactNode;
  /**
   * Shown right under the line being edited (MOB-13): the link and "/"
   * suggestions, where the eye already is rather than over the keyboard.
   */
  underEditing?: React.ReactNode;
  onOpenComments?: (blockId: string) => void;
  onEditBlock?: (index: number) => void;
  /**
   * Reading (EDT-10): a double tap on a line starts editing it there. A
   * single tap stays a reader's (links, ticks, scrolling).
   */
  onDoubleTapBlock?: (index: number) => void;
  /** A line opened from a task or citation. */
  targetBlockId?: string | null;
  onTargetLayout?: (y: number) => void;
  /** Where each line sits in the body, for jumping to a heading. */
  onLineLayout?: (index: number, y: number) => void;
  /** Headings folded away (EDT-14), and how to fold or unfold one. */
  folds?: ReadonlySet<string>;
  onToggleFold?: (blockId: string) => void;
  /** A line just jumped to, lit for a moment (LNK-04). */
  flash?: string | null;
  /** Put another line in this one's place (a picture's size or caption). */
  onReplace?: (index: number, block: DocBlock) => void;
  /** Open a table's cells to edit. */
  onEditTable?: (index: number) => void;
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
    const targetLayout =
      id === targetBlockId || onLineLayout
        ? (event: { nativeEvent: { layout: { y: number } } }) => {
            const y = event.nativeEvent.layout.y;
            onLineLayout?.(index, y);
            if (id === targetBlockId) onTargetLayout?.(y);
          }
        : undefined;
    const count = (id && counts?.[id]) || 0;
    const under = id ? renderUnder?.(id) : null;
    const lit = !!id && id === flash;
    if (!count && !under)
      return (
        <View
          key={index}
          onLayout={targetLayout}
          style={lit ? styles.flash : undefined}
        >
          {body}
        </View>
      );
    return (
      <View key={index} style={styles.commented} onLayout={targetLayout}>
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

  /** The last tap on a line while reading, to tell a double tap. */
  const lastTap = React.useRef<{ index: number; at: number } | null>(null);
  const readerTap = (index: number) => {
    const now = Date.now();
    const was = lastTap.current;
    if (was && was.index === index && now - was.at < 320) {
      lastTap.current = null;
      onDoubleTapBlock?.(index);
    } else lastTap.current = { index, at: now };
  };
  /** A line being read: a double tap edits it (EDT-10). */
  const readable = (index: number, node: React.ReactNode) =>
    onDoubleTapBlock ? (
      <Pressable
        quiet
        onPress={() => readerTap(index)}
        accessibilityActions={[{ name: "activate", label: "Edit this line" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "activate") onDoubleTapBlock(index);
        }}
        accessibilityHint="Double-tap to edit this line"
      >
        {node}
      </Pressable>
    ) : (
      node
    );

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
        readable(index, node)
      ),
    );

  /**
   * A line drawn as something to look at or use (a picture, a table, an
   * embed): a tap is its own, and a long press opens the Markdown behind
   * it, to change or remove it.
   */
  const held = (index: number, node: React.ReactNode) =>
    decorate(
      index,
      onEditBlock ? (
        <Pressable
          quiet
          onLongPress={() => onEditBlock(index)}
          delayLongPress={450}
          accessibilityHint="Touch and hold to edit this line"
        >
          {node}
        </Pressable>
      ) : (
        node
      ),
    );

  // Numbers count through each list, and nested items step in.
  const layout =
    pageContent && pageIndex !== undefined
      ? [listLayout(pageContent)[pageIndex]]
      : listLayout(content);
  const hidden = folds?.size
    ? foldedLines(content, folds)
    : content.map(() => false);
  const notes = footnoteNumbers(pageContent ?? content);
  const inset = (index: number) =>
    layout[index].depth ? { marginLeft: layout[index].depth * NEST } : null;

  return (
    <View style={styles.body}>
      {content.map((block, index) => {
        // Under a folded heading.
        if (hidden[index] && index !== editing) return null;
        // The open line shows the Markdown behind it, so the shorthand that
        // made a heading or a checkbox is there to change.
        if (index === editing)
          return (
            <View key={index} style={[styles.editing, inset(index)]}>
              <TextInput
                ref={inputRef}
                style={[styles.input, dir(draft ?? "")]}
                value={draft}
                multiline
                autoFocus
                placeholder="Write something…"
                placeholderTextColor={colors.faint}
                onChangeText={onDraftChange}
                onBlur={onBlurLine}
                selection={selection}
                onSelectionChange={(e) =>
                  onSelectionChange?.(e.nativeEvent.selection)
                }
                accessibilityLabel="Line being edited"
              />
              {underEditing ? (
                <View style={styles.underEditing}>{underEditing}</View>
              ) : null}
            </View>
          );
        switch (block.type) {
          case "heading": {
            const folded = !!block.id && !!folds?.has(block.id);
            const foldable =
              !!block.id &&
              !!onToggleFold &&
              (folded || canFold(content, index));
            const heading = line(
              index,
              <Text
                style={[
                  styles.heading,
                  block.level === 1 ? styles.h1 : styles.h2,
                  block.level >= 4 ? styles.deepHeading : undefined,
                  dir(block.text),
                ]}
              >
                <Inline text={block.text} marks={marks[block.id ?? ""]} />
                {folded ? <Text style={styles.foldedMark}> …</Text> : null}
              </Text>,
            );
            if (!foldable) return heading;
            // The fold sits at the heading's end, where a thumb reaches it
            // and nothing is drawn past the page's edge.
            return (
              <View key={index} style={styles.headingRow}>
                <View style={styles.headingBody}>{heading}</View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    folded ? `Unfold ${block.text}` : `Fold ${block.text}`
                  }
                  accessibilityState={{ expanded: !folded }}
                  hitSlop={12}
                  onPress={() => onToggleFold?.(block.id!)}
                  style={styles.fold}
                >
                  <Icon
                    name={folded ? "chevronRight" : "chevronDown"}
                    size={16}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
            );
          }
          case "callout":
            return line(index, <CalloutView block={block} />);
          case "table":
            return decorate(
              index,
              <Pressable
                quiet
                onLongPress={onEditBlock ? () => onEditBlock(index) : undefined}
                delayLongPress={450}
              >
                <TableView
                  text={block.text}
                  onEdit={onEditTable ? () => onEditTable(index) : undefined}
                />
              </Pressable>,
            );
          case "image":
            return held(
              index,
              <ImageBlock
                block={block}
                onChange={
                  onReplace ? (next) => onReplace(index, next) : undefined
                }
              />,
            );
          case "file":
            return held(index, <FileCard block={block} />);
          case "footnote":
            return line(
              index,
              <FootnoteLine
                block={block}
                number={notes.get(block.label) ?? block.label}
              />,
            );
          case "bullet":
          case "numbered":
            return line(
              index,
              <View style={[styles.row, inset(index), rowDir(block.text)]}>
                <Text
                  style={[
                    styles.marker,
                    block.type === "numbered" && styles.number,
                  ]}
                >
                  {block.type === "bullet"
                    ? BULLETS[layout[index].depth % BULLETS.length]
                    : `${layout[index].number ?? 1}.`}
                </Text>
                <Text style={[styles.text, dir(block.text)]}>
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
              <View
                style={[
                  styles.row,
                  styles.line,
                  inset(index),
                  rowDir(block.text),
                ]}
              >
                {/* A checkbox, as on task rows and on the web: a switch reads
                    as a setting, and is twice the size of a line. */}
                <Pressable
                  onPress={() => onToggleTodo?.(index)}
                  disabled={!onToggleTodo}
                  hitSlop={12}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: block.done,
                    disabled: !onToggleTodo,
                  }}
                  accessibilityLabel={block.text || "Checklist item"}
                  style={[
                    styles.check,
                    block.done && styles.checkDone,
                    !onToggleTodo && styles.checkLocked,
                  ]}
                >
                  {block.done && (
                    <Icon name="check" size={14} color={colors.white} />
                  )}
                </Pressable>
                {/* The tag sits beside the label, not inside it, so a done
                    line does not strike through the tag as well. */}
                <Pressable
                  style={({ pressed }) => [
                    styles.todoText,
                    pressed && onEditBlock ? styles.linePressed : null,
                  ]}
                  onPress={
                    onEditBlock
                      ? () => onEditBlock(index)
                      : onDoubleTapBlock
                        ? () => readerTap(index)
                        : undefined
                  }
                  disabled={!onEditBlock && !onDoubleTapBlock}
                  accessibilityRole={onEditBlock ? "button" : undefined}
                  accessibilityLabel={
                    onEditBlock ? "Edit this line" : undefined
                  }
                >
                  <Text
                    style={[
                      styles.text,
                      block.done && styles.done,
                      dir(block.text),
                    ]}
                  >
                    <Inline text={block.text} marks={marks[block.id ?? ""]} />
                  </Text>
                  {block.id && tasks?.has(block.id) ? (
                    <Text style={styles.tag}>task</Text>
                  ) : null}
                </Pressable>
              </View>,
            );
          case "quote":
            return line(
              index,
              <View style={styles.quote}>
                <Text style={[styles.quoteText, dir(block.text)]}>
                  <Inline text={block.text} marks={marks[block.id ?? ""]} />
                </Text>
              </View>,
            );
          case "code":
            // A live list (SRCH-02) is drawn as its rows, not its settings.
            if (block.lang === LIVE_LIST_LANG)
              return line(index, <LiveList text={block.text} />);
            // An embed (LNK-08) and a diagram (EDT-11) are drawn, not typed.
            if (block.lang === EMBED_LANG)
              return held(
                index,
                <EmbedBlock text={block.text} pageBlocks={content} />,
              );
            if (isDiagram(block))
              return held(index, <DiagramView text={block.text} />);
            return line(
              index,
              <CodeView text={block.text} lang={block.lang} />,
            );
          case "math":
            return line(
              index,
              <View style={styles.block}>
                <MathView tex={block.text} display />
                {block.check && (
                  <Text
                    style={styles.mathCheck}
                    accessibilityLabel="Check this equation: it was read from an imported file and its layout was a guess"
                  >
                    Check
                  </Text>
                )}
              </View>,
            );
          case "divider":
            return line(index, <View style={styles.divider} />);
          default:
            return line(
              index,
              <Text style={[styles.text, dir(block.text)]}>
                <Inline text={block.text} marks={marks[block.id ?? ""]} />
              </Text>,
            );
        }
      })}
    </View>
  );
}

/**
 * A line that starts in Arabic or Hebrew reads right to left (DSN-04), as
 * dir="auto" does on the web; the rest of the app stays as it is.
 */
const dir = (text: string) =>
  lineDirection(text) === "rtl"
    ? ({ writingDirection: "rtl", textAlign: "right" } as const)
    : null;
/** A list row whose words read right to left has its marker on the right. */
const rowDir = (text: string) =>
  lineDirection(text) === "rtl"
    ? ({ flexDirection: "row-reverse" } as const)
    : null;

/** How far each level of a nested list steps in. */
const NEST = 20;
/** Bullets change shape as a list nests, as they do on the web. */
const BULLETS = ["•", "◦", "▪", "•"];

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
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
    editing: { gap: 6, alignItems: "flex-start" },
    underEditing: { alignSelf: "stretch" },
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
    h1: { fontSize: 18 },
    h2: { fontSize: 15 },
    deepHeading: { fontFamily: fonts.semibold },
    text: { color: colors.text, fontSize: 15, lineHeight: 22, flex: 1 },
    done: { color: colors.muted, textDecorationLine: "line-through" },
    todoText: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
    tag: { color: colors.muted, fontSize: 13, fontFamily: fonts.semibold },
    row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    marker: { color: colors.muted, fontSize: 15, lineHeight: 22, width: 16 },
    // Room for two digits, lined up on their dots.
    number: { width: 24, textAlign: "right", fontVariant: ["tabular-nums"] },
    check: {
      width: 22,
      height: 22,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checkDone: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkLocked: { opacity: 0.5 },
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
    mathCheck: {
      alignSelf: "flex-end",
      marginTop: 4,
      paddingHorizontal: 8,
      paddingVertical: 1,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor: colors.warningSoft,
      color: colors.warningStrong,
      fontSize: 11,
      fontWeight: "600",
    },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
    flash: {
      marginHorizontal: -8,
      paddingHorizontal: 8,
      borderRadius: radii.input,
      backgroundColor: colors.warningSoft,
    },
    headingRow: { flexDirection: "row", alignItems: "center", gap: 2 },
    headingBody: { flex: 1, minWidth: 0 },
    fold: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    foldedMark: { color: colors.faint },
  }),
);
