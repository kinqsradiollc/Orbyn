import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TEAM_ROLE_LABELS, type Team } from "@orbyn/core";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Card of team rows (name, your role, counts, chevron), used by Teams and Admin. */
export function TeamList({
  teams,
  onSelect,
}: {
  teams: Team[];
  onSelect: (team: Team) => void;
}) {
  return (
    <View style={s.list}>
      {teams.map((t, n) => (
        <Pressable
          key={t.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${t.name}`}
          onPress={() => onSelect(t)}
          style={({ pressed }) => [
            s.row,
            n > 0 && s.divider,
            pressed && s.pressed,
          ]}
        >
          <View style={s.icon}>
            <Icon name="users" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>
              {t.name}
            </Text>
            <Text style={shared.small} numberOfLines={1}>
              {plural(t.member_count, "member")} ·{" "}
              {plural(t.item_count, "plan")}
            </Text>
          </View>
          <Pill
            label={t.role ? TEAM_ROLE_LABELS[t.role] : "Not a member"}
            tone={t.role === "owner" || t.role === "admin" ? "accent" : "muted"}
          />
          <Icon name="chevronRight" size={16} color={colors.faint} />
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  list: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: "hidden",
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 2,
  },
});
