import { arrangeEntries, type SidebarArrangement } from "@orbyn/core";
import {
  Bell,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  FileText,
  FolderKanban,
  GraduationCap,
  House,
  Inbox,
  ListChecks,
  Moon,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  Table2,
  Users,
  Workflow,
  Brain,
  NotebookPen,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Other paths that belong to this entry. */
  also?: string[];
  children?: NavItem[];
  adminOnly?: boolean;
};

export const PRIMARY: NavItem[] = [
  {
    label: "Today",
    path: "/app",
    icon: House,
    also: ["/app/today", "/app/home", "/app/overview"],
  },
  {
    label: "Work",
    path: "/app/tasks",
    icon: SquareCheckBig,
    also: ["/app/task"],
    children: [
      {
        label: "Projects",
        path: "/app/projects",
        icon: FolderKanban,
        also: ["/app/project"],
      },
      { label: "Views", path: "/app/views", icon: Table2, also: ["/app/view"] },
      { label: "Lists", path: "/app/lists", icon: ListChecks },
    ],
  },
  { label: "Calendar", path: "/app/calendar", icon: CalendarDays },
  {
    label: "Library",
    path: "/app/docs",
    icon: FileText,
    also: ["/app/doc"],
    children: [
      { label: "Daily brief", path: "/app/brief", icon: Newspaper },
      { label: "Memory", path: "/app/memory", icon: Brain },
      { label: "Agent notes", path: "/app/agent-notes", icon: NotebookPen },
    ],
  },
  {
    label: "Agents",
    path: "/app/assistant",
    icon: Sparkles,
    children: [
      { label: "Background", path: "/app/background", icon: Workflow },
      { label: "Overnight", path: "/app/overnight", icon: Moon },
      { label: "Review", path: "/app/review", icon: Inbox },
    ],
  },
];

export const MORE: NavItem[] = [
  { label: "Study", path: "/app/study", icon: GraduationCap },
  { label: "Teams", path: "/app/teams", icon: Users },
  { label: "Booking", path: "/app/booking", icon: CalendarCheck },
  { label: "Notifications", path: "/app/notifications", icon: Bell },
  { label: "Admin", path: "/app/admin", icon: ShieldCheck, adminOnly: true },
];

export const owns = (item: NavItem, path: string): boolean =>
  path === item.path ||
  (item.path !== "/app" && path.startsWith(item.path + "/")) ||
  !!item.also?.some((p) => path === p || path.startsWith(p + "/"));

export const ownsAny = (item: NavItem, path: string): boolean =>
  owns(item, path) || !!item.children?.some((child) => owns(child, path));

export { BookOpen };

/** Stable account preference keys survive the new display labels. */
const NAV_KEYS: Record<string, string> = {
  "/app": "Overview",
  "/app/tasks": "My tasks",
  "/app/docs": "Docs",
  "/app/brief": "Agenda",
  "/app/assistant": "AI assistant",
  "/app/agent-notes": "Agent",
};
export const navKey = (item: NavItem): string =>
  NAV_KEYS[item.path] ?? item.label;
export const ALL_NAV = PRIMARY.flatMap((item) => [
  item,
  ...(item.children ?? []),
]).concat(MORE);

export type SidebarSlot =
  | { kind: "destination"; key: string; item: NavItem }
  | { kind: "starred"; key: "Starred" }
  | { kind: "pinned"; key: "Pinned views" };

/** Keep saved custom compositions verbatim; empty/reset prefs adopt the new hierarchy. */
export function sidebarComposition(
  arrangement: SidebarArrangement,
  isAdmin: boolean,
):
  | { kind: "default"; primary: NavItem[]; more: NavItem[] }
  | { kind: "custom"; slots: SidebarSlot[] } {
  const permitted = (item: NavItem) => !item.adminOnly || isAdmin;
  if (!arrangement.order.length && !arrangement.hidden.length)
    return {
      kind: "default",
      primary: PRIMARY.filter(permitted),
      more: MORE.filter(permitted),
    };
  const slots: SidebarSlot[] = [
    ...ALL_NAV.filter(permitted).map((item): SidebarSlot => ({
      kind: "destination",
      key: navKey(item),
      item,
    })),
    { kind: "starred", key: "Starred" },
    { kind: "pinned", key: "Pinned views" },
  ];
  return {
    kind: "custom",
    slots: arrangeEntries(slots, (slot) => slot.key, arrangement),
  };
}
