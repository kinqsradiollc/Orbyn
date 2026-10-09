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
    subtitle: "Your agent's current work and results.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Overnight: {
    title: "Overnight",
    subtitle: "Review what your assistant worked on while you were away.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Lists: {
    title: "Lists",
    subtitle: "Group tasks the way you think about them.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Agenda: {
    title: "Agenda",
    subtitle: "Today at a glance, written for you — and yours to edit.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Projects: {
    title: "Projects",
    subtitle:
      "Group related tasks into stages and see a piece of work end to end.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Docs: {
    title: "Documents",
    subtitle:
      "Notes, briefs and working pages — with formulas that render as you type.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Memory: {
    title: "Memory",
    subtitle:
      "What your agent remembers, with the sources you can edit or forget.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Agent: {
    title: "Agent notes",
    subtitle: "Notes your agent has made for its work.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Study: {
    title: "Study",
    subtitle:
      "Flashcards from your own pages, reviewed at the right time and planned around your exams.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Review: {
    title: "Review",
    subtitle:
      "Changes your connected agents and the assistant suggest, waiting for you to approve.",
    eyebrow: "SHARED ORBITS",
  },
  Views: {
    title: "Views",
    subtitle:
      "Saved filters, sorts and layouts over your tasks, pages and projects.",
    eyebrow: "YOUR PERSONAL ORBIT",
  },
  Booking: {
    title: "Booking pages",
    subtitle: "Let people pick a time that works for everyone.",
    eyebrow: "SHARED ORBITS",
  },
};

export const viewTitle = (view: View, name?: string) =>
  view === "Overview" ? screenTitle(view, name) : SCREENS[view].title;

export type NavEntry = { label: View; icon: LucideIcon; adminOnly?: boolean };

/**
 * Primary sidebar navigation, in display order. `adminOnly` entries render
 * only for users with the `admin:access` system permission.
 *
 * The entries are grouped by the question they answer — what am I doing
 * today, what am I building, who is it with — so a dozen destinations read
 * as three short lists rather than one long one.
 */
export const NAV_GROUPS: { label: string; items: NavEntry[] }[] = [
  {
    label: "TODAY",
    items: [
      // Keyed "Overview" still, so saved sidebars and links keep working.
      { label: "Overview", icon: House },
      { label: "Agenda", icon: CONCEPT_ICON.agenda },
      { label: "My tasks", icon: CONCEPT_ICON.task },
      { label: "Calendar", icon: CONCEPT_ICON.event },
    ],
  },
  {
    label: "YOUR WORK",
    items: [
      { label: "Projects", icon: CONCEPT_ICON.project },
      { label: "Docs", icon: CONCEPT_ICON.page },
      { label: "Memory", icon: Brain },
      { label: "Agent", icon: Sparkles },
      { label: "Views", icon: Table2 },
      { label: "Study", icon: CONCEPT_ICON.study },
      { label: "Lists", icon: ListChecks },
      { label: "AI assistant", icon: Sparkles },
      { label: "Background", icon: Sparkles },
      { label: "Overnight", icon: Sparkles },
    ],
  },
  {
    label: "SHARED",
    items: [
      { label: "Teams", icon: Users },
      { label: "Booking", icon: CalendarCheck },
      { label: "Notifications", icon: Bell },
      { label: "Review", icon: Inbox },
      { label: "Admin", icon: ShieldCheck, adminOnly: true },
    ],
  },
];

/** Every destination, flat — for anything that walks the whole navigation. */
/**
 * What the sidebar calls a destination, where that differs from its key:
 * the assistant goes by the name it was given, "Agent" holds notes, and
 * "Overview" is Home (W1; the key stays for saved sidebars and links).
 */
export function navName(view: View, agentName?: string): string {
  if (view === "Overview") return "Home";
  if (view === "AI assistant") return agentName?.trim() || view;
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
