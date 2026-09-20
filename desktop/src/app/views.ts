import {
  Bell,
  CalendarCheck,
  CalendarDays,
  ListChecks,
  ListTodo,
  FileText,
  Boxes,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { screens, screenTitle, type ScreenName } from "@orbyn/core";

export type View =
  ScreenName | "Lists" | "Agenda" | "Docs" | "Projects" | "Booking";

type Screen = { title: string; subtitle: string; eyebrow: string };

/** Headings for every view: the shared ones plus the web-only ones. */
export const SCREENS: Record<View, Screen> = {
  ...screens,
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
      { label: "Overview", icon: Sun },
      { label: "Agenda", icon: Newspaper },
      { label: "My tasks", icon: ListTodo },
      { label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "YOUR WORK",
    items: [
      { label: "Projects", icon: Boxes },
      { label: "Docs", icon: FileText },
      { label: "Lists", icon: ListChecks },
      { label: "AI assistant", icon: Sparkles },
    ],
  },
  {
    label: "SHARED",
    items: [
      { label: "Teams", icon: Users },
      { label: "Booking", icon: CalendarCheck },
      { label: "Notifications", icon: Bell },
      { label: "Admin", icon: ShieldCheck, adminOnly: true },
    ],
  },
];

/** Every destination, flat — for anything that walks the whole navigation. */
export const NAV: NavEntry[] = NAV_GROUPS.flatMap((g) => g.items);

/** Views whose heading does not offer the "New item" button. */
export const VIEWS_WITHOUT_NEW_ITEM: View[] = [
  "Settings",
  "Docs",
  "Agenda",
  "Projects",
  "AI assistant",
  "Notifications",
  "Teams",
  "Admin",
  "Booking",
];
