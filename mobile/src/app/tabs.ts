import type { User } from "@orbyn/core";

export type Tab = "Today" | "Tasks" | "Calendar" | "AI" | "Inbox" | "Settings";

export const TABS: { name: Tab; icon: string }[] = [
  { name: "Today", icon: "☼" },
  { name: "Tasks", icon: "✓" },
  { name: "Calendar", icon: "▦" },
  { name: "AI", icon: "✧" },
  { name: "Inbox", icon: "♧" },
  { name: "Settings", icon: "⚙" },
];

export const tabTitle = (tab: Tab, user: User | null) =>
  tab === "Today"
    ? `Hello, ${user?.name.split(" ")[0] || "there"}.`
    : tab === "AI"
      ? "A mind beside yours."
      : tab;

export const tabSubtitle = (tab: Tab) =>
  tab === "Today"
    ? "Let's make room for a good day."
    : tab === "Calendar"
      ? "Your upcoming days, in order."
      : "A little perspective on your personal orbit.";
