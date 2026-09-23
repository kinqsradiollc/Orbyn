import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  inProgressEmpty,
  emptyPlans,
  overviewItems,
  type Item,
  type Plan,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { QuickAdd } from "../components/QuickAdd";
import { SmallAction } from "../components/SmallAction";
import { percentOf } from "../lib/progress";
import { ReviewCard } from "../components/ReviewCard";
import {
  EmptyState,
  ItemRows,
  SectionHeading,
  type ListHandlers,
} from "../components/PlannerList";
import { Bump, FadeIn } from "../motion";
import { colors, fonts, radii, themed, statusTones } from "../theme";
import { shared } from "../styles";

const COMING_UP = 5;
/** From this window width the four stat tiles share one row. */
const WIDE = 600;

/**
 * Overview: four stat cards, then the work that matters now. Each item shows
 * in one section only, the first that applies: Needs attention, In progress,
 * Due today, Coming up.
 */
export function TodayScreen({
  items,
  onPlanDay,
  onOpenPlanner,
  onOpenWorkspace,
  userId,
  onQuickAdded,
  onAsk,
  onShowAll,
  ...handlers
}: ListHandlers & {
  items: Item[];
  /** Opens the Tasks tab. */
  onShowAll: () => void;
  userId?: string;
  /** After quick add created something, so the planner reloads. */
  onQuickAdded: (item: Item | null) => void;
  /** Hand quick-add text to the assistant instead. */
  onAsk: (text: string) => void;
  /** Jumps to the assistant and asks it to plan the day. */
  onPlanDay: () => void;
  /** Opens the Plan my day sheet, optionally on a plan to review. */
  onOpenPlanner: (seed: Plan | null) => void;
  /** Opens the agenda, documents or projects sheet. */
  onOpenWorkspace: (what: "agenda" | "docs" | "projects") => void;
}) {
  const now = new Date();
  const wide = useWindowDimensions().width >= WIDE;
  const {
    pending: open,
    attention,
    inProgress,
    today: dueToday,
    upcoming,
    done,
    doneThisWeek,
    inProgressCount,
    blockedCount,
  } = overviewItems(items, now);
  const comingUp = upcoming.slice(0, COMING_UP);
  // Momentum, as on the web: share of plans complete, average open progress.
  const openTasks = open.filter((i) => i.kind === "task");
  const average = openTasks.length
    ? openTasks.reduce((sum, i) => sum + percentOf(i), 0) / openTasks.length
    : 0;
  const completePct = items.length ? (done.length / items.length) * 100 : 0;

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
      <QuickAdd userId={userId} onCreated={onQuickAdded} onAsk={onAsk} />
      <View style={s.stats}>
        {stats.map((stat, n) => (
          <FadeIn
            key={stat.label}
            index={n}
            style={[s.statCell, wide && s.statCellWide]}
          >
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

      {open.some((i) => i.kind === "task") && (
        <FadeIn style={[shared.card, s.plan]}>
          <View style={s.planText}>
            <Text style={shared.sectionTitle}>Plan my day</Text>
            <Text style={shared.small}>
              Fit your open tasks into the free time around your events.
            </Text>
          </View>
          <Button
            title="Plan"
            icon="calendar"
            style={s.planButton}
            onPress={() => onOpenPlanner(null)}
          />
        </FadeIn>
      )}
      <ReviewCard items={items} onPlan={onOpenPlanner} />

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
            emptyAction={{ label: "Plan something", onPress: handlers.onAdd }}
            handlers={handlers}
          />
          <Section
            title="Coming up"
            items={comingUp}
            empty="No upcoming plans yet. Your next idea can start here."
            handlers={handlers}
          />
          <View style={s.allRow}>
            <SmallAction
              label="All tasks"
              disabled={false}
              onPress={onShowAll}
            />
          </View>
          <FadeIn style={shared.card}>
            <Text style={shared.sectionTitle}>Your momentum</Text>
            <View
              style={s.momentumLine}
              accessible
              accessibilityLabel={`${Math.round(completePct)}% of your plans complete`}
            >
              <Text style={s.momentumValue}>{Math.round(completePct)}%</Text>
              <Text style={shared.small}>of your plans complete</Text>
            </View>
            <ProgressBar value={completePct} height={6} />
            <Text style={[shared.small, s.momentumHint]}>
              {openTasks.length
                ? `Open tasks are ${Math.round(average)}% done on average.`
                : "Progress happens one small step at a time."}
            </Text>
          </FadeIn>
        </>
      )}

      <Text style={[shared.eyebrow, s.quickHeading]}>QUICK LINKS</Text>
      <View style={s.quickLinks}>
        {(
          [
            ["agenda", "sun", "Agenda"],
            ["docs", "fileText", "Docs"],
            ["projects", "boxes", "Projects"],
          ] as const
        ).map(([what, icon, title]) => (
          <Pressable
            key={what}
            accessibilityRole="button"
            accessibilityLabel={title}
            style={({ pressed }) => [
              s.quickLink,
              pressed && s.workspacePressed,
            ]}
            onPress={() => onOpenWorkspace(what)}
          >
            <Icon name={icon} size={18} color={colors.accent} />
            <Text style={s.quickText}>{title}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onPlanDay}
        style={({ pressed }) => [
          s.assistantLink,
          pressed && s.workspacePressed,
        ]}
      >
        <Icon name="sparkles" size={18} color={colors.accent} />
        <Text style={s.assistantLinkText}>Need a hand planning? Ask Orbyn</Text>
        <Icon name="arrowRight" size={16} color={colors.accent} />
      </Pressable>
    </>
  );
}

function Section({
  title,
  hint,
  items,
  empty,
  emptyAction,
  handlers,
}: {
  title: string;
  hint?: string;
  items: Item[];
  /** Line shown instead of rows when the section is empty. */
  empty?: string;
  /** A button beside the empty line. */
  emptyAction?: { label: string; onPress: () => void };
  handlers: ListHandlers;
}) {
  return (
    <View>
      <SectionHeading title={title} count={items.length} hint={hint} />
      {items.length > 0 ? (
        <ItemRows items={items} {...handlers} />
      ) : (
        <View style={[s.emptyRow, !!emptyAction && s.emptyWithAction]}>
          <Text style={[shared.small, { flex: 1 }]}>{empty}</Text>
          {emptyAction && (
            <SmallAction
              label={emptyAction.label}
              disabled={handlers.busy}
              onPress={emptyAction.onPress}
            />
          )}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    stats: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginHorizontal: -5,
      marginBottom: 18,
    },
    statCell: { width: "50%", padding: 5 },
    statCellWide: { width: "25%" },
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
    emptyWithAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    allRow: { flexDirection: "row", marginTop: -8, marginBottom: 22 },
    momentumLine: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
      marginTop: 8,
      marginBottom: 10,
    },
    momentumValue: {
      fontFamily: fonts.display,
      fontSize: 26,
      color: colors.text,
    },
    momentumHint: { marginTop: 10 },
    plan: { flexDirection: "row", alignItems: "center", gap: 14 },
    planText: { flex: 1, gap: 3 },
    planButton: { marginBottom: 0 },
    quickHeading: { marginTop: 6 },
    quickLinks: { flexDirection: "row", gap: 8, marginBottom: 10 },
    quickLink: {
      flex: 1,
      minHeight: 72,
      padding: 10,
      gap: 7,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      justifyContent: "center",
    },
    quickText: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
    assistantLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 14,
      marginBottom: 12,
      borderRadius: radii.input,
      backgroundColor: colors.accentSoft,
    },
    workspacePressed: { opacity: 0.6 },
    assistantLinkText: {
      flex: 1,
      color: colors.accent,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
  }),
);
