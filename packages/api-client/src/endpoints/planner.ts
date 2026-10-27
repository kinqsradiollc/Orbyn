import {
  type AgendaBriefOutcome,
  type AgendaDay,
  agendaPrivatePermission,
  agendaPrivatePermissionInput,
  type AgendaPrivatePermissionInput,
  agendaPrivateSummary,
  type BlockDuplicateInput,
  type BlockInput,
  type BlockOnDayInput,
  type BlockRescheduleInput,
  type CalendarFeed,
  type CalendarFeedSettings,
  type CalendarSubscription,
  type CalendarSubscriptionInput,
  type CalendarView,
  type Doc,
  type EstimateModel,
  type FocusCurrent,
  type FocusSession,
  type FocusState,
  type FocusSummary,
  type Frame,
  type FrameInput,
  type Habit,
  type HabitBlock,
  type HabitCheckInInput,
  type HabitInput,
  type HabitPlan,
  type HabitPlanInput,
  type ItemDetail,
  type Place,
  type PlaceInput,
  type Plan,
  type PlanApplied,
  type PlanApplyInput,
  type PlannedFeed,
  type PlannerAnalytics,
  type PlannerLearning,
  type PlannerPrefs,
  type PlanReality,
  type PlanStaleness,
  type PlanTuneInput,
  type ProgressReport,
  type RevisionPlan,
  type SessionCheckedIn,
  type SessionCheckIn,
  type SessionCheckInInput,
  type TimeBlock,
  type TodayList,
  type UpNext,
  type WhatIfInput,
  type WhatIfResult,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

// ---- lists and tags ----
/**
 * Write today's agenda again from the calendar as it is now, opening with
 * the assistant's summary when a provider is connected. Replaces the
 * page's content. `brief` says whether the assistant wrote one.
 */

export function callRewriteAgenda(this: OrbynClient, timezone?: string) {
  return this.request<Doc & { brief: boolean; briefing?: AgendaBriefOutcome }>(
    "/ai/agenda/today",
    {
      method: "POST",
      body: timezone ? { timezone } : {},
    },
  );
}

/** Read explicit scheduled-plan permission, independently of email/digest preferences. */

export async function callAgendaPrivatePermission(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return agendaPrivatePermission.parse(
    await this.request("/ai/agenda/private-permission", {
      signal,
      fresh: true,
    }),
  );
}

/** Grant/revoke only the reviewed current account/device/model selection. */

export async function callSetAgendaPrivatePermission(
  this: OrbynClient,
  input: AgendaPrivatePermissionInput,
  signal?: AbortSignal,
) {
  return agendaPrivatePermission.parse(
    await this.request("/ai/agenda/private-permission", {
      method: "PUT",
      signal,
      body: agendaPrivatePermissionInput.parse(input),
    }),
  );
}

/** Read private scheduled summary status without exposing execution context. */

export async function callAgendaPrivateSummary(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return agendaPrivateSummary.parse(
    await this.request("/ai/agenda/private-summary", { signal, fresh: true }),
  );
}

/**
 * Today's agenda document, written on first ask each day (a POST: asking
 * writes it). `timezone` is the device's, adopted when you haven't picked
 * one in settings.
 */

export function callAgendaToday(this: OrbynClient, timezone?: string) {
  return this.request<Doc>("/agenda/today", {
    method: "POST",
    body: timezone ? { timezone } : {},
  });
}

/**
 * One day's agenda, for stepping back and forward. Reading never writes:
 * today's page is written on the spot here when it isn't there yet (as
 * `agendaToday` does); another day's `doc` is null until `writeAgenda`
 * writes it.
 */

export async function callAgendaOn(
  this: OrbynClient,
  date: string,
  timezone?: string,
) {
  const day = await this.request<AgendaDay>(`/agenda/${date}`);
  if (day.doc || date !== day.today) return day;
  return { ...day, doc: await this.writeAgenda(date, timezone) };
}

/** Write one day's agenda from the calendar (or get the one written). */

export function callWriteAgenda(
  this: OrbynClient,
  date: string,
  timezone?: string,
) {
  return this.request<Doc>(`/agenda/${date}`, {
    method: "POST",
    body: timezone ? { timezone } : {},
  });
}

/** Tell the server the device's zone; adopted unless you picked one. */

export function callReportTimeZone(this: OrbynClient, timezone: string) {
  return this.request<{ adopted: boolean; timezone: string }>("/me/timezone", {
    method: "POST",
    body: { timezone },
  });
}

// ---- calendar, time blocks, planner ----
/** Everything on the calendar in [from, to): occurrences, blocks, buffers and travel. */

export function callCalendar(this: OrbynClient, from: string, to: string) {
  const q = new URLSearchParams({ from, to });
  return this.request<CalendarView>(`/calendar?${q}`);
}

export function callCreateBlock(this: OrbynClient, input: BlockInput) {
  return this.request<TimeBlock>("/blocks", { method: "POST", body: input });
}

/**
 * A session on a day (a task dropped on a calendar day): the first free
 * working time that day, or a 409 saying there's none.
 */

export function callCreateBlockOnDay(
  this: OrbynClient,
  input: BlockOnDayInput,
) {
  return this.request<TimeBlock>("/blocks", { method: "POST", body: input });
}

export function callDeleteBlock(
  this: OrbynClient,
  id: string,
  expectedRevision?: number,
) {
  return this.request<void>(`/blocks/${id}`, {
    method: "DELETE",
    ...(expectedRevision === undefined
      ? {}
      : { body: { expected_revision: expectedRevision } }),
  });
}

/** Sessions that ended in the last few days and wait for "how did it go?". */

export function callSessionCheckIns(this: OrbynClient) {
  return this.request<SessionCheckIn[]>("/blocks/check-ins");
}

/** Say how a session went: done for today, need more, or skip. */

export function callCheckInSession(
  this: OrbynClient,
  id: string,
  input: SessionCheckInInput,
) {
  return this.request<SessionCheckedIn>(`/blocks/${id}/check-in`, {
    method: "POST",
    body: input,
  });
}

/**
 * Move a block to the next free working time of the same length, one that
 * ends by its task's deadline when there is one. With `before_deadline`,
 * only such a time will do (409 when there's none).
 */

export function callRescheduleBlock(
  this: OrbynClient,
  id: string,
  input: BlockRescheduleInput = {},
) {
  return this.request<TimeBlock>(`/blocks/${id}/reschedule`, {
    method: "POST",
    body: input,
  });
}

/** Another block for the same task and length, at `start_at` or the next free time after it. */

export function callDuplicateBlock(
  this: OrbynClient,
  id: string,
  input: BlockDuplicateInput = {},
) {
  return this.request<TimeBlock>(`/blocks/${id}/duplicate`, {
    method: "POST",
    body: input,
  });
}

/** Where your set-aside time went over the last `days`. */

export function callGetAnalytics(this: OrbynClient, days = 30) {
  return this.request<PlannerAnalytics>(`/planner/analytics?days=${days}`);
}

export function callGetPlannerPrefs(this: OrbynClient) {
  return this.request<PlannerPrefs>("/planner/prefs");
}

/** What the planner has learned about how long your tasks really take. */

export function callGetEstimates(this: OrbynClient) {
  return this.request<EstimateModel>("/planner/estimates");
}

/** Everything the planner has learned from your history. */

export function callGetLearning(this: OrbynClient) {
  return this.request<PlannerLearning>("/planner/learning");
}

/** What to do now: the free time until your next event and tasks for it. */

export function callGetUpNext(this: OrbynClient) {
  return this.request<UpNext>("/planner/next");
}

/**
 * Today, planned and due in one list: events, your sessions, tasks due
 * today and late ones, and unfinished sessions from earlier days. The day
 * is your account's (the planner zone, as the agenda has it); `timezone`
 * (pass the device's) counts only while the account has none of its own.
 */

export function callToday(this: OrbynClient, timezone?: string) {
  const q = timezone ? `?${new URLSearchParams({ timezone })}` : "";
  return this.request<TodayList>(`/today${q}`);
}

/**
 * Your planned time, task by task, with each task's status: some tasks
 * (`item_ids`), or every open task that's yours to plan plus any with a
 * session in the window (`from`, `to`), whose sessions each lists.
 */

export function callPlanned(
  this: OrbynClient,
  options: { item_ids?: string[]; from?: string; to?: string } = {},
) {
  const q = new URLSearchParams();
  if (options.item_ids?.length) q.set("item_ids", options.item_ids.join(","));
  if (options.from && options.to) {
    q.set("from", options.from);
    q.set("to", options.to);
  }
  const text = q.toString();
  return this.request<PlannedFeed>(`/planned${text ? `?${text}` : ""}`);
}

/** Email yourself a digest now, to preview it. */

export function callSendTestDigest(
  this: OrbynClient,
  kind: "morning" | "evening" = "morning",
) {
  return this.request<void>("/planner/digest/test", {
    method: "POST",
    body: { kind },
  });
}

export function callCreateFrame(this: OrbynClient, input: FrameInput) {
  return this.request<Frame>("/planner/frames", {
    method: "POST",
    body: input,
  });
}

export function callDeleteFrame(this: OrbynClient, id: string) {
  return this.request<void>(`/planner/frames/${id}`, { method: "DELETE" });
}

export function callCreateHabit(this: OrbynClient, input: HabitInput) {
  return this.request<Habit>("/planner/habits", {
    method: "POST",
    body: input,
  });
}

export function callDeleteHabit(this: OrbynClient, id: string) {
  return this.request<void>(`/planner/habits/${id}`, { method: "DELETE" });
}

/** Propose sessions for the active habits; nothing is saved. */

export function callPlanHabits(this: OrbynClient, input: HabitPlanInput = {}) {
  return this.request<HabitPlan>("/planner/habits/plan", {
    method: "POST",
    body: input,
  });
}

/** Save proposed sessions, skipping any that now clash. */

export function callApplyHabitPlan(
  this: OrbynClient,
  blocks: { habit_id: string; start_at: string; end_at: string }[],
) {
  return this.request<HabitBlock[]>("/planner/habits/plan/apply", {
    method: "POST",
    body: { blocks },
  });
}

/** Record a habit session, or undo it against its current version. */

export function callGetHabitBlock(this: OrbynClient, id: string) {
  return this.request<{
    id: string;
    outcome: "done" | "skipped" | null;
    outcome_at: string | null;
    version: number;
  }>(`/planner/habits/blocks/${id}`);
}

export function callCheckInHabitBlock(
  this: OrbynClient,
  id: string,
  input: HabitCheckInInput,
) {
  return this.request<{
    id: string;
    outcome: "done" | "skipped" | null;
    outcome_at: string | null;
    version: number;
  }>(`/planner/habits/blocks/${id}/check-in`, {
    method: "POST",
    body: input,
  });
}

export function callDeleteHabitBlock(
  this: OrbynClient,
  id: string,
  version?: number,
) {
  const query = version === undefined ? "" : `?version=${version}`;
  return this.request<void>(`/planner/habits/blocks/${id}${query}`, {
    method: "DELETE",
  });
}

/** Skip one date ("YYYY-MM-DD") of a frame. */

export function callSkipFrame(this: OrbynClient, id: string, date: string) {
  return this.request<Frame>(`/planner/frames/${id}/skip`, {
    method: "POST",
    body: { date },
  });
}

/** Bring back a skipped date of a frame. */

export function callUnskipFrame(this: OrbynClient, id: string, date: string) {
  return this.request<Frame>(`/planner/frames/${id}/unskip`, {
    method: "POST",
    body: { date },
  });
}

export function callCreatePlace(this: OrbynClient, input: PlaceInput) {
  return this.request<Place>("/planner/places", {
    method: "POST",
    body: input,
  });
}

export function callDeletePlace(this: OrbynClient, id: string) {
  return this.request<void>(`/planner/places/${id}`, { method: "DELETE" });
}

export function callGetPlan(this: OrbynClient, id: string) {
  return this.request<Plan>(`/planner/plans/${id}`);
}

/** Tune a plan (tasks in or out, estimates, pinned blocks, keep-free, scope); returns the new plan that replaces it. */

export function callTunePlan(
  this: OrbynClient,
  id: string,
  input: PlanTuneInput,
) {
  return this.request<Plan>(`/planner/plans/${id}`, {
    method: "PATCH",
    body: input,
  });
}

/** Whether the calendar or tasks changed since the plan was made. */

export function callPlanStale(this: OrbynClient, id: string) {
  return this.request<PlanStaleness>(`/planner/plans/${id}/stale`);
}

/**
 * Save a plan: its new sessions, and the late sessions to move before
 * their deadline (`moves`, block ids; the ones the planner ticked when
 * omitted).
 */

export function callApplyPlan(
  this: OrbynClient,
  id: string,
  input: PlanApplyInput = {},
) {
  return this.request<PlanApplied>(`/planner/plans/${id}/apply`, {
    method: "POST",
    body: input,
  });
}

/** A plan for unfinished work (all of it, or the given blocks). */

export function callRollForward(this: OrbynClient, blockIds?: string[]) {
  return this.request<Plan>("/planner/roll-forward", {
    method: "POST",
    body: blockIds ? { block_ids: blockIds } : {},
  });
}

/**
 * Create (or replace) your private calendar subscription link, or with
 * `busy: true` the link that only shows when you're busy.
 */

export function callCreateCalendarFeed(
  this: OrbynClient,
  options: { busy?: boolean } = {},
) {
  return this.request<CalendarFeed>("/me/calendar-feed", {
    method: "POST",
    body: options.busy ? { busy: true } : {},
  });
}

export function callDeleteCalendarFeed(
  this: OrbynClient,
  options: { busy?: boolean } = {},
) {
  return this.request<void>(
    `/me/calendar-feed${options.busy ? "?busy=1" : ""}`,
    { method: "DELETE" },
  );
}

/** Which feed links are on, and whether the feed includes time blocks. */

export function callCalendarFeedSettings(this: OrbynClient) {
  return this.request<CalendarFeedSettings>("/me/calendar-feed");
}

export function callCreateCalendarSubscription(
  this: OrbynClient,
  input: CalendarSubscriptionInput,
) {
  return this.request<CalendarSubscription>("/me/calendar-subscriptions", {
    method: "POST",
    body: input,
  });
}

export function callDeleteCalendarSubscription(this: OrbynClient, id: string) {
  return this.request<void>(`/me/calendar-subscriptions/${id}`, {
    method: "DELETE",
  });
}

/** Fetch it now instead of waiting for the hourly refresh. */

export function callRefreshCalendarSubscription(this: OrbynClient, id: string) {
  return this.request<CalendarSubscription>(
    `/me/calendar-subscriptions/${id}/refresh`,
    { method: "POST" },
  );
}

/** Revision sessions before an exam, proposed into free time (nothing saved). */

export function callPlanRevision(
  this: OrbynClient,
  input: { key: string; minutes?: number; timezone: string },
) {
  return this.request<RevisionPlan>("/study/revision/plan", {
    method: "POST",
    body: input,
  });
}

// ---- focus sessions ------------------------------------------------------

/** Keep a finished (or cut short) phase; work minutes go to the task. */

export function callSaveFocusSession(
  this: OrbynClient,
  input: Omit<FocusSession, "item_title">,
) {
  return this.request<{ session: FocusSession; item: ItemDetail | null }>(
    "/focus/sessions",
    { method: "POST", body: input },
  );
}

export function callFocusSummary(this: OrbynClient, from: Date, to: Date) {
  const q = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return this.request<FocusSummary>(`/focus/summary?${q}`);
}

export function callCurrentFocus(this: OrbynClient) {
  return this.request<FocusCurrent | null>("/focus/current");
}

/** Share the session running here with your other devices. */

export function callSetCurrentFocus(
  this: OrbynClient,
  state: FocusState,
  device?: string,
  deviceId?: string,
) {
  return this.request<FocusCurrent>("/focus/current", {
    method: "PUT",
    body: {
      state,
      ...(device ? { device } : {}),
      ...(deviceId ? { device_id: deviceId } : {}),
    },
  });
}

export function callClearCurrentFocus(this: OrbynClient) {
  return this.request<void>("/focus/current", { method: "DELETE" });
}

// ---- follow-through ------------------------------------------------------

/** How much of what was planned lately got done, by weekday. */

export function callPlanReality(this: OrbynClient) {
  return this.request<PlanReality>("/planner/reality");
}

/** What a change would do to the coming days. Nothing is saved. */

export function callWhatIf(this: OrbynClient, input: WhatIfInput) {
  return this.request<WhatIfResult>("/planner/what-if", {
    method: "POST",
    body: input,
  });
}

/** What got done between two times, with its proof; a team's, or yours. */

export function callProgress(
  this: OrbynClient,
  from: Date,
  to: Date,
  teamId?: string,
) {
  const q = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    ...(teamId ? { team_id: teamId } : {}),
  });
  return this.request<ProgressReport>(`/progress?${q}`);
}
