import React, { useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  calendarDay,
  cellText,
  columnLabel,
  columnTotal,
  daysLeft,
  daysLeftText,
  fieldKeyId,
  groupHeader,
  isEditableColumn,
  isOverdue,
  localDateKey,
  PRIORITIES,
  statusChoices,
  statusText,
  viewColumns,
  viewTotals,
  type CustomField,
  type ViewDefinition,
  type ViewGroup,
  type ViewResult,
  type ViewRow,
} from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Chip, ChipRow } from "../../components/Chip";
import { DateField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";
import { colors, fonts, radii, themed } from "../../theme";
import { webOrigin } from "../../lib/api";
import { FieldValueInput } from "./FieldsSection";
import type { CellEdit } from "./edits";

type Props = {
  def: ViewDefinition;
  result: ViewResult;
  groups: ViewGroup[];
  timeZone: string;
  folded: Set<string>;
  onToggleFold: (key: string) => void;
  onOpen: (row: ViewRow) => void;
  onEdit: (row: ViewRow, edit: CellEdit) => void;
};

/** The short facts under a row's name: when it's due, where it sits. */
function facts(row: ViewRow, timeZone: string, fields: CustomField[]) {
  const ctx = { now: new Date(), timeZone };
  const parts: string[] = [];
  if (row.kind === "page") {
    parts.push(cellText(row, "kind", ctx));
    if (row.folder_name) parts.push(row.folder_name);
  } else {
    const due = cellText(row, "due", ctx);
    if (due) parts.push(`Due ${due}`);
    if (row.kind === "project" && row.task_count)
      parts.push(`${row.done_count ?? 0} of ${row.task_count} done`);
  }
  if (row.kind !== "project" && row.project_name) parts.push(row.project_name);
  for (const f of fields.slice(0, 2)) {
    const text = cellText(row, `field:${f.id}`, ctx, { fields });
    if (text) parts.push(`${f.name}: ${text}`);
  }
  return parts.filter(Boolean).join(" · ");
}

/** A task's tick, as on every task row. */
function Tick({ row, onPress }: { row: ViewRow; onPress: () => void }) {
  const done = row.status === "done";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${done ? "Reopen" : "Finish"} ${row.title}`}
      accessibilityState={{ checked: done, disabled: !row.can_write }}
      disabled={!row.can_write}
      hitSlop={11}
      onPress={onPress}
      style={[s.tick, done && s.tickDone, !row.can_write && s.dim]}
    >
      {done && (
        <Icon name="check" size={13} color={colors.white} strokeWidth={3} />
      )}
    </Pressable>
  );
}

function GroupHead({
  group,
  folded,
  onToggle,
}: {
  group: ViewGroup;
  folded: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !folded }}
      onPress={onToggle}
      hitSlop={6}
      style={s.groupHead}
    >
      <Icon
        name={folded ? "chevronRight" : "chevronDown"}
        size={14}
        color={colors.muted}
      />
      <Text style={s.groupTitle}>
        {groupHeader({
          title: group.title || "Everything",
          items: group.rows as never[],
          minutes: group.minutes,
        })}
      </Text>
    </Pressable>
  );
}

/**
 * A saved view drawn for a phone: a list with ticks, a table that scrolls
 * sideways (tap a cell to change it), a board of columns, a month of days,
 * or cards for pages. Totals sit under it: "14 tasks · 11 h estimated · 3
 * overdue".
 */
export function ViewBody(props: Props) {
  const { def, result, timeZone } = props;
  const ctx = { now: new Date(), timeZone };
  if (!result.rows.length)
    return (
      <View style={[shared.card, shared.empty]}>
        <Text style={shared.sectionTitle}>Nothing matches</Text>
        <Text style={[shared.subtitle, s.center]}>
          Loosen a filter, or add something that fits.
        </Text>
      </View>
    );
  return (
    <View style={s.body}>
      {def.layout === "table" ? (
        <TableLayout {...props} />
      ) : def.layout === "board" ? (
        <BoardLayout {...props} />
      ) : def.layout === "calendar" ? (
        <CalendarLayout {...props} />
      ) : def.layout === "gallery" ? (
        <GalleryLayout {...props} />
      ) : (
        <ListLayout {...props} />
      )}
      <Text style={s.totals}>{viewTotals(result.rows, def.source, ctx)}</Text>
      {result.truncated && (
        <Text style={shared.small}>
          Showing the first {result.rows.length}. Narrow the filters to see the
          rest.
        </Text>
      )}
    </View>
  );
}

function ListLayout({
  groups,
  result,
  timeZone,
  folded,
  onToggleFold,
  onOpen,
  onEdit,
}: Props) {
  const grouped = !(groups.length === 1 && groups[0].key === "all");
  const ctx = { now: new Date(), timeZone };
  return (
    <>
      {groups.map((g) => (
        <View key={g.key} style={s.group}>
          {grouped && (
            <GroupHead
              group={g}
              folded={folded.has(g.key)}
              onToggle={() => onToggleFold(g.key)}
            />
          )}
          {!folded.has(g.key) && (
            <View style={s.card}>
              {g.rows.map((row, n) => {
                const left = row.kind !== "page" ? daysLeft(row, ctx) : null;
                return (
                  <View
                    key={`${g.key}:${row.id}`}
                    style={[s.listRow, n > 0 && s.divider]}
                  >
                    {row.kind === "task" && (
                      <Tick
                        row={row}
                        onPress={() => onEdit(row, { column: "done" })}
                      />
                    )}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onOpen(row)}
                      style={s.listText}
                    >
                      <Text
                        style={[s.rowTitle, row.status === "done" && s.done]}
                        numberOfLines={2}
                      >
                        {row.title || "Untitled"}
                      </Text>
                      <Text style={shared.small} numberOfLines={1}>
                        {facts(row, timeZone, result.fields)}
                      </Text>
                    </Pressable>
                    {left !== null && row.status !== "done" && (
                      <Text style={[s.left, isOverdue(row, ctx) && s.late]}>
                        {daysLeftText(left)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ))}
    </>
  );
}

const COLUMN_WIDTH = 132;
const TITLE_WIDTH = 190;
const TICK_WIDTH = 44;

function TableLayout({
  def,
  groups,
  result,
  timeZone,
  folded,
  onToggleFold,
  onOpen,
  onEdit,
}: Props) {
  const [cell, setCell] = useState<{ row: ViewRow; column: string } | null>(
    null,
  );
  const columns = viewColumns(def);
  const ctx = { now: new Date(), timeZone };
  const names = { fields: result.fields, people: result.people };
  const grouped = !(groups.length === 1 && groups[0].key === "all");
  const width = (c: string) =>
    c === "done" ? TICK_WIDTH : c === "title" ? TITLE_WIDTH : COLUMN_WIDTH;
  const totals = (rows: ViewRow[]) => (
    <View style={[s.tr, s.totalsRow]}>
      {columns.map((c) => (
        <Text key={c} style={[s.td, s.totalCell, { width: width(c) }]}>
          {c === "done"
            ? ""
            : c === "title"
              ? "Total"
              : columnTotal(rows, c, result.fields, ctx)}
        </Text>
      ))}
    </View>
  );
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={s.table}>
          <View style={[s.tr, s.thead]}>
            {columns.map((c) => (
              <Text key={c} style={[s.th, { width: width(c) }]}>
                {c === "done" ? "" : columnLabel(c, result.fields)}
              </Text>
            ))}
          </View>
          {groups.map((g) => (
            <View key={g.key}>
              {grouped && (
                <View style={s.groupRow}>
                  <GroupHead
                    group={g}
                    folded={folded.has(g.key)}
                    onToggle={() => onToggleFold(g.key)}
                  />
                </View>
              )}
              {!folded.has(g.key) &&
                g.rows.map((row) => (
                  <View key={`${g.key}:${row.id}`} style={s.tr}>
                    {columns.map((c) => {
                      if (c === "done")
                        return (
                          <View key={c} style={[s.td, { width: TICK_WIDTH }]}>
                            {row.kind === "task" && (
                              <Tick
                                row={row}
                                onPress={() => onEdit(row, { column: "done" })}
                              />
                            )}
                          </View>
                        );
                      const fieldId = fieldKeyId(c);
                      const editable =
                        row.can_write &&
                        isEditableColumn(def.source, c) &&
                        (!fieldId ||
                          result.fields.some((f) => f.id === fieldId));
                      return (
                        <Pressable
                          key={c}
                          accessibilityRole="button"
                          accessibilityHint={
                            c === "title"
                              ? "Opens it"
                              : editable
                                ? "Changes it"
                                : undefined
                          }
                          onPress={() =>
                            c === "title"
                              ? onOpen(row)
                              : editable
                                ? setCell({ row, column: c })
                                : undefined
                          }
                          onLongPress={() =>
                            c === "title" && editable
                              ? setCell({ row, column: c })
                              : undefined
                          }
                          style={[s.td, { width: width(c) }]}
                        >
                          <Text
                            style={[
                              s.cellText,
                              c === "title" && s.cellTitle,
                              c === "overdue" && isOverdue(row, ctx) && s.late,
                            ]}
                            numberOfLines={2}
                          >
                            {c === "title"
                              ? row.title || "Untitled"
                              : cellText(row, c, ctx, names)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              {grouped &&
                !folded.has(g.key) &&
                g.rows.length > 1 &&
                totals(g.rows)}
            </View>
          ))}
          {totals(result.rows)}
        </View>
      </ScrollView>
      <Text style={shared.small}>
        Tap a cell to change it; hold a name to rename it.
      </Text>
      <CellEditor
        cell={cell}
        fields={result.fields}
        people={result.people}
        timeZone={timeZone}
        onClose={() => setCell(null)}
        onSave={(edit) => {
          if (cell) onEdit(cell.row, edit);
          setCell(null);
        }}
      />
    </>
  );
}

/** Changing one cell, in a half sheet. */
function CellEditor({
  cell,
  fields,
  people,
  timeZone,
  onClose,
  onSave,
}: {
  cell: { row: ViewRow; column: string } | null;
  fields: CustomField[];
  people: { id: string; name: string }[];
  timeZone: string;
  onClose: () => void;
  onSave: (edit: CellEdit) => void;
}) {
  const [text, setText] = useState("");
  const row = cell?.row;
  const column = cell?.column ?? "";
  const fieldId = fieldKeyId(column);
  const field = fieldId ? fields.find((f) => f.id === fieldId) : undefined;
  const dueDay = row?.due_at
    ? /^\d{4}-\d{2}-\d{2}$/.test(row.due_at)
      ? row.due_at
      : localDateKey(new Date(row.due_at), timeZone)
    : null;
  return (
    <BottomSheet
      visible={!!cell}
      title={row ? `${columnLabel(column, fields)} · ${row.title}` : ""}
      onClose={onClose}
    >
      {row && (
        <View
          style={s.editor}
          // A fresh editor for each cell.
          key={`${row.id}:${column}`}
        >
          {field ? (
            <FieldValueInput
              field={field}
              value={row.fields[field.id]}
              people={people}
              editable
              onCommit={(value) => onSave({ column, field: field.id, value })}
            />
          ) : column === "status" ? (
            <ChipRow label="Status">
              {statusChoices(row.kind).map((st) => (
                <Chip
                  key={st}
                  label={statusText(st)}
                  selected={row.status === st}
                  onPress={() => onSave({ column, value: st })}
                />
              ))}
            </ChipRow>
          ) : column === "priority" ? (
            <ChipRow label="Priority">
              {[...PRIORITIES].reverse().map((p) => (
                <Chip
                  key={p}
                  label={p[0].toUpperCase() + p.slice(1)}
                  selected={row.priority === p}
                  onPress={() => onSave({ column, value: p })}
                />
              ))}
            </ChipRow>
          ) : column === "due" ? (
            <DateField
              label="Due"
              value={dueDay}
              placeholder="No deadline"
              clearable
              onChange={(day) => onSave({ column, value: day })}
            />
          ) : (
            <>
              <TextInput
                style={shared.input}
                autoFocus
                accessibilityLabel={columnLabel(column, fields)}
                defaultValue={
                  column === "estimate"
                    ? row.estimate_minutes
                      ? String(row.estimate_minutes)
                      : ""
                    : row.title
                }
                placeholder={column === "estimate" ? "Minutes, or 1h 30" : ""}
                placeholderTextColor={colors.faint}
                onChangeText={setText}
                returnKeyType="done"
                onSubmitEditing={() =>
                  text.trim() && onSave({ column, value: text.trim() })
                }
              />
              <View style={s.editorActions}>
                <SmallAction
                  label="Save"
                  disabled={!text.trim()}
                  onPress={() => onSave({ column, value: text.trim() })}
                />
              </View>
            </>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

function BoardLayout({ groups, result, timeZone, onOpen, onEdit }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={s.board}>
        {groups.map((g) => (
          <View key={g.key} style={s.column}>
            <Text style={s.groupTitle}>
              {groupHeader({
                title: g.title || "Everything",
                items: g.rows as never[],
                minutes: g.minutes,
              })}
            </Text>
            {g.rows.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                onPress={() => onOpen(row)}
                style={({ pressed }) => [s.boardCard, pressed && s.pressed]}
              >
                <View style={s.boardTitleRow}>
                  {row.kind === "task" && (
                    <Tick
                      row={row}
                      onPress={() => onEdit(row, { column: "done" })}
                    />
                  )}
                  <Text style={[s.rowTitle, s.flex]} numberOfLines={3}>
                    {row.title || "Untitled"}
                  </Text>
                </View>
                <Text style={shared.small} numberOfLines={2}>
                  {facts(row, timeZone, result.fields)}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * A month on a phone: the days that have something, in order, each with its
 * rows, on their deadlines or on the day of the date field the view chose.
 */
function CalendarLayout({ def, result, timeZone, onOpen, onEdit }: Props) {
  const today = localDateKey(new Date(), timeZone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const byDay = new Map<string, ViewRow[]>();
  let undated = 0;
  for (const row of result.rows) {
    const day = calendarDay(row, def, timeZone);
    if (!day) {
      undated += 1;
      continue;
    }
    if (day.slice(0, 7) !== month) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const days = [...byDay.keys()].sort();
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString([], {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      <View style={s.monthNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={10}
          onPress={() => shift(-1)}
        >
          <Icon name="chevronLeft" size={18} color={colors.textSoft} />
        </Pressable>
        <Text style={s.monthTitle}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={10}
          onPress={() => shift(1)}
        >
          <Icon name="chevronRight" size={18} color={colors.textSoft} />
        </Pressable>
      </View>
      {!days.length && <Text style={shared.small}>Nothing this month.</Text>}
      {days.map((day) => (
        <View key={day} style={s.group}>
          <Text style={[s.groupTitle, day === today && s.today]}>
            {new Date(`${day}T12:00:00Z`).toLocaleDateString([], {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </Text>
          <View style={s.card}>
            {byDay.get(day)!.map((row, n) => (
              <View key={row.id} style={[s.listRow, n > 0 && s.divider]}>
                {row.kind === "task" && (
                  <Tick
                    row={row}
                    onPress={() => onEdit(row, { column: "done" })}
                  />
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onOpen(row)}
                  style={s.listText}
                >
                  <Text
                    style={[s.rowTitle, row.status === "done" && s.done]}
                    numberOfLines={2}
                  >
                    {row.title || "Untitled"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ))}
      {undated > 0 && (
        <Text style={shared.small}>
          {undated === 1 ? "1 has no date" : `${undated} have no date`}
        </Text>
      )}
    </>
  );
}

/**
 * Pages as cards (DATA-05): the title, the first lines, and the page's own
 * first image as a cover when it has one. Otherwise plain surface.
 */
function GalleryLayout({ result, timeZone, onOpen }: Props) {
  return (
    <View style={s.gallery}>
      {result.rows.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          onPress={() => onOpen(row)}
          style={({ pressed }) => [s.galleryCard, pressed && s.pressed]}
        >
          {row.cover && (
            <Image
              source={{ uri: `${webOrigin}${row.cover}` }}
              style={s.cover}
              accessibilityIgnoresInvertColors
            />
          )}
          <Text style={s.galleryTitle} numberOfLines={2}>
            {row.title || "Untitled"}
          </Text>
          {!!row.preview && (
            <Text style={s.preview} numberOfLines={3}>
              {row.preview}
            </Text>
          )}
          <Text style={shared.small} numberOfLines={2}>
            {facts(row, timeZone, result.fields)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 12 },
    center: { textAlign: "center" },
    flex: { flex: 1 },
    group: { gap: 8 },
    groupHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
    },
    groupTitle: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    today: { color: colors.accent },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      paddingVertical: 10,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    listText: { flex: 1, gap: 2 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    done: { color: colors.muted, textDecorationLine: "line-through" },
    left: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
    late: { color: colors.warning, fontFamily: fonts.semibold },
    tick: {
      width: 22,
      height: 22,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    tickDone: { backgroundColor: colors.accent, borderColor: colors.accent },
    dim: { opacity: 0.45 },
    totals: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    tr: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    thead: { backgroundColor: colors.surfaceMuted },
    th: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: colors.muted,
    },
    td: {
      minHeight: 44,
      paddingHorizontal: 10,
      paddingVertical: 10,
      justifyContent: "center",
    },
    cellText: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
    cellTitle: { fontFamily: fonts.medium },
    totalsRow: { backgroundColor: colors.surfaceMuted },
    totalCell: {
      minHeight: 32,
      paddingVertical: 8,
      fontFamily: fonts.regular,
      fontSize: 11,
      color: colors.muted,
    },
    groupRow: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.surfaceMuted,
    },
    editor: { gap: 12, paddingBottom: 12 },
    editorActions: { flexDirection: "row", gap: 8 },
    board: { flexDirection: "row", gap: 12, paddingBottom: 4 },
    column: {
      width: 250,
      gap: 8,
      padding: 10,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    boardCard: {
      gap: 6,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    boardTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    pressed: { opacity: 0.7 },
    monthNav: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    monthTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
    gallery: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    galleryCard: {
      flexBasis: "47%",
      flexGrow: 1,
      gap: 6,
      padding: 12,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cover: { width: "100%", height: 96, borderRadius: radii.input },
    galleryTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
    preview: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSoft,
    },
  }),
);
