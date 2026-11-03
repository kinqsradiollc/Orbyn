import type { AgentRoutine, AiChatSummary, Goal } from "@orbyn/core";

export type Bucket = "now" | "today" | "week" | "later" | "quiet";
export type UpcomingItem =
  | {
      kind: "goal";
      id: string;
      bucket: Bucket;
      at: number;
      when: string;
      goal: Goal;
    }
  | {
      kind: "routine";
      id: string;
      bucket: Bucket;
      at: number;
      when: string;
      routine: AgentRoutine;
      failure: string | null;
    }
  | {
      kind: "chat";
      id: string;
      bucket: Bucket;
      at: number;
      when: string;
      chat: AiChatSummary;
    };

const DAY = 86_400_000;
/** The calendar day of an instant in a zone, as YYYY-MM-DD. */
const dayIn = (at: Date, zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY;

function goalItem(goal: Goal, today: number): UpcomingItem {
  const base = { kind: "goal" as const, id: goal.id, goal };
  if (goal.status !== "active")
    return {
      ...base,
      bucket: "quiet",
      at: 0,
      when: goal.status === "done" ? "Done" : "Paused",
    };
  if (!goal.target_date)
    return { ...base, bucket: "later", at: Infinity, when: "No target date" };
  const target = dayNumber(goal.target_date),
    gap = target - today,
    label = new Date(`${goal.target_date}T12:00:00Z`).toLocaleDateString(
      undefined,
      gap < 7
        ? { weekday: "short", timeZone: "UTC" }
        : { day: "numeric", month: "short", timeZone: "UTC" },
    );
  if (gap < 0)
    return {
      ...base,
      bucket: "now",
      at: target * DAY,
      when: `Overdue ${-gap} ${gap === -1 ? "day" : "days"}`,
    };
  if (gap === 0)
    return { ...base, bucket: "today", at: target * DAY, when: "Due today" };
  return {
    ...base,
    bucket: gap < 7 ? "week" : "later",
    at: target * DAY,
    when: `Target ${label}`,
  };
}

function routineItem(routine: AgentRoutine, now: Date): UpcomingItem {
  const error = routine.last_result?.error;
  const failure = typeof error === "string" && error.trim() ? error : null;
  const base = { kind: "routine" as const, id: routine.id, routine, failure };
  if (failure)
    return { ...base, bucket: "now", at: 0, when: "Last run failed" };
  if (routine.paused)
    return { ...base, bucket: "quiet", at: 0, when: "Paused" };
  const next = new Date(routine.next_run_at),
    zone = routine.timezone,
    gap = dayNumber(dayIn(next, zone)) - dayNumber(dayIn(now, zone)),
    time = next.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    });
  if (gap <= 0)
    return {
      ...base,
      bucket: "today",
      at: next.getTime(),
      when: `Today ${time}`,
    };
  return {
    ...base,
    bucket: gap < 7 ? "week" : "later",
    at: next.getTime(),
    when: `${next.toLocaleDateString(undefined, gap < 7 ? { weekday: "short", timeZone: zone } : { day: "numeric", month: "short", timeZone: zone })} ${time}`,
  };
}

/** Goals, routines and chats waiting on the person, most urgent first. */
export function upcomingItems(
  input: {
    goals: readonly Goal[];
    routines: readonly AgentRoutine[];
    chats: readonly AiChatSummary[];
  },
  zone: string,
  now = new Date(),
): UpcomingItem[] {
  const today = dayNumber(dayIn(now, zone));
  const order: Record<Bucket, number> = {
    now: 0,
    today: 1,
    week: 2,
    later: 3,
    quiet: 4,
  };
  return [
    ...input.chats
      .filter((chat) => chat.active === "needs_you")
      .map((chat): UpcomingItem => ({
        kind: "chat",
        id: chat.id,
        bucket: "now",
        at: -1,
        when: "Waiting on you",
        chat,
      })),
    ...input.goals.map((goal) => goalItem(goal, today)),
    ...input.routines.map((routine) => routineItem(routine, now)),
  ].sort((a, b) => order[a.bucket] - order[b.bucket] || a.at - b.at);
}
