import React from "react";
import { Text, View } from "react-native";
import { byDueDate, sameDay, type Item } from "@orbyn/core";
import { Button } from "../components/Button";
import { PlannerList, type ListHandlers } from "../components/PlannerList";
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
      <View style={shared.aiCard}>
        <Text style={shared.eyebrow}>A MIND BESIDE YOURS</Text>
        <Text style={shared.title}>Find your next clear step.</Text>
        <Text style={shared.subtitle}>
          Turn a busy mind into a plan that feels possible.
        </Text>
        <Button secondary title="Help me plan my day ↗" onPress={onPlanDay} />
      </View>
    </>
  );
}
