import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { byDueDate, sameDay, type Item } from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PlannerList, type ListHandlers } from "../components/PlannerList";
import { colors } from "../theme";
import { shared } from "../styles";

export function TodayScreen({
  items,
  onPlanDay,
  ...handlers
}: ListHandlers & {
  items: Item[];
  /** Jumps to the assistant and asks it to plan the day. */
  onPlanDay: () => void;
}) {
  const today = new Date();
  const visible = items
    .filter(
      (i) =>
        i.status === "todo" && !!i.due_at && sameDay(new Date(i.due_at), today),
    )
    .sort(byDueDate);
  return (
    <>
      <PlannerList
        items={items}
        visible={visible}
        title="Today’s focus"
        {...handlers}
      />
      <View style={shared.softCard}>
        <View style={s.badge}>
          <Icon name="sparkles" size={18} color={colors.accent} />
        </View>
        <Text style={shared.eyebrow}>A MIND BESIDE YOURS</Text>
        <Text style={shared.title}>Find your next clear step.</Text>
        <Text style={[shared.subtitle, s.text]}>
          Turn a busy mind into a plan that feels possible.
        </Text>
        <Button
          icon="arrowRight"
          title="Help me plan my day"
          onPress={onPlanDay}
        />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  text: { marginBottom: 18 },
});
