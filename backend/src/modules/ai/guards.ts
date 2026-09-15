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

/** Words that ask for a change to the planner. */
const CHANGE_INTENT =
  /\b(add|create|make|schedule|book|plan|put|set|remind|move|reschedule|change|update|edit|rename|shift|push|postpone|delay|bring|mark|complete|finish|finished|done|tick|check off|start|block|unblock|progress|delete|remove|cancel|clear|drop|erase|trash|get rid of|archive|share|assign|prioriti[sz]e|split|duplicate|copy)\b/i;
/** Whether a message asks for any change to the planner. */
export const wantsChanges = (message: string) => CHANGE_INTENT.test(message);

const DATE_OR_TIME =
  /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|next month|\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i;
const QUESTION =
  /\?\s*$|^\s*(what|when|where|which|who|how|why|is|are|am|do|does|did|can|could|should|would|will|show|list|summari[sz]e|tell|give me|find)\b/i;

/**
 * Whether a message may ask for a change: a change word ("add", "move"), or
 * a plan with a day or time that is not a question ("Dinner with Sam
 * Thursday 7pm"). "What's due Friday?" and "Summarize my week" are not.
 */
export const mayChange = (message: string) =>
  wantsChanges(message) ||
  (DATE_OR_TIME.test(message) && !QUESTION.test(message));

/** Words that ask for something to be deleted. */
const DELETE_INTENT =
  /\b(delete|remove|cancel|clear|drop|erase|trash|get rid of|scrap|bin)\b/i;
/** Whether a message asks for something to be deleted. */
export const wantsDeletion = (message: string) => DELETE_INTENT.test(message);

/**
 * Drop proposed actions a model got wrong before the user ever sees them:
 * edits or deletions of items that were not in the planner snapshot (the
 * model can only know those ids, so any other id is invented), edits that
 * change nothing, and creates that exactly duplicate an existing item. With
 * the user's `message`, it also keeps only what was asked for: no changes for
 * a question like "summarize my week", and no deletions unless the message
 * asks to delete, remove or cancel something.
 */
export function pruneActions(
  actions: Action[],
  items: SnapshotItem[],
  message?: string,
): Action[] {
  if (message !== undefined && !CHANGE_INTENT.test(message)) return [];
  const mayDelete = message === undefined || DELETE_INTENT.test(message);
  const byId = new Map(items.map((item) => [String(item.id), item]));
  return actions.filter((action) => {
    if (action.operation === "delete" && !mayDelete) return false;
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
