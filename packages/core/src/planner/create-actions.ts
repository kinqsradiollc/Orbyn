/**
 * The phone's one + in every tab's header. A tap runs the favourite (New
 * task, until someone picks another); a long press opens a sheet of every
 * way to start something, in an order people can arrange, with rows they
 * don't use hidden. The arrangement is a small choice kept on the device.
 */

/** Every way the + can start something, in the order it starts in. */
export const CREATE_ACTIONS = [
  { id: "task", label: "New task" },
  { id: "page", label: "New page" },
  { id: "template", label: "From template" },
  { id: "scan", label: "Scan notes" },
  { id: "project", label: "New project" },
  { id: "plan", label: "Plan my day" },
  { id: "focus", label: "Start focus" },
  { id: "ask", label: "Ask assistant" },
] as const;

export type CreateActionId = (typeof CREATE_ACTIONS)[number]["id"];

const IDS = CREATE_ACTIONS.map((a) => a.id) as CreateActionId[];
const isId = (v: unknown): v is CreateActionId =>
  typeof v === "string" && (IDS as string[]).includes(v);

/** The words for an action. */
export const createLabel = (id: CreateActionId) =>
  CREATE_ACTIONS.find((a) => a.id === id)!.label;

/** How the + sheet is arranged: its order, what's hidden, what a tap runs. */
export type CreateArrangement = {
  order: CreateActionId[];
  hidden: CreateActionId[];
  favourite: CreateActionId;
};

export const DEFAULT_ARRANGEMENT: CreateArrangement = {
  order: IDS,
  hidden: [],
  favourite: "task",
};

/**
 * An arrangement as it was kept, made whole: anything unreadable gives the
 * default, actions it doesn't know are dropped, new ones join at the end,
 * and the favourite is always one that shows.
 */
export function readArrangement(raw: string | null): CreateArrangement {
  let data: Partial<Record<keyof CreateArrangement, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") data = parsed;
  } catch {
    return DEFAULT_ARRANGEMENT;
  }
  const listed = Array.isArray(data.order) ? data.order.filter(isId) : [];
  const order = [...new Set([...listed, ...IDS])];
  const favourite = isId(data.favourite) ? data.favourite : "task";
  const hidden = Array.isArray(data.hidden)
    ? [...new Set(data.hidden.filter(isId))].filter((id) => id !== favourite)
    : [];
  return { order, hidden, favourite };
}

/** The rows the sheet shows, in order. */
export const shownActions = (a: CreateArrangement): CreateActionId[] =>
  a.order.filter((id) => !a.hidden.includes(id));

/** Move an action up (-1) or down (1) the sheet. */
export function moveAction(
  a: CreateArrangement,
  id: CreateActionId,
  by: -1 | 1,
): CreateArrangement {
  const at = a.order.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= a.order.length) return a;
  const order = a.order.slice();
  [order[at], order[to]] = [order[to], order[at]];
  return { ...a, order };
}

/**
 * Hide an action from the sheet, or show it again. The favourite stays:
 * a tap on + runs it, so it can't also be hidden.
 */
export function toggleHidden(
  a: CreateArrangement,
  id: CreateActionId,
): CreateArrangement {
  if (a.hidden.includes(id))
    return { ...a, hidden: a.hidden.filter((h) => h !== id) };
  if (id === a.favourite) return a;
  return { ...a, hidden: [...a.hidden, id] };
}

/** What a tap on + runs from now on; a hidden action shows again. */
export const setFavourite = (
  a: CreateArrangement,
  id: CreateActionId,
): CreateArrangement => ({
  ...a,
  favourite: id,
  hidden: a.hidden.filter((h) => h !== id),
});
