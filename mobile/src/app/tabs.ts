import { screens, screenTitle, type ScreenName, type User } from "@orbyn/core";
import type { IconName } from "../components/Icon";

export type Tab = "Today" | "Tasks" | "Calendar" | "AI" | "Inbox" | "Browse";

/**
 * The five sections of the desktop sidebar a phone can hold in a tab bar,
 * plus the way into all the rest. Settings used to have the last tab, which
 * left Projects, Docs, Lists, Teams and Booking with no door of their own:
 * some were under a card at the foot of Overview, the others inside
 * Settings. Browse is that door, and Settings is the first thing in it.
 */
export const TABS: { name: Tab; label: string; icon: IconName }[] = [
  { name: "Today", label: "Overview", icon: "sun" },
  { name: "Tasks", label: "My tasks", icon: "listTodo" },
  { name: "Calendar", label: "Calendar", icon: "calendar" },
  { name: "AI", label: "Assistant", icon: "sparkles" },
  { name: "Inbox", label: "Notifications", icon: "bell" },
  { name: "Browse", label: "Browse", icon: "layoutGrid" },
];

export const tabScreen: Record<Tab, ScreenName> = {
  Today: "Overview",
  Tasks: "My tasks",
  Calendar: "Calendar",
  AI: "AI assistant",
  Inbox: "Notifications",
  Browse: "Browse",
};
export const tabTitle = (tab: Tab, user: User | null) =>
  screenTitle(tabScreen[tab], user?.name);
export const tabSubtitle = (tab: Tab) => screens[tabScreen[tab]].subtitle;
