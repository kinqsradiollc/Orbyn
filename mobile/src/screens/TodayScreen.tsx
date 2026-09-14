import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  inProgressEmpty,
  emptyPlans,
  overviewItems,
  statusTones,
  type Item,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import {
  EmptyState,
  ItemRows,
  SectionHeading,
  type ListHandlers,
} from "../components/PlannerList";
import { Bump, FadeIn } from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

const COMING_UP = 5;

/**
 * Overview: four stat cards, then the work that matters now. Each item shows
 * in one section only, the first that applies: Needs attention, In progress,
 * Due today, Coming up.
 */
export function TodayScreen({
  items,
  onPlanDay,
  ...handlers
}: ListHandlers & {
  items: Item[];
  /** Jumps to the assistant and asks it to plan the day. */
  onPlanDay: () => void;
}) {
  const now = new Date();
  const {
    pending: open,
    attention,
    inProgress,
    today: dueToday,
    upcoming,
    doneThisWeek,
    inProgressCount,
    blockedCount,
  } = overviewItems(items, now);
  const comingUp = upcoming.slice(0, COMING_UP);

  const stats = [
    { label: "Open", value: open.length, color: colors.textSoft },
    {
      label: "In progress",
      value: inProgressCount,
      color: statusTones.in_progress.fg,
    },
    {
      label: "Blocked",
      value: blockedCount,
      color: statusTones.blocked.fg,
    },
    {
      label: "Done this week",
      value: doneThisWeek,
      color: statusTones.done.fg,
    },
  ];

  return (
    <>
      <View style={s.stats}>
        {stats.map((stat, n) => (
          <FadeIn key={stat.label} index={n} style={s.statCell}>
            <View
              style={s.stat}
              accessible
              accessibilityLabel={`${stat.label}: ${stat.value}`}
            >
              <View style={s.statTop}>
                <View style={[s.statDot, { backgroundColor: stat.color }]} />
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
              <Bump value={stat.value}>
                <Text style={s.statValue}>{stat.value}</Text>
              </Bump>
            </View>
          </FadeIn>
        ))}
      </View>

      {!items.length ? (
        <EmptyState
          {...emptyPlans}
          action="Make a plan"
          onAction={handlers.onAdd}
        />
      ) : (
        <>
          <Section
            title="In progress"
            hint="Tasks you’ve started"
            items={inProgress}
            empty={inProgressEmpty(inProgressCount)}
            handlers={handlers}
          />
          {attention.length > 0 && (
            <Section
              title="Needs attention"
              hint="Blocked or past due"
              items={attention}
              handlers={handlers}
            />
          )}
          <Section
            title="Due today"
            items={dueToday}
            empty="Nothing else is due today."
            handlers={handlers}
          />
          <Section
            title="Coming up"
            items={comingUp}
            empty="No upcoming plans yet. Your next idea can start here."
            handlers={handlers}
          />
        </>
      )}

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
    </>
  );
}

function Section({
  title,
  hint,
  items,
  empty,
  handlers,
}: {
  title: string;
  hint?: string;
  items: Item[];
  /** Line shown instead of rows when the section is empty. */
  empty?: string;
  handlers: ListHandlers;
}) {
  return (
    <View>
      <SectionHeading title={title} count={items.length} hint={hint} />
      {items.length > 0 ? (
        <ItemRows items={items} {...handlers} />
      ) : (
        <View style={s.emptyRow}>
          <Text style={shared.small}>{empty}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -5,
    marginBottom: 18,
  },
  statCell: { width: "50%", padding: 5 },
  stat: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  statTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  statDot: { width: 7, height: 7, borderRadius: 4 },
  statLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  statValue: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.text,
    marginTop: 4,
  },
  emptyRow: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 22,
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
