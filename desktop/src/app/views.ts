import {
  Bell,
  CalendarCheck,
  CalendarDays,
  ListChecks,
  ListTodo,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { screens, screenTitle, type ScreenName } from "@orbyn/core";

export type View = ScreenName | "Lists" | "Booking";

type Screen = { title: string; subtitle: string; eyebrow: string };

/** Headings for every view: the shared ones plus the web-only ones. */
export const SCREENS: Record<View, Screen> = {
  ...screens,
  Lists: {
    title: "Lists",
    subtitle: "Group tasks the way you think about them.",
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

/**
 * Primary sidebar navigation, in display order. `adminOnly` entries render
 * only for users with the `admin:access` system permission.
 */
export const NAV: { label: View; icon: LucideIcon; adminOnly?: boolean }[] = [
  { label: "Overview", icon: Sun },
  { label: "My tasks", icon: ListTodo },
  { label: "Lists", icon: ListChecks },
  { label: "Calendar", icon: CalendarDays },
  { label: "AI assistant", icon: Sparkles },
  { label: "Teams", icon: Users },
  { label: "Booking", icon: CalendarCheck },
  { label: "Notifications", icon: Bell },
  { label: "Admin", icon: ShieldCheck, adminOnly: true },
];

/** Views whose heading does not offer the "New item" button. */
export const VIEWS_WITHOUT_NEW_ITEM: View[] = [
  "Settings",
  "AI assistant",
  "Notifications",
  "Teams",
  "Admin",
  "Booking",
];
