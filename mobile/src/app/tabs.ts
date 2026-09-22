import { screens, screenTitle, type ScreenName, type User } from "@orbyn/core";
import type { IconName } from "../components/Icon";

export type Tab = "Today" | "Tasks" | "Calendar" | "AI" | "Inbox" | "Browse";

/** Five primary destinations; notifications remain available in the app header. */
export const TABS: { name: Tab; label: string; icon: IconName }[] = [
  { name: "Today", label: "Today", icon: "sun" },
  { name: "Tasks", label: "Tasks", icon: "listTodo" },
  { name: "Calendar", label: "Calendar", icon: "calendar" },
  { name: "AI", label: "Assistant", icon: "sparkles" },
  { name: "Browse", label: "Workspace", icon: "layoutGrid" },
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
  tab === "Browse" ? "Your workspace" : screenTitle(tabScreen[tab], user?.name);
export const tabSubtitle = (tab: Tab) => screens[tabScreen[tab]].subtitle;
