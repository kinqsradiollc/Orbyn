import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { describeRrule, measureLabel, type Item, type Tag } from "@orbyn/core";
import { Icon, type IconName } from "./Icon";
import { effortLabel } from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import { colors, fonts, radii, themed } from "../theme";

/**
 * List, tags, repeat pattern, assignee and estimate / time spent, as small
 * chips on task rows and in the task sheet. Renders nothing when none apply.
 */
export function PlanningMeta({
  item,
  large = false,
}: {
  item: Item;
  /** Slightly bigger chips for the task sheet. */
  large?: boolean;
}) {
  const { listById, tagById } = usePlanning();
  const list = item.list_id ? listById.get(item.list_id) : undefined;
  const tags = (item.tag_ids ?? [])
    .map((id) => tagById.get(id))
    .filter((t): t is Tag => !!t);
  const repeat = describeRrule(item.rrule);
  const effort = effortLabel(item);
  const assignee = item.assignee_name;
  const measure = measureLabel(item);
  if (!list && !tags.length && !repeat && !effort && !assignee && !measure)
    return null;
  return (
    <View style={s.row}>
      {list && (
        <Meta
          large={large}
          dot={list.color}
          label={list.name}
          spoken={`List: ${list.name}`}
        />
      )}
      {tags.map((t) => (
        <Meta
          key={t.id}
          large={large}
          icon="tag"
          tint={t.color}
          label={t.name}
          spoken={`Tag: ${t.name}`}
        />
      ))}
      {!!repeat && (
        <Meta
          large={large}
          icon="repeat"
          label={repeat}
          spoken={`Repeats: ${repeat}`}
        />
      )}
      {!!assignee && (
        <Meta
          large={large}
          icon="users"
          label={assignee}
          spoken={`Assigned to ${assignee}`}
        />
      )}
      {!!measure && (
        <Meta
          large={large}
          icon="target"
          label={measure}
          spoken={`Number to reach: ${measure}`}
        />
      )}
      {!!effort && (
        <Meta
          large={large}
          icon="target"
          label={effort}
          spoken={`Time: ${effort}`}
        />
      )}
    </View>
  );
}

function Meta({
  label,
  spoken,
  icon,
  dot,
  tint,
  large,
}: {
  label: string;
  spoken: string;
  icon?: IconName;
  dot?: string;
  tint?: string;
  large: boolean;
}) {
  return (
    <View
      style={[s.chip, large && s.chipLarge]}
      accessible
      accessibilityLabel={spoken}
    >
      {dot && <View style={[s.dot, { backgroundColor: dot }]} />}
      {icon && (
        <Icon name={icon} size={large ? 12 : 10} color={tint ?? colors.muted} />
      )}
      <Text numberOfLines={1} style={[s.text, large && s.textLarge]}>
        {label}
      </Text>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 6 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      maxWidth: 200,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.pill,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    chipLarge: { paddingHorizontal: 9, paddingVertical: 4, maxWidth: 260 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    text: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.textSoft,
    },
    textLarge: { fontSize: 13 },
  }),
);
