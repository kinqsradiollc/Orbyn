import type { Status } from "./types.js";

/** Platform-neutral visual tokens and product copy used by web and mobile. */
export const colors = {
  background: "#f7f8fa",
  surface: "#ffffff",
  surfaceMuted: "#f3f5f2",
  border: "#e8ece9",
  divider: "#f0f2ef",
  text: "#27382f",
  textSoft: "#526158",
  muted: "#849089",
  faint: "#aab3ad",
  accent: "#376c51",
  accentPressed: "#2c5842",
  accentSoft: "#e7f0ea",
  dot: "#9ab68c",
  soft: "#eef3ec",
  softBorder: "#dde7da",
  danger: "#b0573b",
  dangerSoft: "#fbeee8",
  highBg: "#fbefea",
  highText: "#c28c70",
  mediumBg: "#eef3ec",
  mediumText: "#6d8a6f",
  lowBg: "#f2f4f0",
  lowText: "#96a18b",
  white: "#ffffff",
} as const;

export type ScreenName =
  | "Overview"
  | "My tasks"
  | "Calendar"
  | "AI assistant"
  | "Teams"
  | "Notifications"
  | "Settings"
  | "Admin";
export const screens: Record<
  ScreenName,
  { title: string; subtitle: string; eyebrow: string }
> = {
  Overview: {
    title: "",
    subtitle: "Let's make room for a good day.",
    eyebrow: "A FRESH PERSPECTIVE",
  },
  "My tasks": {
    title: "Small steps. Big things.",
    subtitle: "Everything on your mind, with a place to land.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Calendar: {
    title: "Calendar",
    subtitle: "A little perspective on the days ahead.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  "AI assistant": {
    title: "A little help thinking ahead.",
    subtitle:
      "Summarize your plans, untangle your week, or make a fresh start.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Teams: {
    title: "Plans are better together.",
    subtitle: "Share tasks and events with the people you plan with.",
    eyebrow: "SHARED ORBITS",
  },
  Notifications: {
    title: "Notifications",
    subtitle: "Deadline reminders land here.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Settings: {
    title: "Settings",
    subtitle: "Your space, just the way you like it.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Admin: {
    title: "Workspace admin",
    subtitle: "Accounts, teams, and a record of every change.",
    eyebrow: "WORKSPACE CONTROL",
  },
};
export const screenTitle = (screen: ScreenName, name?: string) =>
  screen === "Overview"
    ? `Hello, ${name?.split(" ")[0] || "there"}.`
    : screens[screen].title;
export const assistantSuggestions = [
  { title: "Summarize my week", hint: "A calm overview of what’s coming" },
  {
    title: "What needs my attention?",
    hint: "Overdue and high-priority items",
  },
  { title: "Help me plan tomorrow", hint: "Turn tomorrow into a doable plan" },
  {
    title: "Add a task to call Mum on Friday at 6pm",
    hint: "Create items in plain language",
  },
];
export const planDayPrompt =
  "Summarize my upcoming plans and suggest what I should focus on.";
export const emptyPlans = {
  title: "Give your ideas a home.",
  body: "Add a task or event to start building your plan.",
};
export const emptySearch = {
  title: "No matching items.",
  body: "Try a different title or a word from your notes.",
};

/** Empty state for a calendar day with nothing planned, on web and mobile. */
export const emptyDay = {
  title: "A little breathing room.",
  body: "No plans for this day. Add something worth making time for.",
};

/** Heading for the selected calendar day, e.g. "Monday, 14 Sep". */
export const dayHeading = (day: Date) =>
  day.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

/**
 * Motion shared by web and mobile so both apps move alike. Durations are in
 * milliseconds; distances in CSS pixels / React Native points. Both apps must
 * skip these animations when the user asks for reduced motion.
 */
export const motion = {
  /** Presses, hovers, checkbox ticks. */
  fast: 140,
  /** Most enter and exit transitions. */
  base: 220,
  /** Screen changes, sheets, and the homepage hero. */
  slow: 360,
  /** Delay between consecutive list items as they appear. */
  stagger: 35,
  /** Items after this index appear without extra delay. */
  maxStagger: 8,
  /** How far an element travels while it enters. */
  distance: 8,
  /** Scale applied while a button or card is pressed. */
  pressScale: 0.97,
  /** Cubic-bezier control points; web uses cubic-bezier(), mobile Easing.bezier(). */
  easeOut: [0.22, 1, 0.36, 1],
  easeInOut: [0.65, 0, 0.35, 1],
} as const;

/** Delay for the nth item in a staggered list. */
export const staggerDelay = (index: number) =>
  Math.min(index, motion.maxStagger) * motion.stagger;

/** Status page wording, shared by web and mobile. */
export const serviceStateLabels = {
  operational: "Operational",
  degraded: "Degraded performance",
  outage: "Outage",
  unknown: "No data yet",
} as const;

export const statusHeadlines = {
  operational: "All systems operational",
  degraded: "Some systems are running slowly",
  outage: "Some systems are down",
  unknown: "Checking our systems",
} as const;

/** "99.98%" for a 0-1 ratio, or an em dash when there is no data. */
export const formatUptime = (ratio: number | null) =>
  ratio === null ? "—" : `${(Math.floor(ratio * 10000) / 100).toFixed(2)}%`;

/** Task status wording and colors, shared by web and mobile. */
export const statusLabels: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const statusTones: Record<Status, { bg: string; fg: string }> = {
  todo: { bg: colors.lowBg, fg: colors.lowText },
  in_progress: { bg: colors.accentSoft, fg: colors.accent },
  blocked: { bg: colors.dangerSoft, fg: colors.danger },
  done: { bg: colors.soft, fg: colors.mediumText },
  cancelled: { bg: colors.surfaceMuted, fg: colors.muted },
};

/**
 * Statuses in the order people move through them. Cancelled isn't a step,
 * so it isn't listed; it closes a task like done does.
 */
export const statusOrder: Status[] = ["todo", "in_progress", "blocked", "done"];

/** Explain why the in-progress section can be empty despite a nonzero total. */
export const inProgressEmpty = (count: number) =>
  count > 0
    ? "Your in-progress work is listed under Needs attention because it is past due."
    : "Nothing underway yet. Open a task and set it to In progress when you start.";
