import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  emptyPlans,
  overviewItems,
  todayIsCurrent,
  type HomeLayout,
  type WorkspacePreset,
  type Item,
  type Plan,
  type StudyOverview,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { client } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { ProgressBar } from "../../components/ProgressBar";
import { QuickAdd } from "../planner/QuickAdd";
import { SmallAction } from "../../components/SmallAction";
import { percentOf } from "../progress/progress";
import { ReviewCard } from "../review/ReviewCard";
import { MorningReview } from "./MorningReview";
import { TodayCard } from "./TodayCard";
import { AssistantIdeasCard } from "../assistant/AssistantIdeasCard";
import { HomeSection } from "./Home";
import { UpNextCard } from "./UpNextCard";
import { usePlanned } from "../planner/plannedContext";
import {
  EmptyState,
  ItemRows,
  SectionHeading,
  type ListHandlers,
} from "../planner/PlannerList";
import { Pressable } from "../../motion";
import { usePaneWidth } from "../../hooks/usePaneWidth";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { colors, fonts, radii, themed, statusTones } from "../../theme";
import { shared } from "../../styles";

const COMING_UP = 5;
/** From this window width the four stat tiles share one row. */
const WIDE = 600;

/**
 * Overview: four stat cards, Up next, then Today (planned and due in one
 * list), Plan my day, and the work that matters now. Each item shows in one
 * section only, the first that applies: Needs attention, In progress, Coming
 * up (and Due today, on a server without the Today list).
 */
