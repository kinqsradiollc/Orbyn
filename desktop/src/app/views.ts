import {
  Bell,
  CalendarDays,
  ListTodo,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";

export type View =
  | "Overview"
  | "My tasks"
  | "Calendar"
  | "AI assistant"
  | "Teams"
  | "Notifications"
  | "Settings"
  | "Admin";

/**
 * Primary sidebar navigation, in display order. `adminOnly` entries render
 * only for users with the `admin:access` system permission.
 */
export const NAV: { label: View; icon: LucideIcon; adminOnly?: boolean }[] = [
  { label: "Overview", icon: Sun },
  { label: "My tasks", icon: ListTodo },
  { label: "Calendar", icon: CalendarDays },
  { label: "AI assistant", icon: Sparkles },
  { label: "Teams", icon: Users },
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
];
