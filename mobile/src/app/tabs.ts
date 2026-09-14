import type { User } from "@orbyn/core";
import type { IconName } from "../components/Icon";

export type Tab = "Today" | "Tasks" | "Calendar" | "AI" | "Inbox" | "Settings";

/** Same sections and icons as the desktop sidebar. */
export const TABS: { name: Tab; label: string; icon: IconName }[] = [
  { name: "Today", label: "Today", icon: "sun" },
  { name: "Tasks", label: "Tasks", icon: "listTodo" },
  { name: "Calendar", label: "Calendar", icon: "calendar" },
  { name: "AI", label: "Assistant", icon: "sparkles" },
  { name: "Inbox", label: "Inbox", icon: "bell" },
  { name: "Settings", label: "Settings", icon: "settings" },
];

export const tabTitle = (tab: Tab, user: User | null) =>
  tab === "Today"
    ? `Hello, ${user?.name.split(" ")[0] || "there"}.`
    : tab === "AI"
      ? "A mind beside yours."
      : tab === "Tasks"
        ? "Small steps. Big things."
        : tab;

export const tabSubtitle = (tab: Tab) =>
  tab === "Today"
    ? "Let's make room for a good day."
    : tab === "Tasks"
      ? "Everything on your mind, with a place to land."
      : tab === "Calendar"
        ? "A little perspective on the days ahead."
        : tab === "AI"
          ? "Summarize, plan, or adjust. You approve every change."
          : tab === "Inbox"
            ? "Deadline reminders land here."
            : "Your space, just the way you like it.";