export function TodayScreen({
  canOpenAgentOutput,
  onOpenAgentOutput,
  onOpenAgentActivity,
  onOpenAgentReview,
  items,
  onPlanDay,
  onOpenPlanner,
  onOpenWorkspace,
  userId,
  onQuickAdded,
  onAsk,
  quickAddPrefill,
  onQuickAddPrefillUsed,
  onShowAll,
  onFocus,
  onOpenById,
  onPlanTask,
  onPlanAgain,
  onOpenCalendar,
  homeLayout,
  presets = [],
  agentName,
  conversationEnabled,
  onOpenLink,
  ...handlers
}: ListHandlers & {
  canOpenAgentOutput: boolean;
  onOpenAgentOutput: (id: string) => void;
  onOpenAgentActivity: (lane: "background" | "overnight") => void;
  onOpenAgentReview: () => void;
  /** Home's layout (W1): its hubs and which panels show, in order. */
  homeLayout?: HomeLayout;
  presets?: WorkspacePreset[];
  /** The assistant's name, for Upcoming. */
  agentName: string;
  conversationEnabled: boolean;
  /** Opens a project, page or saved view from a hub or the brief. */
  onOpenLink: (
    link:
      { kind: "project" | "doc" | "view"; id: string } | { kind: "overnight" },
  ) => void;
  items: Item[];
  /** Starts focus mode on a task. */
  onFocus: (item: Item) => void;
  /** Opens a task or event by id (from the Today list). */
  onOpenById: (id: string) => void;
  /** "Plan it": plans a task, looking ahead as far as its deadline. */
  onPlanTask: (itemId: string) => void;
  /** "Plan again": a plan for an unfinished session's work. */
  onPlanAgain: (blockId: string) => void;
  /** Opens the Calendar tab. */
  onOpenCalendar: () => void;
  /** Opens the Tasks tab. */
  onShowAll: () => void;
  userId?: string;
  /** After quick add created something, so the planner reloads. */
  onQuickAdded: (item: Item | null) => void;
  /** Words from an add link, put in quick add to confirm. */
  quickAddPrefill?: { text: string; key: number } | null;
  /** Quick add took the link's words: they are let go. */
  onQuickAddPrefillUsed?: () => void;
  /** Hand quick-add text to the assistant instead. */
  onAsk: (text: string) => void;
  /** Jumps to the assistant and asks it to plan the day. */
  onPlanDay: () => void;
  /** Opens the Plan my day sheet, optionally on a plan to review. */
  onOpenPlanner: (seed: Plan | null) => void;
  /** Opens the agenda, documents or projects sheet. */
  onOpenWorkspace: (what: "agenda" | "docs" | "projects" | "study") => void;
}) {
  const now = new Date();
  const { width, onLayout } = usePaneWidth();
  const wide = width >= WIDE;
  const { today: todayList } = usePlanned();
  // The Today list covers what's due; a server without it, or a list saved
  // for another day, gets the Due today section as before.
  const todayShown = !!todayList && todayIsCurrent(todayList, now);
  /** Focus on a task by id: the listed copy, else the task opens instead. */
  const focusById = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) onFocus(item);
    else onOpenById(id);
  };
  // Cards due and the next exam, for people who study in Orbyn.
  const [studyReceipt, setStudy] = useState<{
    owner: string;
    data: StudyOverview;
  } | null>(null);
  const study =
    studyReceipt?.owner === session.token ? studyReceipt.data : null;
  const [studyError, setStudyError] = useState("");
  const [studyRetry, setStudyRetry] = useState(0);
  useEffect(() => {
    let live = true;
    const owner = session.token;
    setStudyError("");
    void client.study().then(
      (next) => {
        if (live && session.token === owner) setStudy({ owner, data: next });
      },
      (failure) => {
        if (live && session.token === owner) setStudyError(errorText(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [items.length, userId, studyRetry]);
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
  const dailyIds = new Set(
    todayShown
      ? todayList!.rows.map((row) => row.item_id)
      : dueToday.map((item) => item.id),
  );
  const decisions = attention.filter((item) => !dailyIds.has(item.id));
  const decisionIds = new Set(decisions.map((item) => item.id));
  const continuing = inProgress.filter(
    (item) => !dailyIds.has(item.id) && !decisionIds.has(item.id),
  );
  const continuingIds = new Set(continuing.map((item) => item.id));
  const comingUp = upcoming
    .filter(
      (item) =>
        !dailyIds.has(item.id) &&
        !decisionIds.has(item.id) &&
        !continuingIds.has(item.id),
    )
    .slice(0, COMING_UP);
  const shownIds = new Set(
    [
      ...dailyIds,
      ...decisionIds,
      ...continuingIds,
      ...comingUp.map((item) => item.id),
    ].filter((id): id is string => !!id),
  );
  const engineer = presets.includes("engineer");
  const student = presets.includes("student");
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
    <View onLayout={onLayout}>
      <QuickAdd
        userId={userId}
        onCreated={onQuickAdded}
        onAsk={onAsk}
        prefill={quickAddPrefill}
        onPrefillUsed={onQuickAddPrefillUsed}
      />
      {(engineer || student) && (
        <View style={s.presetLinks}>
          <Text style={shared.sectionTitle} accessibilityRole="header">
            Your workspaces
          </Text>
          <View style={s.quickLinks}>
            <Button
              title={
                engineer && student
                  ? "Projects & courses"
                  : engineer
                    ? "Project work"
                    : "Course projects"
              }
              onPress={() => onOpenWorkspace("projects")}
            />
            {engineer && (
              <Button
                title="Specifications & decisions"
                onPress={() => onOpenWorkspace("docs")}
              />
            )}
            {student && (
              <Button
                title="Review material"
                onPress={() => onOpenWorkspace("study")}
              />
            )}
          </View>
        </View>
      )}
      <MorningReview
        onOpenPage={(id) => onOpenLink({ kind: "doc", id })}
        onOpenReview={onOpenAgentReview}
        onOpenActivity={onOpenAgentActivity}
        onOpenChat={canOpenAgentOutput ? onOpenAgentOutput : undefined}
      />
      <View style={s.stats}>
        {stats.map((stat) => (
          <View key={stat.label} style={[s.statCell, wide && s.statCellWide]}>
            <View
              style={s.stat}
              accessible
              accessibilityLabel={`${stat.label}: ${stat.value}`}
            >
              <View style={s.statTop}>
                <View style={[s.statDot, { backgroundColor: stat.color }]} />
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
              <Text style={s.statValue}>{stat.value}</Text>
            </View>
          </View>
        ))}
      </View>

      {items.length > 0 && (
        <TodayCard
          today={todayList}
          items={items}
          busy={handlers.busy}
          onOpen={onOpenById}
          onFocus={focusById}
          onPlanIt={onPlanTask}
          onPlanAgain={onPlanAgain}
          onOpenCalendar={onOpenCalendar}
          onCheckedIn={() => onQuickAdded(null)}
        />
      )}
      {open.some((i) => i.kind === "task") && (
        <UpNextCard
          items={items}
          excludeIds={shownIds}
          onOpen={handlers.onOpen}
          onFocus={onFocus}
        />
      )}
      <HomeSection
        conversationEnabled={conversationEnabled}
        canOpenAgentOutput={canOpenAgentOutput}
        onOpenAgentOutput={onOpenAgentOutput}
        layout={homeLayout}
        agentName={agentName}
        onOpenLink={onOpenLink}
        onOpenStudy={() => onOpenWorkspace("study")}
        onOpenDoc={(id) => onOpenLink({ kind: "doc", id })}
      />
      <AssistantIdeasCard />
      {open.some((i) => i.kind === "task") && (
        <View style={[shared.card, s.plan]}>
          <View style={s.planText}>
            <Text style={shared.sectionTitle}>Plan my day</Text>
          </View>
          <Button
            title="Plan"
            icon="calendar"
            style={s.planButton}
            onPress={() => onOpenPlanner(null)}
          />
        </View>
      )}
      <ReviewCard
        items={items}
        onPlan={onOpenPlanner}
        showUnfinished={!todayShown}
      />

      {!items.length ? (
        <EmptyState
          {...emptyPlans}
          action="Make a plan"
          onAction={handlers.onAdd}
        />
      ) : (
        <>
          {decisions.length > 0 && (
            <Section
              title="Needs a decision"
              items={decisions}
              handlers={handlers}
            />
          )}
          {continuing.length > 0 && (
            <Section
              title="Continue work"
              items={continuing}
              handlers={handlers}
            />
          )}
          {!todayShown && (
            <Section
              title="Due today"
              items={dueToday}
              empty="Nothing else is due today."
              emptyAction={{ label: "Plan something", onPress: handlers.onAdd }}
              handlers={handlers}
            />
          )}
          <Section
            title="Coming up"
            items={comingUp}
            empty="Nothing coming up."
            handlers={handlers}
          />
          <View style={s.allRow}>
            <SmallAction
              label="All tasks"
              disabled={false}
              onPress={onShowAll}
            />
          </View>
          <View style={shared.card}>
            <Text style={shared.sectionTitle}>Progress</Text>
            <View
              style={s.momentumLine}
              accessible
              accessibilityLabel={`${Math.round(completePct)}% of items completed`}
            >
              <Text style={s.momentumValue}>{Math.round(completePct)}%</Text>
              <Text style={shared.small}>of items completed</Text>
            </View>
            <ProgressBar value={completePct} height={6} />
            <Text style={[shared.small, s.momentumHint]}>
              {openTasks.length
                ? `Open tasks average ${Math.round(average)}% reported progress.`
                : "No open tasks."}
            </Text>
          </View>
        </>
      )}

      {!!studyError && (
        <View style={s.studyError}>
          <Text accessibilityRole="alert" style={shared.small}>
            Couldn't load study activity.
          </Text>
          <SmallAction
            label="Retry"
            disabled={false}
            onPress={() => setStudyRetry((value) => value + 1)}
          />
        </View>
      )}
      {study && study.decks.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenWorkspace("study")}
          style={({ pressed }) => [
            s.assistantLink,
            pressed && s.workspacePressed,
          ]}
        >
          <Icon name="graduationCap" size={18} color={colors.accent} />
          <Text style={s.assistantLinkText}>
            {study.due_today + study.new_cards
              ? `${study.due_today + study.new_cards} card${study.due_today + study.new_cards === 1 ? "" : "s"} to review`
              : "Study: all caught up"}
            {study.exams[0]
              ? ` · ${study.exams[0].title} in ${study.exams[0].days_left}d`
              : ""}
          </Text>
          <Icon name="arrowRight" size={16} color={colors.accent} />
        </Pressable>
      )}

      <Text style={[shared.eyebrow, s.quickHeading]}>Quick links</Text>
      <View style={s.quickLinks}>
        {(
          [
            ["agenda", "newspaper", "Agenda"],
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
        <Text style={s.assistantLinkText}>Ask Orbyn to plan</Text>
        <Icon name="arrowRight" size={16} color={colors.accent} />
      </Pressable>
    </View>
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
    presetLinks: { gap: 10, marginBottom: 16 },
    stats: {
      flexDirection: "row",
      flexWrap: "wrap",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      paddingVertical: 6,
      marginBottom: 24,
    },
    statCell: { width: "50%", padding: 6 },
    statCellWide: { width: "25%" },
    stat: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingVertical: 4,
      paddingHorizontal: 4,
    },
    statTop: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 7,
    },
    statDot: { width: 7, height: 7, borderRadius: 4 },
    statLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    statValue: {
      fontFamily: fonts.bold,
      fontSize: 18,
      color: colors.text,
      marginTop: 0,
    },
    emptyRow: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
      borderRadius: radii.card,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    emptyWithAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    allRow: { flexDirection: "row", marginTop: -8, marginBottom: 16 },
    momentumLine: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "baseline",
      gap: 8,
      marginTop: 8,
      marginBottom: 10,
    },
    momentumValue: {
      fontFamily: fonts.bold,
      fontSize: 18,
      color: colors.text,
    },
    momentumHint: { marginTop: 10 },
    plan: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 14,
    },
    planText: { flex: 1, minWidth: 100, gap: 3 },
    planButton: { marginBottom: 0 },
    quickHeading: { marginTop: 6 },
    quickLinks: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 10,
    },
    quickLink: {
      flex: 1,
      minWidth: 80,
      minHeight: 44,
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
      paddingVertical: 8,
      marginBottom: 12,
      borderRadius: radii.input,
      backgroundColor: colors.accentSoft,
    },
    workspacePressed: { opacity: 0.6 },
    assistantLinkText: {
      flex: 1,
      minWidth: 0,
      color: colors.accent,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
    studyError: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginBottom: 12,
    },
  }),
);
