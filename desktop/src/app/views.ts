import {
  Bell,
  Brain,
  House,
  CalendarCheck,
  ListChecks,
  Inbox,
  ShieldCheck,
  Sparkles,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { screens, screenTitle, type ScreenName } from "@orbyn/core";
import { CONCEPT_ICON } from "./concept-icons";

export type View =
  | ScreenName
  | "Lists"
  | "Agenda"
  | "Docs"
  | "Memory"
  | "Agent"
  | "Study"
  | "Projects"
  | "Booking"
  | "Review"
  | "Background"
  | "Overnight"
  | "Views";

type Screen = { title: string; subtitle: string; eyebrow: string };

/** Headings for every view: the shared ones plus the web-only ones. */
export const SCREENS: Record<View, Screen> = {
  ...screens,
  Background: {
    title: "Background",
    subtitle: "",
    eyebrow: "",
  },
  Overnight: {
    title: "Overnight",
    subtitle: "",
    eyebrow: "",
  },
  Lists: {
    title: "Lists",
    subtitle: "",
    eyebrow: "",
  },
  Agenda: {
    title: "Agenda",
    subtitle: "",
    eyebrow: "",
  },
  Projects: {
    title: "Projects",
    subtitle: "",
    eyebrow: "",
  },
  Docs: {
    title: "Documents",
    subtitle: "",
    eyebrow: "",
  },
  Memory: {
    title: "Memory",
    subtitle: "",
    eyebrow: "",
  },
  Agent: {
    title: "Agent notes",
    subtitle: "",
    eyebrow: "",
  },
  Study: {
    title: "Study",
    subtitle: "",
    eyebrow: "",
  },
  Review: {
    title: "Review",
    subtitle: "",
    eyebrow: "",
  },
  Views: {
    title: "Views",
    subtitle: "",
    eyebrow: "",
  },
  Booking: {
    title: "Booking pages",
    subtitle: "",
    eyebrow: "",
  },
};

export const viewTitle = (view: View, name?: string) =>
  view === "Overview" ? screenTitle(view, name) : SCREENS[view].title;

export type NavEntry = { label: View; icon: LucideIcon; adminOnly?: boolean };

/** Route keys remain stable for links, commands, tabs and account preferences. */
export const NAV_GROUPS: { label: string; items: NavEntry[] }[] = [
  {
    label: "WORKSPACE",
    items: [
      { label: "Overview", icon: House },
      { label: "My tasks", icon: CONCEPT_ICON.task },
      { label: "Calendar", icon: CONCEPT_ICON.event },
      { label: "Docs", icon: CONCEPT_ICON.page },
      { label: "AI assistant", icon: Sparkles },
    ],
  },
  {
    label: "WORK",
    items: [
      { label: "Projects", icon: CONCEPT_ICON.project },
      { label: "Views", icon: Table2 },
      { label: "Lists", icon: ListChecks },
    ],
  },
  {
    label: "LIBRARY",
    items: [
      { label: "Agenda", icon: CONCEPT_ICON.agenda },
      { label: "Memory", icon: Brain },
      { label: "Agent", icon: Sparkles },
    ],
  },
  {
    label: "AGENTS",
    items: [
      { label: "Background", icon: Sparkles },
      { label: "Overnight", icon: Sparkles },
      { label: "Review", icon: Inbox },
    ],
  },
  {
    label: "MORE",
    items: [
      { label: "Study", icon: CONCEPT_ICON.study },
      { label: "Teams", icon: Users },
      { label: "Booking", icon: CalendarCheck },
      { label: "Notifications", icon: Bell },
      { label: "Admin", icon: ShieldCheck, adminOnly: true },
    ],
  },
];

/** Existing custom arrangements keep their original groups and order. */
export const LEGACY_NAV_GROUPS = [
  { label: "TODAY", items: ["Overview", "Agenda", "My tasks", "Calendar"] },
  {
    label: "YOUR WORK",
    items: [
      "Projects",
      "Docs",
      "Memory",
      "Agent",
      "Views",
      "Study",
      "Lists",
      "AI assistant",
    ],
  },
  {
    label: "SHARED",
    items: ["Teams", "Booking", "Notifications", "Review", "Admin"],
  },
].map((group) => ({
  ...group,
  items: group.items.map((label) =>
    NAV_GROUPS.flatMap((g) => g.items).find((entry) => entry.label === label)!,
  ),
}));

/** The selected category also exposes its existing specialist destinations. */
export function navSection(view: View): View {
  if (["Projects", "Views", "Lists"].includes(view)) return "My tasks";
  if (["Agenda", "Memory", "Agent"].includes(view)) return "Docs";
  if (["Background", "Overnight", "Review"].includes(view))
    return "AI assistant";
  return view;
}

export function navName(view: View, _agentName?: string): string {
  if (view === "Overview") return "Today";
  if (view === "My tasks") return "Work";
  if (view === "Docs") return "Library";
  if (view === "AI assistant") return "Agents";
  if (view === "Agenda") return "Daily brief";
  if (view === "Agent") return "Agent notes";
  return view;
}

export const NAV: NavEntry[] = NAV_GROUPS.flatMap((g) => g.items);

/** Views whose heading does not offer the "New item" button. */
export const VIEWS_WITHOUT_NEW_ITEM: View[] = [
  "Settings",
  "Docs",
  "Memory",
  "Agent",
  "Study",
  "Agenda",
  "Projects",
  "AI assistant",
  "Notifications",
  "Review",
  "Background",
  "Overnight",
  "Teams",
  "Admin",
  "Booking",
  "Views",
];
