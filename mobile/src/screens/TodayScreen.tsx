import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { groupItems, dateLabel, type Item } from "@orbyn/core";
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
  const { today: visible, upcoming, done } = groupItems(items);
  const percent = items.length
    ? Math.round((done.length / items.length) * 100)
    : 0;
  return (
    <>
      <PlannerList
        items={items}
        visible={visible}
        title="Today’s focus"
        {...handlers}
      />
      <View style={shared.card}>
        <Text style={shared.sectionTitle}>Coming into view</Text>
        {upcoming.slice(0, 4).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => handlers.onEdit(item)}
            style={s.upcoming}
          >
            <View style={{ flex: 1 }}>
              <Text style={shared.body}>{item.title}</Text>
              <Text style={shared.small}>
                {dateLabel(item.due_at)} · {item.kind}
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.muted} />
          </Pressable>
        ))}
        {!upcoming.length && (
          <Text style={shared.small}>
            No upcoming plans yet. Your next idea can start here.
          </Text>
        )}
      </View>
      <View style={shared.softCard}>
        <View style={s.badge}>
          <Icon name="sparkles" size={18} color={colors.accent} />
        </View>
        <Text style={shared.eyebrow}>A MIND BESIDE YOURS</Text>
        <Text style={shared.title}>Find your next clear step.</Text>
        <Text style={[shared.subtitle, s.text]}>
          Let’s turn a busy mind into a plan that feels possible.
        </Text>
        <Button
          icon="arrowRight"
          title="Help me plan my day"
          onPress={onPlanDay}
        />
      </View>
      <View style={shared.card}>
        <Text style={shared.sectionTitle}>Your momentum</Text>
        <Text style={shared.title}>{percent}%</Text>
        <Text style={shared.small}>of your plans complete</Text>
        <View
          style={s.progress}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
        >
          <View
            style={{
              width: `${percent}%`,
              height: 5,
              backgroundColor: colors.accent,
            }}
          />
        </View>
        <Text style={shared.small}>
          Progress happens one small step at a time.
        </Text>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  upcoming: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  progress: {
    height: 5,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.accentSoft,
    marginVertical: 16,
  },
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
