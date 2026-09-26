import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import {
  BLOCK_KINDS,
  type HighlightTint,
  type ObjectRef,
  type ToolbarStyle,
} from "@orbyn/core";
import { LinkPickerPanel } from "./links";
import { Icon, type IconName } from "../../components/Icon";
import { ActionSheet, type MoreAction } from "../../components/MoreMenu";
import { colors, controls, fonts, radii, themed } from "../../theme";

/** Short names for the line kinds, where a phone has no room for "Bulleted list". */
const SHORT: Record<string, string> = {
  paragraph: "Text",
  "heading-1": "Heading 1",
  "heading-2": "Heading 2",
  "heading-3": "Heading 3",
  bullet: "• List",
  numbered: "1. List",
  todo: "☐ To-do",
  quote: "“ Quote",
  code: "Code",
  math: "∑ Maths",
  divider: "— Divider",
  callout: "Callout",
};

/** What the kinds panel can put in place of the line, beyond its kinds. */
export type LineInsert =
  | "table"
  | "photo"
  | "picture"
  | "file"
  | "template"
  | "footnote"
  | "embed"
  | "tasks"
  | "diagram";

export const INSERTS: { key: LineInsert; label: string; hint: string }[] = [
  { key: "table", label: "Table", hint: "Rows and columns" },
  { key: "photo", label: "Take a photo", hint: "A picture from the camera" },
  { key: "picture", label: "Picture", hint: "From your photos" },
  {
    key: "file",
    label: "File",
    hint: "A PDF, Word or other file to keep here",
  },
  { key: "template", label: "Template", hint: "A template's lines, here" },
  { key: "footnote", label: "Footnote", hint: "A numbered note at the end" },
  {
    key: "embed",
    label: "Embed a page",
    hint: "Another page, kept up to date",
  },
  {
    key: "tasks",
    label: "Tasks linked here",
    hint: "The tasks this page links to",
  },
  { key: "diagram", label: "Diagram", hint: "A flowchart" },
];

export type LineKind = (typeof BLOCK_KINDS)[number];
export const kindKey = (k: { type: string; level?: number }) =>
  k.type === "heading" ? `heading-${k.level}` : k.type;

