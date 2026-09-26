/**
 * Grouping tasks in lists and on the board (DATA-03, DATA-04).
 *
 * One set of rules for both apps: which groups a list of tasks falls into,
 * what each group's header says ("Physics · 5 · 3 h 20 min"), which columns
 * a board shows, and what moving a card from one column to another changes.
 * Grouping by something a person can change (status, list, priority,
 * assignee, tag) makes a board whose cards can be dragged between columns;
 * the rest (size, project, due week) only sort things into groups.
 */
import { isClosed, STATUSES } from "./schemas.js";
import type {
  Item,
  ItemInput,
  Priority,
  Status,
  Tag,
  TaskList,
} from "./types.js";

export const TASK_GROUPS = [
  "none",
  "status",
  "list",
  "tag",
  "size",
  "priority",
  "project",
  "due_week",
  "assignee",
] as const;
export type TaskGroupBy = (typeof TASK_GROUPS)[number];

export const TASK_GROUP_LABELS: Record<TaskGroupBy, string> = {
  none: "No grouping",
  status: "Status",
  list: "List",
  tag: "Tag",
  size: "Size",
  priority: "Priority",
  project: "Project",
  due_week: "Due week",
  assignee: "Assignee",
};

/** Groupings whose columns a card can be dragged between. */
export const BOARD_GROUPS = [
  "status",
  "list",
  "priority",
  "assignee",
  "tag",
] as const satisfies readonly TaskGroupBy[];
export type BoardGroupBy = (typeof BOARD_GROUPS)[number];

export const isBoardGroup = (by: string): by is BoardGroupBy =>
  (BOARD_GROUPS as readonly string[]).includes(by);

/** The key of the group for tasks without the thing grouped by. */
export const NO_GROUP = "~none";

/** How long a task looks, for grouping by size. */
export type TaskSize = "quick" | "short" | "long" | "none";
export const TASK_SIZES: TaskSize[] = ["quick", "short", "long", "none"];
export const TASK_SIZE_LABELS: Record<TaskSize, string> = {
  quick: "Up to 15 min",
  short: "Up to 1 hour",
  long: "Longer than 1 hour",
  none: "No estimate",
};
export const taskSize = (i: Pick<Item, "estimate_minutes">): TaskSize => {
  const m = i.estimate_minutes;
  if (!m) return "none";
  if (m <= 15) return "quick";
  if (m <= 60) return "short";
  return "long";
};

const PRIORITIES: Priority[] = ["high", "medium", "low"];
const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};
const STATUS_TITLES: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

/** What the groups are named from: the lists, tags and projects you have. */
export type GroupNames = {
  lists?: Pick<TaskList, "id" | "name" | "color" | "team_id" | "team_name">[];
  tags?: Pick<Tag, "id" | "name" | "color" | "team_id">[];
  projects?: { id: string; name: string }[];
  /** You: "Assigned to me" is named for you. */
  userId?: string | null;
  /** For due weeks; the device's clock otherwise. */
  now?: Date;
};

export type TaskGroup = {
  key: string;
  title: string;
  color?: string;
  items: Item[];
  /** Estimated minutes of the open tasks in it. */
  minutes: number;
};

/** Estimated minutes still ahead: the estimates of the open tasks. */
export const groupMinutes = (items: Item[]): number =>
  items.reduce(
    (sum, i) =>
      sum +
      (i.kind === "task" && !isClosed(i.status)
        ? Math.max(0, i.estimate_minutes ?? 0)
        : 0),
    0,
  );

/** "45 min", "2 h", "3 h 20 min". */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** A group's header: "Physics · 5 · 3 h 20 min" (no time when none is estimated). */
export function groupHeader(g: Pick<TaskGroup, "title" | "items" | "minutes">) {
  const parts = [g.title, String(g.items.length)];
  if (g.minutes > 0) parts.push(durationText(g.minutes));
  return parts.join(" · ");
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The Sunday a week starts on (weeks start on Sunday, as the calendar's do). */
function weekStart(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay());
  return s;
}

/** The due-week group a task falls in: overdue, a week, or no deadline. */
function dueWeek(i: Item, now: Date): { key: string; title: string } {
  if (!i.due_at) return { key: NO_GROUP, title: "No deadline" };
  const due = new Date(i.due_at);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!isClosed(i.status) && due < today)
    return { key: "overdue", title: "Overdue" };
  const start = weekStart(due);
  const thisWeek = weekStart(now);
  const weeks = Math.round(
    (start.getTime() - thisWeek.getTime()) / (7 * 86_400_000),
  );
  const title =
    weeks === 0
      ? "This week"
      : weeks === 1
        ? "Next week"
        : weeks === -1
          ? "Last week"
          : `Week of ${start.getDate()} ${MONTHS[start.getMonth()]}`;
  return { key: `w:${dayKey(start)}`, title };
}

