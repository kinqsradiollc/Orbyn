import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Item } from "@orbyn/core";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { ItemCard } from "./ItemCard";
import { FadeIn } from "../motion";
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
};

/** Section heading with a count badge, used above every list of items. */
export function SectionHeading({
  title,
  count,
  hint,
}: {
  title: string;
  count?: number;
  /** Short line under the heading, e.g. "Blocked or past due". */
  hint?: string;
}) {
  return (
    <View style={s.headingWrap}>
      <View style={s.heading} accessibilityRole="header">
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

/** Rows of `ItemCard` in one bordered card. */
export function ItemRows({
  items,
  busy,
  onToggle,
  onOpen,
  canToggle,
}: Omit<ListHandlers, "onAdd"> & { items: Item[] }) {
  return (
    <View style={s.list}>
      {items.map((i, n) => (
        <FadeIn key={i.id} index={n}>
          <ItemCard
            item={i}
            busy={busy}
            first={n === 0}
            readOnly={canToggle ? !canToggle(i) : false}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        </FadeIn>
      ))}
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
    emptyText: { textAlign: "center", marginBottom: 16 },
  }),
);
