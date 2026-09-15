import React, { useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, Text, View } from "react-native";
import type { Item, Status } from "@orbyn/core";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { ItemCard } from "./ItemCard";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

export type ListHandlers = {
  busy: boolean;
  onToggle: (item: Item) => void;
  /** Opens the task detail sheet. */
  onOpen: (item: Item) => void;
  onAdd: () => void;
  /** False for items whose checkbox should be disabled (team items you only view). */
  canToggle?: (item: Item) => boolean;
  /** Change an item's status (long-press a row, or "Move to…" on the board). */
  onSetStatus?: (item: Item, status: Status) => void;
};

/** Section heading with a count badge, used above every list of items. */
export function SectionHeading({
  title,
  count,
  hint,
  color,
}: {
  title: string;
  count?: number;
  /** Short line under the heading, e.g. "Blocked or past due". */
  hint?: string;
  /** A dot before the title: a list's, tag's or status's colour. */
  color?: string;
}) {
  return (
    <View style={s.headingWrap}>
      <View style={s.heading} accessibilityRole="header">
        {!!color && <View style={[s.dot, { backgroundColor: color }]} />}
        <Text style={shared.sectionTitle}>{title}</Text>
        {count !== undefined && (
          <View style={s.count}>
            <Text style={s.countText}>{count}</Text>
          </View>
        )}
      </View>
      {!!hint && <Text style={shared.small}>{hint}</Text>}
    </View>
  );
}

/** Where to put a task in its manual order (`PUT /items/:id/position`). */
export type Place = { before_id: string } | { after_id: string };

type Row = { item: Item; depth: number; kids: number };
/** Deepest indent: a task, its subtasks and theirs (the server's limit). */
const MAX_DEPTH = 2;

/**
 * Items in their order, with each subtask moved under its task when that
 * task is in the same list. Folded tasks hide what's under them.
 */
