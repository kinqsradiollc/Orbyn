import { itemBody } from "./planner.js";
import type {
  EditScope,
  HabitInput,
  Item,
  ItemInput,
  Status,
} from "./types.js";

/**
 * Offline changes. What a person does with no signal is kept in order on the
 * device, shown straight away, and sent when the signal is back — each with
 * its own key, so a change sent twice happens once.
 *
 * This module is the pure part: what a queued change is, how it looks in the
 * lists before it is sent, and how an edit made offline meets an edit made
 * elsewhere in the meantime. Storage and sending are the app's.
 */
export type OutboxOp =
  | {
      type: "item.create";
      /** Named on the device, so later changes can point at it. */
      input: Partial<ItemInput> & { title: string; id: string };
    }
  | {
      type: "item.update";
      id: string;
      body: ItemInput & { version: number };
      /** The item as it was when the edit began: what "changed" is measured from. */
      base: Item;
      scope?: { scope: EditScope; occurrence?: string };
    }
  | {
      type: "item.delete";
      id: string;
      version: number;
      title: string;
      scope?: { scope: EditScope; occurrence?: string };
    }
  | {
      type: "item.post";
      id: string;
      title: string;
      body: { status?: Status; progress?: number; body?: string };
    }
  | { type: "habit.create"; body: HabitInput }
  | {
      type: "habit.update";
      id: string;
      name: string;
      patch: Partial<HabitInput>;
    }
  | { type: "habit.delete"; id: string; name: string }
  | { type: "booking.approve"; id: string; who: string }
  | { type: "booking.decline"; id: string; who: string; reason: string }
  | { type: "booking.cancel"; id: string; who: string; reason: string }
  /** Only if the time is still free when it's sent: it may be refused. */
  | { type: "booking.reschedule"; id: string; who: string; start_at: string }
  | { type: "booking.note"; id: string; who: string; note: string };

export type OutboxEntry = {
  /** Sent as the Idempotency-Key. */
  key: string;
  op: OutboxOp;
  queued_at: string;
  attempts: number;
  /** Waiting to be sent, or refused and waiting for the person. */
  state: "pending" | "failed";
  /** Why it was refused, in words. */
  error?: string;
  /** An edit that collided with one made elsewhere: the fields, and theirs. */
  conflict?: { fields: string[]; theirs: Item };
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields of an item's body that differ between two versions of it. */
export function changedFields(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
) {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  keys.delete("version");
  return [...keys].filter((k) => !same(from[k], to[k])).sort();
}

/**
 * An edit made offline meets the item as it is now. Fields only one side
 * changed are both kept; a field both changed to different values is a real
 * collision, left for the person to decide.
 */
export function mergeEdit(
  base: Item,
  mine: ItemInput & { version: number },
  theirs: Item,
): {
  body: ItemInput & { version: number };
  conflicts: string[];
} {
  const from = itemBody(base) as Record<string, unknown>;
  const now = itemBody(theirs) as Record<string, unknown>;
  const ours = mine as Record<string, unknown>;
  const mineChanged = changedFields(from, ours);
  const theirsChanged = new Set(changedFields(from, now));
  const conflicts = mineChanged.filter(
    (k) => theirsChanged.has(k) && !same(ours[k], now[k]),
  );
  const body: Record<string, unknown> = { ...now, version: theirs.version };
  for (const k of mineChanged) if (!conflicts.includes(k)) body[k] = ours[k];
  return { body: body as ItemInput & { version: number }, conflicts };
}

/** Words for a field in "Changed on another device: title and due date". */
export const FIELD_WORDS: Record<string, string> = {
  title: "title",
  notes: "notes",
  status: "status",
  priority: "priority",
  due_at: "date",
  end_at: "end time",
  estimate_minutes: "estimate",
  list_id: "list",
  tag_ids: "tags",
  assignee_id: "assignee",
  location: "location",
  rrule: "repeat",
  team_id: "team",
  progress: "progress",
};

export function fieldsLabel(fields: string[]) {
  const words = [...new Set(fields.map((f) => FIELD_WORDS[f] ?? f))];
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** "New task · Call the venue", for the list of what's waiting. */
export function describeOp(op: OutboxOp) {
  switch (op.type) {
    case "item.create":
      return `New ${op.input.kind === "event" ? "event" : "task"} · ${op.input.title}`;
    case "item.update":
      return `Edited · ${op.body.title}`;
    case "item.delete":
      return `Deleted · ${op.title}`;
    case "item.post":
      return op.body.status === "done"
        ? `Ticked · ${op.title}`
        : op.body.status
          ? `Marked ${op.body.status.replace("_", " ")} · ${op.title}`
          : `Progress · ${op.title}`;
    case "habit.create":
      return `New habit · ${op.body.name}`;
    case "habit.update":
      return `Edited habit · ${op.name}`;
    case "habit.delete":
      return `Deleted habit · ${op.name}`;
    case "booking.approve":
      return `Approved booking · ${op.who}`;
    case "booking.decline":
      return `Declined booking · ${op.who}`;
    case "booking.cancel":
      return `Cancelled booking · ${op.who}`;
    case "booking.reschedule":
      return `Moved booking · ${op.who}`;
    case "booking.note":
      return `Booking note · ${op.who}`;
  }
}

/**
 * The items as the person should see them: what the server last said, with
 * every change still waiting laid over it in order.
 */
export function applyOutbox(items: Item[], entries: OutboxEntry[]): Item[] {
  let out = items;
  for (const { op } of entries) {
    if (op.type === "item.create") {
      if (out.some((i) => i.id === op.input.id)) continue;
      const now = new Date().toISOString();
      out = [
        ...out,
        {
          notes: "",
          status: "todo",
          priority: "medium",
          due_at: null,
          end_at: null,
          team_id: null,
          progress: 0,
          version: 0,
          created_at: now,
          updated_at: now,
          ...op.input,
          kind: op.input.kind ?? "task",
        } as Item,
      ];
    } else if (op.type === "item.update" && !op.scope?.occurrence)
      out = out.map((i) =>
        i.id === op.id ? ({ ...i, ...op.body, version: i.version } as Item) : i,
      );
    else if (op.type === "item.delete" && !op.scope?.occurrence)
      out = out.filter((i) => i.id !== op.id);
    else if (op.type === "item.post")
      out = out.map((i) =>
        i.id === op.id
          ? {
              ...i,
              ...(op.body.status
                ? {
                    status: op.body.status,
                    progress: op.body.status === "done" ? 100 : i.progress,
                  }
                : {}),
              ...(op.body.progress !== undefined
                ? { progress: op.body.progress }
                : {}),
            }
          : i,
      );
  }
  return out;
}

/** Whether an error means "no connection" rather than "the server said no". */
export function isOfflineError(e: unknown) {
  if (!e || typeof e !== "object") return false;
  if ("status" in e && typeof (e as { status: unknown }).status === "number")
    return false;
  const name = (e as { name?: string }).name;
  const message = (e as { message?: string }).message ?? "";
  return (
    name === "TypeError" ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    /network|fetch|internet|offline|timed? ?out/i.test(message)
  );
}
