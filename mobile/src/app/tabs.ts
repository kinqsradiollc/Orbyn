import { screens, screenTitle, type ScreenName, type User } from "@orbyn/core";
import type { IconName } from "../components/Icon";

export type Tab = "Today" | "Tasks" | "Calendar" | "AI" | "Inbox" | "Settings";

/** Same sections and icons as the desktop sidebar. */
export const TABS: { name: Tab; label: string; icon: IconName }[] = [
  { name: "Today", label: "Overview", icon: "sun" },
  { name: "Tasks", label: "My tasks", icon: "listTodo" },
  { name: "Calendar", label: "Calendar", icon: "calendar" },
  { name: "AI", label: "Assistant", icon: "sparkles" },
  { name: "Inbox", label: "Notifications", icon: "bell" },
  { name: "Settings", label: "Settings", icon: "settings" },
];

export const tabScreen: Record<Tab, ScreenName> = {
  Today: "Overview",
  Tasks: "My tasks",
  Calendar: "Calendar",
  AI: "AI assistant",
  Inbox: "Notifications",
  Settings: "Settings",
};
export const tabTitle = (tab: Tab, user: User | null) =>
  screenTitle(tabScreen[tab], user?.name);
export const tabSubtitle = (tab: Tab) => screens[tabScreen[tab]].subtitle;