function nestRows(items: Item[], folded: Set<string>): Row[] {
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<string, Item[]>();
  const roots: Item[] = [];
  for (const i of items) {
    const parent = i.parent_id;
    if (parent && parent !== i.id && ids.has(parent)) {
      const list = kids.get(parent) ?? [];
      list.push(i);
      kids.set(parent, list);
    } else roots.push(i);
  }
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (i: Item, depth: number) => {
    if (seen.has(i.id)) return;
    seen.add(i.id);
    const children = kids.get(i.id) ?? [];
    out.push({
      item: i,
      depth: Math.min(depth, MAX_DEPTH),
      kids: children.length,
    });
    if (!folded.has(i.id)) for (const c of children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

/** Two items share a place in the manual order: the same parent, else list and space. */
const samePlace = (a: Item, b: Item) =>
  (a.parent_id ?? null) === (b.parent_id ?? null) &&
  (!!a.parent_id ||
    ((a.list_id ?? null) === (b.list_id ?? null) &&
      (a.team_id ?? null) === (b.team_id ?? null)));

/**
 * Rows of `ItemCard` in one bordered card. With `nest`, subtasks sit under
 * their task and can be folded away. With `onReorder` (manual order), a long
 * press picks a row up to drag it, and Move up / Move down do the same from
 * the menu or a screen reader.
 */
export function ItemRows({
  items,
  busy,
  onToggle,
  onOpen,
  canToggle,
  onSetStatus,
  showScore = false,
  moveButton = false,
  nest = false,
  onReorder,
  onDragging,
}: Omit<ListHandlers, "onAdd"> & {
  items: Item[];
  /** Show each item's priority score (the list is sorted by it). */
  showScore?: boolean;
  /** A "Move to…" status action on each card (the board). */
  moveButton?: boolean;
  /** Put subtasks under their tasks. */
  nest?: boolean;
  /** Manual order: move a task before or after another in its place. */
  onReorder?: (item: Item, place: Place) => void;
  /** A row is being dragged: the page should hold still. */
  onDragging?: (dragging: boolean) => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const rows = nest
    ? nestRows(items, folded)
    : items.map((item) => ({ item, depth: 0, kids: 0 }));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const layouts = useRef(new Map<string, { y: number; height: number }>());
  /** The row picked up by a long press, before and while it's dragged. */
  const armed = useRef<string | null>(null);
  /** The drag took over the gesture (the finger moved after the long press). */
  const granted = useRef(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const [dragId, setDragId] = useState<string | null>(null);
  const reorder = useRef(onReorder);
  reorder.current = onReorder;
  const dragging = useRef(onDragging);
  dragging.current = onDragging;

  /** The nearest task in the same place, scanning from `from` towards `to`. */
  const neighbour = (list: Row[], item: Item, from: number, to: number) => {
    const step = from <= to ? 1 : -1;
    for (let k = from; k !== to + step; k += step)
      if (
        list[k] &&
        list[k].item.id !== item.id &&
        samePlace(list[k].item, item)
      )
        return list[k].item;
    return null;
  };
  const moveBy = (item: Item, dir: -1 | 1) => {
    const list = rowsRef.current;
    const at = list.findIndex((r) => r.item.id === item.id);
    const other =
      dir < 0
        ? neighbour(list, item, at - 1, 0)
        : neighbour(list, item, at + 1, list.length - 1);
    if (other)
      reorder.current?.(
        item,
        dir < 0 ? { before_id: other.id } : { after_id: other.id },
      );
  };

  const end = (dy: number, commit: boolean) => {
    const id = armed.current;
    armed.current = null;
    granted.current = false;
    dragging.current?.(false);
    setDragId(null);
    dragY.setValue(0);
    if (!id || !commit) return;
    const list = rowsRef.current;
    const at = list.findIndex((r) => r.item.id === id);
    const me = layouts.current.get(id);
    if (at < 0 || !me) return;
    const item = list[at].item;
    const center = me.y + me.height / 2 + dy;
    let target = list.findIndex((r) => {
      const l = layouts.current.get(r.item.id);
      return !!l && center >= l.y && center < l.y + l.height;
    });
    if (target < 0) target = center < me.y ? 0 : list.length - 1;
    // Dropped among another task's subtasks: it goes next to that task.
    if (target > at) {
      const other = neighbour(list, item, target, at + 1);
      if (other) reorder.current?.(item, { after_id: other.id });
    } else if (target < at) {
      const other = neighbour(list, item, target, at - 1);
      if (other) reorder.current?.(item, { before_id: other.id });
    }
  };
  const endRef = useRef(end);
  endRef.current = end;

  const responder = useRef(
    PanResponder.create({
      // Only after a long press armed a row; otherwise the page scrolls.
      onMoveShouldSetPanResponderCapture: () => !!armed.current,
      onPanResponderGrant: () => {
        granted.current = true;
      },
      onPanResponderMove: (_, g) => dragY.setValue(g.dy),
      onPanResponderRelease: (_, g) => endRef.current(g.dy, true),
      onPanResponderTerminate: () => endRef.current(0, false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const startDrag = (item: Item) => {
    armed.current = item.id;
    granted.current = false;
    setDragId(item.id);
    dragging.current?.(true);
  };
  /** The finger lifted: true while a drag owns the gesture (it ends itself). */
  const releaseDrag = () => {
    if (granted.current) return true;
    if (armed.current) {
      armed.current = null;
      setDragId(null);
      dragging.current?.(false);
    }
    return false;
  };

  return (
    <View style={s.list} {...(onReorder ? responder.panHandlers : {})}>
      {rows.map(({ item: i, depth, kids }, n) => {
        const lifted = dragId === i.id;
        const readOnly = canToggle ? !canToggle(i) : false;
        return (
          <Animated.View
            key={i.id}
            onLayout={(e) =>
              layouts.current.set(i.id, {
                y: e.nativeEvent.layout.y,
                height: e.nativeEvent.layout.height,
              })
            }
            style={lifted && [s.lifted, { transform: [{ translateY: dragY }] }]}
          >
            <FadeIn index={n}>
              <ItemCard
                item={i}
                busy={busy}
                first={n === 0}
                readOnly={readOnly}
                onToggle={onToggle}
                onOpen={onOpen}
                onSetStatus={onSetStatus}
                score={showScore ? i.score : undefined}
                moveButton={moveButton}
                depth={depth}
                subtasks={
                  kids > 0
                    ? {
                        count: kids,
                        open: !folded.has(i.id),
                        onToggle: () => {
                          animateLayout();
                          setFolded((f) => {
                            const next = new Set(f);
                            if (next.has(i.id)) next.delete(i.id);
                            else next.add(i.id);
                            return next;
                          });
                        },
                      }
                    : undefined
                }
                onMoveBy={
                  onReorder
                    ? {
                        up: !!neighbour(rows, i, n - 1, 0),
                        down: !!neighbour(rows, i, n + 1, rows.length - 1),
                        move: (dir) => moveBy(i, dir),
                      }
                    : undefined
                }
                onDragStart={onReorder && !readOnly ? startDrag : undefined}
                onDragRelease={onReorder ? releaseDrag : undefined}
              />
            </FadeIn>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Friendly empty card with an icon, a line of copy and an optional action. */
export function EmptyState({
  title,
  body,
  icon = "sun",
  action,
  onAction,
}: {
  title: string;
  body: string;
  icon?: IconName;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <FadeIn style={[shared.card, shared.empty]}>
      <View style={shared.emptyIcon}>
        <Icon name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={[shared.sectionTitle, s.center]}>{title}</Text>
      <Text style={[shared.subtitle, s.emptyText]}>{body}</Text>
      {action && onAction && (
        <Button secondary icon="plus" title={action} onPress={onAction} />
      )}
    </FadeIn>
  );
}

/** Section header, item rows and the empty state shared by Tasks / Calendar. */
export function PlannerList({
  visible,
  title,
  hint,
  empty = {
    title: "A little breathing room.",
    body: "Your day is open. Add something worth making time for.",
  },
  busy,
  onToggle,
  onOpen,
  onAdd,
  canToggle,
  children,
}: ListHandlers & {
  /** Items to render. */
  visible: Item[];
  title: string;
  hint?: string;
  empty?: { title: string; body: string };
  /** Rendered above the section title (the Tasks search box and filters). */
  children?: React.ReactNode;
}) {
  return (
    <>
      {children}
      <SectionHeading title={title} count={visible.length} hint={hint} />
      {visible.length > 0 ? (
        <ItemRows
          items={visible}
          busy={busy}
          onToggle={onToggle}
          onOpen={onOpen}
          canToggle={canToggle}
        />
      ) : (
        <EmptyState {...empty} action="Make a plan" onAction={onAdd} />
      )}
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    headingWrap: { marginBottom: 10, gap: 2 },
    heading: { flexDirection: "row", alignItems: "center", gap: 8 },
    count: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    countText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.muted,
    },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 22,
    },
    center: { textAlign: "center" },
    /** The row being dragged: above the others, outlined in the accent. */
    lifted: {
      zIndex: 2,
      elevation: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radii.input,
    },
    dot: { width: 9, height: 9, borderRadius: 5 },
    emptyText: { textAlign: "center", marginBottom: 16 },
  }),
);
