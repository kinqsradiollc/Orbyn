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
