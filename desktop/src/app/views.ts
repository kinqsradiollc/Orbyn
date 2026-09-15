import {
  Bell,
  CalendarDays,
  ListTodo,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";

export type View =
  | "Overview"
  | "My tasks"
  | "Calendar"
  | "AI assistant"
  | "Notifications"
  | "Settings";

/** Primary sidebar navigation, in display order. */
export const NAV: { label: View; icon: LucideIcon }[] = [
  { label: "Overview", icon: Sun },
  { label: "My tasks", icon: ListTodo },
  { label: "Calendar", icon: CalendarDays },
  { label: "AI assistant", icon: Sparkles },
  { label: "Notifications", icon: Bell },
];

/** Views whose heading does not offer the "New item" button. */
export const VIEWS_WITHOUT_NEW_ITEM: View[] = [
  "Settings",
  "AI assistant",
  "Notifications",
];
