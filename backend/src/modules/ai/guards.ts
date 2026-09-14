import type { AgentReply } from "@orbyn/core";

type Action = AgentReply["actions"][number];
type SnapshotItem = {
  id: string;
  title: string;
  kind: string;
  notes?: string;
  status?: string;
  priority?: string;
  due_at: Date | string | null;
  end_at: Date | string | null;
  reminder_minutes?: number;
  team_id?: string | null;
  progress?: number;
};

const time = (value: unknown) =>
  value == null ? null : new Date(value as string).getTime();
const COMPARED = [
  "title",
  "notes",
  "kind",
  "status",
  "priority",
  "reminder_minutes",
  "team_id",
] as const;

/**
 * Drop proposed actions a model got wrong before the user ever sees them:
 * edits or deletions of items that were not in the planner snapshot (the
 * model can only know those ids, so any other id is invented), edits that
 * change nothing, and creates that exactly duplicate an existing item.
 */
export function pruneActions(
  actions: Action[],
  items: SnapshotItem[],
): Action[] {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  return actions.filter((action) => {
    const data = action.data;
    if (action.operation === "create") {
      if (!data) return false;
      const title = data.title.trim().toLowerCase();
      return !items.some(
        (item) =>
          item.kind === data.kind &&
          item.title.trim().toLowerCase() === title &&
          time(item.due_at) === time(data.due_at),
      );
    }
    const item = byId.get(String(action.item_id));
    if (!item) return false;
    if (action.operation === "delete" || !data) return true;
    const unchanged =
      COMPARED.every(
        (key) => (data as Record<string, unknown>)[key] === item[key],
      ) &&
      time(data.due_at) === time(item.due_at) &&
      time(data.end_at) === time(item.end_at) &&
      (data.progress === undefined || data.progress === item.progress);
    return !unchanged;
  });
}
