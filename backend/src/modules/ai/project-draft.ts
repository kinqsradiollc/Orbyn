import { projectDraftSchema, type ProjectDraft } from "@orbyn/core";
export type { ProjectDraft } from "@orbyn/core";

/**
 * Validate the provider's entire graph before any proposal or item is stored.
 * Invalid tasks cannot be silently dropped: other tasks may depend on them.
 * Stable topological order keeps independent tasks in the provider's order.
 */
export function parseProjectDraft(content: string): ProjectDraft {
  const clean = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*|```\s*$/gim, "")
    .trim();
  const raw = JSON.parse(
    clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1),
  );
  const draft = projectDraftSchema.parse(withTaskIds(raw));
  const ids = new Set(draft.tasks.map((t) => t.id));
  if (ids.size !== draft.tasks.length)
    throw new Error("Duplicate task references");
  for (const t of draft.tasks) {
    if (new Set(t.depends_on).size !== t.depends_on.length)
      throw new Error("Duplicate dependencies");
    if (t.depends_on.some((id) => id === t.id || !ids.has(id)))
      throw new Error("Unknown or self-referencing dependency");
  }
  const pending = [...draft.tasks];
  const ordered: ProjectDraft["tasks"] = [];
  const done = new Set<string>();
  while (pending.length) {
    const at = pending.findIndex((t) =>
      t.depends_on.every((id) => done.has(id)),
    );
    if (at < 0) throw new Error("Cyclic project dependencies");
    const [next] = pending.splice(at, 1);
    ordered.push(next);
    done.add(next.id);
  }
  return { ...draft, tasks: ordered };
}

/**
 * Name the tasks a provider left unnamed.
 *
 * Ids exist to carry dependencies, so a model that returns a plain list of
 * tasks — no ids, no `depends_on` — has described a valid project with no
 * edges, and rejecting it would turn a working flow into a 502 for exactly the
 * smaller models this has to run on. Synthesised ids skip anything the
 * provider already used, so a partly-named response cannot collide.
 */
function withTaskIds(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const tasks = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return raw;
  const taken = new Set(
    tasks
      .map((t) =>
        t &&
        typeof t === "object" &&
        typeof (t as { id?: unknown }).id === "string"
          ? ((t as { id: string }).id ?? "").trim()
          : "",
      )
      .filter(Boolean),
  );
  let n = 0;
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const id = (task as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) continue;
    let made: string;
    do {
      made = `t${(n += 1)}`;
    } while (taken.has(made));
    taken.add(made);
    (task as { id: string }).id = made;
  }
  return raw;
}

/** Provider contract for a reviewable project, including explicit dependencies. */
export const PROJECT_DRAFT_PROMPT = `You break projects into concrete, actionable subtasks.
Reply with ONE JSON object and nothing else:
{"title": string, "tasks": [{"id": string, "title": string, "notes": string, "estimate_minutes": integer, "due_in_days": integer, "depends_on": string[]}]}
Use 3 to 15 tasks. Give every task a unique short id containing letters, digits, underscores or hyphens.
Every task needs a realistic estimate_minutes from 5 to 10080 and due_in_days from 0 to 365 (today is 0).
The depends_on array names prerequisite task ids in this same response. Use [] for independent tasks.
Dependencies must not reference the task itself, unknown ids, or form cycles. Do not invent a dependency just to force a list order.
Use short, concrete titles. Do not invent calendar times: Orbyn's scheduler will place the tasks in available frames after review.`;