/** The groups one task belongs to (a task with two tags is in both). */
function groupsOf(
  i: Item,
  by: TaskGroupBy,
  names: GroupNames,
): { key: string; title: string; color?: string }[] {
  switch (by) {
    case "none":
      return [{ key: "all", title: "" }];
    case "status":
      return [{ key: i.status, title: STATUS_TITLES[i.status] }];
    case "priority":
      return [{ key: i.priority, title: PRIORITY_LABELS[i.priority] }];
    case "size": {
      const size = taskSize(i);
      return [{ key: size, title: TASK_SIZE_LABELS[size] }];
    }
    case "list": {
      const list = i.list_id
        ? names.lists?.find((l) => l.id === i.list_id)
        : undefined;
      return list
        ? [{ key: list.id, title: listTitle(list, names), color: list.color }]
        : [{ key: NO_GROUP, title: "No list" }];
    }
    case "tag": {
      const tagged = (i.tag_ids ?? []).flatMap((id) => {
        const tag = names.tags?.find((t) => t.id === id);
        return tag ? [{ key: tag.id, title: tag.name, color: tag.color }] : [];
      });
      return tagged.length ? tagged : [{ key: NO_GROUP, title: "No tag" }];
    }
    case "project": {
      if (!i.project_id) return [{ key: NO_GROUP, title: "No project" }];
      const project = names.projects?.find((p) => p.id === i.project_id);
      return [{ key: i.project_id, title: project?.name ?? "A project" }];
    }
    case "due_week":
      return [dueWeek(i, names.now ?? new Date())];
    case "assignee":
      if (!i.assignee_id)
        return [
          {
            key: NO_GROUP,
            title: i.team_id ? "Not assigned" : "Your own tasks",
          },
        ];
      return [
        {
          key: i.assignee_id,
          title:
            i.assignee_id === names.userId
              ? "Assigned to me"
              : i.assignee_name || "Someone",
        },
      ];
  }
}

/** A list's name, with its team's when another list shares the name. */
function listTitle(
  list: NonNullable<GroupNames["lists"]>[number],
  names: GroupNames,
) {
  const twins = (names.lists ?? []).filter((l) => l.name === list.name).length;
  return list.team_name && twins > 1
    ? `${list.name} · ${list.team_name}`
    : list.name;
}