/** What the open line is and allows, for the toolbar to show. */
export type LineState = {
  /** The line's kind, as `kindKey` names it. */
  kind: string;
  /** Styles the caret or selection sits in. */
  styles: ToolbarStyle[];
  /** Bold, italic, highlight and link make sense here (not code or maths). */
  styleable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Lines may be added, moved and removed (not while suggesting). */
  structural: boolean;
  canIndent: boolean;
  canOutdent: boolean;
  /** A to-do already tied to a task. */
  isTask: boolean;
  /** The line has words (for Comment, Ask and Make task). */
  hasWords: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

/**
 * One row of icons over the keyboard, for the line being typed: Undo, Redo,
 * Aa (what kind of line), Bold, Italic, Highlight, Link, To-do / Make task,
 * Indent, Outdent, Comment, Ask, ⋯ (Move, "On words", Delete), and Hide
 * keyboard last, where the thumb finds it. The row scrolls sideways on a
 * narrow phone; Hide keyboard stays put. The style the caret is in is
 * tinted, as a chosen chip is.
 */
export function LineToolbar({
  line,
  suggesting,
  onUndo,
  onRedo,
  onKind,
  onStyle,
  onLink,
  linkQuery = null,
  projectName,
  onPickLink,
  onCreateLink,
  report,
  onTodo,
  onLiveList,
  onInsert,
  onTint,
  onCopyLink,
  onMoveToPage,
  onIndent,
  onComment,
  onAsk,
  onMove,
  onCommentWords,
  onDelete,
  onHide,
}: {
  line: LineState;
  /** In suggesting mode a line's words are proposals: say so above the row. */
  suggesting: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onKind: (kind: LineKind) => void;
  onStyle: (style: "bold" | "italic" | "highlight" | "strike") => void;
  /** Link the chosen words (or put the address in) with this address. */
  onLink: (url: string) => boolean;
  /** The words after a "[[" typed before the caret, or null. */
  linkQuery?: string | null;
  /** The page's project, where a task made from the picker goes. */
  projectName?: string | null;
  /** Put a link to this in the line (the link picker). */
  onPickLink: (ref: ObjectRef, title: string) => void;
  /** Make a page or task with these words, and link it. */
  onCreateLink: (kind: "doc" | "task", title: string) => void;
  report: (e: unknown) => void;
  /** Make the line a to-do, or a to-do a task. */
  onTodo: () => void;
  /** Make the line a live list (SRCH-02); left out where it can't be. */
  onLiveList?: () => void;
  /** Put a table, picture, file, template… in the line's place. */
  onInsert?: (what: LineInsert) => void;
  /** Highlight the chosen words green or pink (EDT-05). */
  onTint?: (tint: HighlightTint) => void;
  /** "Copy link to this line" (LNK-04). */
  onCopyLink?: () => void;
  /** "Move to new page" (ORG-05). */
  onMoveToPage?: () => void;
  onIndent: (by: 1 | -1) => void;
  onComment: () => void;
  onAsk: () => void;
  onMove: (by: -1 | 1) => void;
  onCommentWords: () => void;
  onDelete: () => void;
  /** Put the line away and the keyboard with it. */
  onHide: () => void;
}) {
  const [panel, setPanel] = useState<"kinds" | "link" | null>(null);
  const [more, setMore] = useState(false);
  /** A "[[" picker put away with its close button, until the "[[" goes. */
  const [bracketShut, setBracketShut] = useState(false);
  useEffect(() => {
    if (linkQuery === null) setBracketShut(false);
  }, [linkQuery]);
  const todo = line.kind === "todo";
  const isList = ["bullet", "numbered", "todo"].includes(line.kind);
  const addLink = (url: string) => {
    if (!onLink(url)) return false;
    setPanel(null);
    return true;
  };
  const menu: MoreAction[] = [
    ...(line.structural
      ? [
          {
            label: "Move up",
            disabled: !line.canMoveUp,
            onPress: () => onMove(-1),
          },
          {
            label: "Move down",
            disabled: !line.canMoveDown,
            onPress: () => onMove(1),
          },
        ]
      : []),
    ...(onTint && line.styleable
      ? [
          { label: "Highlight green", onPress: () => onTint("green") },
          { label: "Highlight pink", onPress: () => onTint("rose") },
        ]
      : []),
    {
      label: "Comment on some words",
      disabled: !line.hasWords,
      onPress: onCommentWords,
    },
    ...(onCopyLink
      ? [{ label: "Copy link to this line", onPress: onCopyLink }]
      : []),
    ...(onMoveToPage && line.structural
      ? [
          {
            label: line.kind.startsWith("heading")
              ? "Move section to new page"
              : "Move to new page",
            onPress: onMoveToPage,
          },
        ]
      : []),
    ...(line.structural
      ? [{ label: "Delete line", destructive: true, onPress: onDelete }]
      : []),
  ];
  return (
    <View style={s.dock}>
      {suggesting && (
        <Text style={s.hint}>
          While you are suggesting, a line’s words are yours to change. Moving
          and removing lines are the page’s to keep.
        </Text>
      )}
      {panel === "kinds" && (
        <View style={s.panel} accessibilityLabel="Kind of line">
          {BLOCK_KINDS.map((kind) => {
            const key = kindKey(kind);
            const on = key === line.kind;
            return (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={kind.label}
                accessibilityHint={kind.hint}
                onPress={() => {
                  onKind(kind);
                  setPanel(null);
                }}
                style={({ pressed }) => [
                  s.kind,
                  on && s.kindOn,
                  pressed && !on && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Text style={[s.kindText, on && s.kindTextOn]}>
                  {SHORT[key]}
                </Text>
              </Pressable>
            );
          })}
          {onLiveList && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Live list"
              accessibilityHint="Tasks or pages that match, kept up to date"
              onPress={() => {
                setPanel(null);
                onLiveList();
              }}
              style={({ pressed }) => [
                s.kind,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={s.kindText}>Live list</Text>
            </Pressable>
          )}
          {onInsert &&
            INSERTS.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityHint={item.hint}
                onPress={() => {
                  setPanel(null);
                  onInsert(item.key);
                }}
                style={({ pressed }) => [
                  s.kind,
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Text style={s.kindText}>{item.label}</Text>
              </Pressable>
            ))}
        </View>
      )}
      {linkQuery !== null && !bracketShut ? (
        <LinkPickerPanel
          query={linkQuery}
          projectName={projectName}
          onPick={onPickLink}
          onCreate={onCreateLink}
          onClose={() => setBracketShut(true)}
          report={report}
        />
      ) : (
        panel === "link" && (
          <LinkPickerPanel
            projectName={projectName}
            onPick={(ref, title) => {
              setPanel(null);
              onPickLink(ref, title);
            }}
            onCreate={(kind, title) => {
              setPanel(null);
              onCreateLink(kind, title);
            }}
            onUrl={line.styleable ? addLink : undefined}
            onClose={() => setPanel(null)}
            report={report}
          />
        )
      )}
      <View style={s.bar} accessibilityRole="toolbar">
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.row}
        >
          <Tool icon="undo" label="Undo" off={!line.canUndo} onPress={onUndo} />
          <Tool icon="redo" label="Redo" off={!line.canRedo} onPress={onRedo} />
          <Tool
            icon="lineKinds"
            label="Kind of line"
            on={panel === "kinds"}
            onPress={() => setPanel(panel === "kinds" ? null : "kinds")}
          />
          <Tool
            icon="bold"
            label="Bold"
            on={line.styles.includes("bold")}
            off={!line.styleable}
            onPress={() => onStyle("bold")}
          />
          <Tool
            icon="italic"
            label="Italic"
            on={line.styles.includes("italic")}
            off={!line.styleable}
            onPress={() => onStyle("italic")}
          />
          <Tool
            icon="highlighter"
            label="Highlight"
            on={line.styles.includes("highlight")}
            off={!line.styleable}
            onPress={() => onStyle("highlight")}
          />
          <Tool
            icon="strikethrough"
            label="Strikethrough"
            on={line.styles.includes("strike")}
            off={!line.styleable}
            onPress={() => onStyle("strike")}
          />
          <Tool
            icon="link"
            label="Link"
            on={panel === "link" || line.styles.includes("link")}
            onPress={() => setPanel(panel === "link" ? null : "link")}
          />
          <Tool
            icon="squareCheck"
            label={
              line.isTask ? "Already a task" : todo ? "Make task" : "To-do"
            }
            on={todo}
            off={line.isTask || (todo && (!line.structural || !line.hasWords))}
            onPress={onTodo}
          />
          {/* Always in their place, so the row never shifts; they work on
              list lines. */}
          <Tool
            icon="indent"
            label="Indent"
            off={!isList || !line.canIndent}
            onPress={() => onIndent(1)}
          />
          <Tool
            icon="outdent"
            label="Outdent"
            off={!isList || !line.canOutdent}
            onPress={() => onIndent(-1)}
          />
          <Tool icon="comment" label="Comment" onPress={onComment} />
          <Tool
            icon="sparkles"
            label="Ask the assistant about these words"
            off={!line.hasWords}
            onPress={onAsk}
          />
          <Tool
            icon="more"
            label="More for this line"
            onPress={() => setMore(true)}
          />
        </ScrollView>
        <View style={s.edge} />
        <Tool icon="keyboardDown" label="Hide keyboard" onPress={onHide} />
      </View>
      <ActionSheet
        visible={more}
        label="More for this line"
        actions={menu}
        onClose={() => setMore(false)}
      />
    </View>
  );
}

/** One icon in the toolbar: 34pt drawn, a thumb's worth to press. */
function Tool({
  icon,
  label,
  on = false,
  off = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  on?: boolean;
  off?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, selected: on }}
      disabled={off}
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={onPress}
      style={({ pressed }) => [
        s.tool,
        on && s.toolOn,
        pressed && !on && { backgroundColor: colors.surfaceMuted },
        off && { opacity: 0.35 },
      ]}
    >
      <Icon
        name={icon}
        size={18}
        color={on ? colors.accent : colors.textSoft}
      />
    </Pressable>
  );
}

const s = themed(() =>
  StyleSheet.create({
    // Rides on the keyboard: the sheet's own inset keeps it just above it.
    dock: {
      gap: 8,
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 8,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 4,
      borderRadius: radii.pill,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 2 },
    edge: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      marginVertical: 6,
      marginHorizontal: 4,
      backgroundColor: colors.border,
    },
    tool: {
      width: controls.tap - 6,
      height: controls.tap - 10,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    toolOn: { backgroundColor: colors.accentSoft },
    hint: { color: colors.faint, fontSize: 13, lineHeight: 18 },
    panel: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      padding: 10,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    kind: {
      minHeight: controls.compact + 4,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    kindOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    kindText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    kindTextOn: { color: colors.accent },
  }),
);
