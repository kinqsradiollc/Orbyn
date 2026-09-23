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
  /\b(decompose|draft|break down|break .{1,80} into (?:sub)?tasks|add|create|make|schedule|book|plan|put|set|remind|move|reschedule|change|update|edit|rename|shift|push|postpone|delay|bring|mark|complete[ds]?|finish(?:ed|es)?|done|tick|check off|start|block|unblock|progress|delete|remove|cancel(?:l?ed)?|clear|drop|erase|trash|get rid of|archive|share|assign|prioriti[sz]e[ds]?|split|duplicate|copy)\b/i;
/**
 * Telling the assistant what happened ("the oral defence has been completed",
 * "I paid the bill", "the meeting got cancelled", "the dentist didn't happen")
 * asks for the item to be updated, even without a verb like "mark".
 */
const STATUS_STATEMENT =
  /\b(?:is|was|are|were|has been|have been|had been|got|been|it['’]?s|that['’]?s|all)\s+(?:now\s+|already\s+|finally\s+)?(?:completed|done|finished|over|cancell?ed|called off|postponed|handled|sorted|resolved|submitted|delivered|attended|paid|sent|closed|wrapped up|taken care of|no longer needed|not happening|not needed)\b|\b(?:i|we)(?:['’]ve| have| already| just| finally)?\s+(?:already\s+|just\s+|finally\s+)?(?:did|done|finished|completed|attended|handled|sorted|submitted|delivered|paid|sent|went to|wrapped up|took care of|dealt with|got through|passed|skipped|missed)\b|\b(?:didn['’]?t|did not|won['’]?t|will not|isn['’]?t|is not) (?:happen|go ahead|take place|need)|\bno longer (?:need|relevant|happening)\b/i;
/** Whether a message asks for any change to the planner. */
export const wantsChanges = (message: string) =>
  CHANGE_INTENT.test(message) || STATUS_STATEMENT.test(message);

const DATE_OR_TIME =
  /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|next month|\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i;
const POLITE_REQUEST = /^\s*(can|could|would|will|please)\b/i;
const QUESTION =
  /\?\s*$|^\s*(what|what's|whats|when|where|which|who|how|why|is|are|am|do|does|did|should)\b/i;
const READ_REQUEST = /^\s*(show|list|summari[sz]e|tell|give me|find)\b/i;

/**
 * Asking for advice about order — "help me prioritise", "what should I do
 * first?", "which task should I complete first" — is a question, even though
 * "prioritise" and "complete" are change words. The assistant ranks and
 * explains; it proposes changes only when the message also names one
 * ("…and move the rest to next week", "set the report to high priority").
 */
const ADVICE =
  /\b(?:help me (?:to )?prioriti[sz]e|how (?:should|do) i prioriti[sz]e|what (?:should|do) i (?:do|work on|tackle|start|focus on|complete|finish)(?: first| next)?|which (?:task|one|thing)s? (?:should|do) i (?:do|work on|tackle|start|focus on|complete|finish)|what(?:'s| is) (?:most )?(?:important|urgent|pressing)|what needs my attention|where (?:should|do) i start)\b/i;
const EXPLICIT_CHANGE =
  /\b(add|create|move|reschedule|change|update|edit|rename|set|mark|delete|remove|cancel|schedule|book|assign|give (?:them|it|those)|put)\b/i;

/** Whether a message asks what to do rather than asking for a change. */
export const wantsAdvice = (message: string) =>
  ADVICE.test(message) && !EXPLICIT_CHANGE.test(message);

/**
 * Whether a message may ask for a change.
 * - "Can you move my dentist to Friday?": a polite request with a change word.
 * - "What's the launch plan about?", "Is the gym on Friday?": questions, never.
 * - "Show my week": only with a change word ("find the dentist and move it").
 * - Otherwise a change word ("add", "move"), or a plan with a day or time
 *   ("Dinner with Sam Thursday 7pm").
 */
export function mayChange(message: string) {
  if (wantsAdvice(message)) return false;
  if (POLITE_REQUEST.test(message)) return wantsChanges(message);
  if (QUESTION.test(message)) return false;
  if (READ_REQUEST.test(message)) return wantsChanges(message);
  return wantsChanges(message) || DATE_OR_TIME.test(message);
}

/** Words that ask for something to be deleted. */
const DELETE_INTENT =
  /\b(delete|remove|cancel|clear|drop|erase|trash|get rid of|scrap|bin)\b/i;
const PLAN_INTENT =
  /\b(?:plan|organi[sz]e|time-?block|block out|schedule)\s+(?:out\s+)?(?:my (?:day|week|tasks|time|schedule|morning|afternoon|evening|calendar|work|to-?dos?)|the rest of my (?:day|week)|(?:today|tomorrow)(?!['’]s)|this (?:week|morning|afternoon|evening)|next week)\b|\bwhat should i (?:do|work on)\b|\bwhen should i (?:do|work on)\b|\bmake (?:me )?a plan\b/i;
/**
 * Whether a message asks the planner to lay out the user's time ("plan my
 * day", "what should I work on?") rather than to create or change items.
 */
export const wantsPlan = (message: string) => PLAN_INTENT.test(message);

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
  if (
    message !== undefined &&
    (!CHANGE_INTENT.test(message) || wantsAdvice(message))
  )
    return [];
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
