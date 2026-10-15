import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { TEAM_ROLE_LABELS, type Team } from "@orbyn/core";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { Pressable } from "../motion";
import { colors, fonts, themed } from "../theme";
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
        <View key={t.id}>
          <Pressable
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
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name}>{t.name}</Text>
              <Text style={shared.small}>
                {plural(t.member_count, "member")} ·{" "}
                {plural(t.item_count, "item")}
              </Text>
              <View style={{ alignSelf: "flex-start", marginTop: 4 }}>
                <Pill
                  label={t.role ? TEAM_ROLE_LABELS[t.role] : "Not a member"}
                  tone={
                    t.role === "owner" || t.role === "admin"
                      ? "accent"
                      : "muted"
                  }
                />
              </View>
            </View>
            <Icon name="chevronRight" size={16} color={colors.faint} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: {
      marginBottom: 16,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      minHeight: 44,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    icon: {
      width: 32,
      height: 32,

      alignItems: "center",
      justifyContent: "center",
    },
    name: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
  }),
);