/** The order groups sit in: fixed orders first, "none" groups last. */
function orderGroups(
  by: TaskGroupBy,
  groups: TaskGroup[],
  names: GroupNames,
): TaskGroup[] {
  const fixed: Partial<Record<TaskGroupBy, string[]>> = {
    status: [...STATUSES],
    priority: PRIORITIES,
    size: TASK_SIZES,
  };
  const order = fixed[by];
  if (order)
    return groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (by === "due_week")
    return groups.sort(
      (a, b) =>
        Number(a.key === NO_GROUP) - Number(b.key === NO_GROUP) ||
        Number(b.key === "overdue") - Number(a.key === "overdue") ||
        a.key.localeCompare(b.key),
    );
  if (by === "list" && names.lists) {
    const order = names.lists.map((l) => l.id);
    return groups.sort(
      (a, b) =>
        Number(a.key === NO_GROUP) - Number(b.key === NO_GROUP) ||
        order.indexOf(a.key) - order.indexOf(b.key),
    );
  }
  return groups.sort(
    (a, b) =>
      Number(a.key === NO_GROUP) - Number(b.key === NO_GROUP) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * Tasks split into titled groups with their estimated time, in order and
 * with empty groups left out. Items keep the order they came in.
 */
export function groupTasks(
  items: Item[],
  by: TaskGroupBy,
  names: GroupNames = {},
): TaskGroup[] {
  if (by === "none")
    return [{ key: "all", title: "", items, minutes: groupMinutes(items) }];
  const groups = new Map<string, TaskGroup>();
  for (const i of items)
    for (const g of groupsOf(i, by, names)) {
      const group = groups.get(g.key) ?? {
        ...g,
        items: [],
        minutes: 0,
      };
      group.items.push(i);
      groups.set(g.key, group);
    }
  for (const g of groups.values()) g.minutes = groupMinutes(g.items);
  return orderGroups(by, [...groups.values()], names);
}

/**
 * A board's columns: every column a card could be dragged to, even empty
 * ones (all statuses shown, all priorities, all your lists and tags, and the
 * people the tasks are assigned to), unless `hideEmpty` is set.
 */
export function boardColumns(
  items: Item[],
  by: BoardGroupBy,
  names: GroupNames = {},
  options: { statuses?: Status[]; hideEmpty?: boolean } = {},
): TaskGroup[] {
  const grouped = new Map(
    groupTasks(items, by, names).map((g) => [g.key, g] as const),
  );
  const empty = (key: string, title: string, color?: string): TaskGroup => ({
    key,
    title,
    ...(color ? { color } : {}),
    items: [],
    minutes: 0,
  });
  let all: TaskGroup[];
  switch (by) {
    case "status":
      all = (options.statuses ?? [...STATUSES]).map(
        (s) => grouped.get(s) ?? empty(s, STATUS_TITLES[s]),
      );
      break;
    case "priority":
      all = PRIORITIES.map(
        (p) => grouped.get(p) ?? empty(p, PRIORITY_LABELS[p]),
      );
      break;
    case "list":
      all = [
        ...(names.lists ?? []).map(
          (l) => grouped.get(l.id) ?? empty(l.id, listTitle(l, names), l.color),
        ),
        grouped.get(NO_GROUP) ?? empty(NO_GROUP, "No list"),
      ];
      break;
    case "tag":
      all = [
        ...[...(names.tags ?? [])]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => grouped.get(t.id) ?? empty(t.id, t.name, t.color)),
        grouped.get(NO_GROUP) ?? empty(NO_GROUP, "No tag"),
      ];
      break;
    case "assignee": {
      const people = [...grouped.values()].filter((g) => g.key !== NO_GROUP);
      people.sort(
        (a, b) =>
          Number(b.key === names.userId) - Number(a.key === names.userId) ||
          a.title.localeCompare(b.title),
      );
      all = [
        ...people,
        grouped.get(NO_GROUP) ?? empty(NO_GROUP, "Not assigned"),
      ];
      break;
    }
  }
  // Anything grouped under a column the names don't know yet still shows.
  for (const g of grouped.values())
    if (!all.some((c) => c.key === g.key)) all.splice(all.length - 1, 0, g);
  return options.hideEmpty ? all.filter((c) => c.items.length) : all;
}

/** What moving a card to another column changes on its task. */
export type ColumnChange =
  | { status: Status }
  | { list_id: string | null }
  | { priority: Priority }
  | { assignee_id: string | null }
  | { tag_ids: string[] };

export type DropResult =
  { ok: true; change: ColumnChange } | { ok: false; reason: string } | null;

/**
 * What dropping `item` from column `from` onto column `to` changes: the
 * status, list, priority, assignee or tags. Null when nothing would change.
 * A move that can't be made says why in plain words, and the card stays.
 */
export function dropChange(
  item: Item,
  by: BoardGroupBy,
  from: string,
  to: string,
  names: GroupNames = {},
): DropResult {
  if (from === to) return null;
  switch (by) {
    case "status":
      if (!(STATUSES as readonly string[]).includes(to)) return null;
      return item.status === to
        ? null
        : { ok: true, change: { status: to as Status } };
    case "priority":
      if (!(PRIORITIES as string[]).includes(to)) return null;
      return item.priority === to
        ? null
        : { ok: true, change: { priority: to as Priority } };
    case "list": {
      if (to === NO_GROUP)
        return item.list_id ? { ok: true, change: { list_id: null } } : null;
      const list = names.lists?.find((l) => l.id === to);
      if (!list) return null;
      if ((list.team_id ?? null) !== (item.team_id ?? null))
        return {
          ok: false,
          reason: list.team_id
            ? `Only ${list.team_name ?? "that team"}'s tasks can go in ${list.name}.`
            : `${list.name} is your own list, so a team's task can't go in it.`,
        };
      return item.list_id === to ? null : { ok: true, change: { list_id: to } };
    }
    case "assignee":
      if (!item.team_id)
        return {
          ok: false,
          reason: "Only a team's tasks can be assigned to someone.",
        };
      if (to === NO_GROUP)
        return item.assignee_id
          ? { ok: true, change: { assignee_id: null } }
          : null;
      return item.assignee_id === to
        ? null
        : { ok: true, change: { assignee_id: to } };
    case "tag": {
      const now = item.tag_ids ?? [];
      const kept = now.filter((id) => id !== from);
      if (to !== NO_GROUP) {
        const tag = names.tags?.find((t) => t.id === to);
        if (!tag) return null;
        if (tag.team_id && tag.team_id !== (item.team_id ?? null))
          return {
            ok: false,
            reason: `${tag.name} is another team's tag.`,
          };
        if (!kept.includes(to)) kept.push(to);
      }
      const same =
        kept.length === now.length && kept.every((id) => now.includes(id));
      return same ? null : { ok: true, change: { tag_ids: kept } };
    }
  }
}

/**
 * What a task made with a column's + starts with: that column's status,
 * list (and the list's team), priority or tag.
 */
export function columnPrefill(
  by: BoardGroupBy,
  key: string,
  names: GroupNames = {},
): Partial<ItemInput> {
  switch (by) {
    case "status":
      return (STATUSES as readonly string[]).includes(key)
        ? { status: key as Status }
        : {};
    case "priority":
      return (PRIORITIES as string[]).includes(key)
        ? { priority: key as Priority }
        : {};
    case "list": {
      const list = names.lists?.find((l) => l.id === key);
      return list ? { list_id: list.id, team_id: list.team_id ?? null } : {};
    }
    case "tag": {
      const tag = names.tags?.find((t) => t.id === key);
      return tag
        ? {
            tag_ids: [tag.id],
            ...(tag.team_id ? { team_id: tag.team_id } : {}),
          }
        : {};
    }
    case "assignee":
      return {};
  }
}
