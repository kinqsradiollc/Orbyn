import { itemData, STATUSES, type Item, type ItemInput } from "@orbyn/core";

export type QuickCreateAttempt = {
  readonly owner: string;
  readonly generation: number;
  readonly text: string;
  readonly edit: number;
  readonly key: string;
  readonly at: number;
  readonly body: Readonly<Partial<ItemInput> & { id: string; title: string }>;
  uncertain: boolean;
  sent: boolean;
};
export function captureQuickCreate(
  input: Partial<ItemInput> & { title: string },
  owner: string,
  generation: number,
  text: string,
  edit: number,
): QuickCreateAttempt {
  const parsed = itemData.safeParse(input);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Check the task details before adding it.",
    );
  return {
    owner,
    generation,
    text,
    edit,
    key: crypto.randomUUID(),
    at: Date.now(),
    body: Object.freeze(
      structuredClone({ ...parsed.data, id: crypto.randomUUID() }),
    ),
    uncertain: false,
    sent: false,
  };
}
export function quickReplayAllowed(
  attempt: QuickCreateAttempt,
  now = Date.now(),
) {
  const age = now - attempt.at;
  return Number.isFinite(age) && age >= 0 && age < 23 * 60 * 60 * 1000;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function ownsQuickReceipt(
  value: unknown,
  attempt: QuickCreateAttempt,
): value is Item {
  return (
    record(value) &&
    value.id === attempt.body.id &&
    value.user_id === attempt.owner &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    value.title.length <= 200 &&
    typeof value.notes === "string" &&
    value.notes.length <= 10000 &&
    typeof value.status === "string" &&
    STATUSES.some((status) => status === value.status) &&
    typeof value.priority === "string" &&
    ["high", "medium", "low"].includes(value.priority) &&
    Array.isArray(value.tag_ids) &&
    value.tag_ids.every(
      (id) =>
        typeof id === "string" &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
    ) &&
    (value.due_at === null ||
      (typeof value.due_at === "string" &&
        Number.isFinite(Date.parse(value.due_at)))) &&
    (value.end_at === null ||
      (typeof value.end_at === "string" &&
        Number.isFinite(Date.parse(value.end_at)))) &&
    (value.team_id === null ||
      (typeof value.team_id === "string" &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
          value.team_id,
        ))) &&
    (value.kind === "task" || value.kind === "event") &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    value.version > 0
  );
}
const same = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) && Array.isArray(right))
    return (
      JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
    );
  return left === right;
};
/** Compare the submitted fields, not server-generated labels, counters or defaults omitted by the person. */
export function matchesQuickReceipt(
  value: unknown,
  attempt: QuickCreateAttempt,
): value is Item {
  if (!ownsQuickReceipt(value, attempt)) return false;
  const result: Record<string, unknown> = { ...value };
  for (const [key, expected] of Object.entries(attempt.body)) {
    if (key === "id" || expected === undefined) continue;
    const actual = result[key];
    if (key === "due_at" || key === "end_at") {
      if (
        expected === null
          ? actual != null
          : typeof expected !== "string" ||
            typeof actual !== "string" ||
            !Number.isFinite(Date.parse(actual)) ||
            Date.parse(expected) !== Date.parse(actual)
      )
        return false;
    } else if (
      (key === "tag_ids" ||
        key === "prerequisite_ids" ||
        key === "alerts" ||
        key === "attendees" ||
        key === "links") &&
      Array.isArray(expected)
    ) {
      if (!same(expected, actual ?? [])) return false;
    } else if (!same(expected, actual)) return false;
  }
  return true;
}
