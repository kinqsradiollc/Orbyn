import {
  fail,
  quoteOf,
  type ChatScope,
  type ChatView,
  type DocBlock,
} from "@orbyn/core";
import type { Queryable } from "../../../db/pool.js";
import { KeptOutError, type KeptOut } from "../../../lib/assistant-off.js";
import { assistantMayRead, docVisibleTo } from "../../../lib/doc-visibility.js";
import { visibleItems } from "../../../lib/visibility.js";
import { readableLinks } from "../../links/privacy.js";
import { visibleProjectActivity } from "../../projects/activity-visibility.js";
import { projectVisible } from "../../projects/service.js";
import { type AgentContext, getItem } from "./tools.js";
import { getProject } from "./workspace.js";

/**
 * Permission-check a chat's project or task scope and read its facts.
 *
 * Runs with the job owner's id at request admission and again at the start of
 * every run attempt, including resumes, so a scope that became kept out of the
 * assistant or lost its access stops the run before any provider call.
 */
export async function scopeOverview(
  db: Queryable,
  user: { id: string; role: AgentContext["user"]["role"] },
  timezone: string,
  scope: ChatScope | null,
  keptOut: KeptOut,
) {
  if (!scope) return null;
  // A project kept out of the assistant (or a task in one) can't be a scope.
  if (keptOut.projects.has(scope.id) || keptOut.ids.has(scope.id))
    fail(422, new KeptOutError().message);
  const ctx: AgentContext = {
    user,
    timezone,
    intentText: "",
    actions: [],
    clarification: null,
  };
  if (scope.kind === "project") {
    if (!(await projectVisible(db, user.id, scope.id)))
      fail(404, "Project not found");
    const [project, changes] = await Promise.all([
      getProject(ctx, { project_id: scope.id }),
      db.query<{ id: string; summary: string; created_at: Date }>(
        `SELECT a.id, a.summary, a.created_at FROM project_activity a
           JOIN project_visits v ON v.project_id = a.project_id AND v.user_id = $1
          WHERE a.project_id = $2 AND v.previous_seen_at IS NOT NULL
            AND a.created_at > v.previous_seen_at
            AND ${visibleProjectActivity("$1")}
          ORDER BY a.event_order DESC LIMIT 8`,
        [user.id, scope.id],
      ),
    ]);
    return {
      kind: "project" as const,
      id: scope.id,
      name: project.name,
      summary: project.summary,
      deadline: project.deadline,
      your_plan: project.your_plan,
      brief: project.brief,
      stages: project.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
      })),
      tasks: project.stages.flatMap((stage) => stage.open_tasks).slice(0, 12),
      open_decisions: project.open_records
        .filter((record) => record.kind === "decision")
        .slice(0, 8),
      pages: project.notes.slice(0, 6),
      your_sessions: project.your_sessions.slice(0, 8),
      since_last_visit: changes.rows.map((change) => ({
        id: change.id,
        summary: change.summary,
        at: change.created_at.toISOString(),
      })),
    };
  }
  const visible = await db.query(
    `SELECT 1 FROM items i WHERE i.id = $2 AND i.kind = 'task' AND ${visibleItems()}`,
    [user.id, scope.id],
  );
  if (!visible.rows.length) fail(404, "Task not found");
  const task = await getItem(ctx, { id: scope.id });
  const [children, source] = await Promise.all([
    db.query<{ id: string; title: string; status: string }>(
      `SELECT i.id, i.title, i.status FROM items i
        WHERE i.parent_id = $2 AND ${visibleItems()}
        ORDER BY i.created_at LIMIT 12`,
      [user.id, scope.id],
    ),
    db.query<{
      doc_id: string;
      title: string;
      block_id: string;
      content: DocBlock[];
    }>(
      `SELECT d.id AS doc_id, d.title, l.block_id, d.content
         FROM doc_task_links l JOIN docs d ON d.id = l.doc_id
        WHERE l.item_id = $2 AND ${docVisibleTo("$1")}
          AND ${assistantMayRead("d")}
        ORDER BY l.created_at LIMIT 1`,
      [user.id, scope.id],
    ),
  ]);
  const cameFrom = source.rows[0];
  return {
    kind: "task" as const,
    id: scope.id,
    name: task.title,
    due_at: task.due_at,
    notes: task.notes.slice(0, 600),
    planning: task.planning,
    checklist: task.checklist.slice(0, 12),
    subtasks: children.rows,
    source_page: cameFrom
      ? {
          doc_id: cameFrom.doc_id,
          title: cameFrom.title,
          block_id: cameFrom.block_id,
          // Links to what the person can't open keep no title (D3aF).
          quote: quoteOf(
            await readableLinks(
              db,
              user.id,
              cameFrom.content.find((block) => block.id === cameFrom.block_id),
            ),
          ),
        }
      : null,
  };
}

export type ScopedFacts = NonNullable<
  Awaited<ReturnType<typeof scopeOverview>>
>;

/** The selected scope a run may name without reading its facts. */
export type SelectedScope = {
  kind: "project" | "task";
  id: string;
  name?: string;
};

/** Workspace screens the assistant may name; anything else is "other". */
const SCREENS = new Set([
  "today",
  "home",
  "overview",
  "tasks",
  "task",
  "add",
  "search",
  "projects",
  "project",
  "views",
  "view",
  "lists",
  "calendar",
  "docs",
  "doc",
  "memory",
  "brief",
  "assistant",
  "background",
  "overnight",
  "review",
  "study",
  "teams",
  "booking",
  "notifications",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTER_KEY = /^[a-z][a-z0-9_]{0,31}$/;

/** What a view's path says, before any database check. Pure; never trusts ids. */
export function parseChatView(view: ChatView) {
  const [, , first, second] = view.path.split("/");
  const screen = !first ? "today" : SCREENS.has(first) ? first : "other";
  const id = second && UUID.test(second) ? second.toLowerCase() : null;
  const kind =
    id && screen === "task"
      ? ("task" as const)
      : id && screen === "project"
        ? ("project" as const)
        : id && screen === "doc"
          ? ("page" as const)
          : null;
  const filters: Record<string, string> = {};
  if (view.query) {
    const params = new URLSearchParams(view.query);
    let count = 0;
    for (const [key, value] of params) {
      if (count >= 8) break;
      if (!FILTER_KEY.test(key) || key in filters) continue;
      // UI state only: bounded, single line, never a link target.
      filters[key] = value.replace(/[\r\n\t]+/g, " ").slice(0, 80);
      count++;
    }
  }
  return {
    pane: view.pane,
    screen,
    selected: kind && id ? { kind, id } : null,
    filters,
  };
}

/**
 * The person's current workspace view, re-checked for this run. A selected
 * task, page or project the person can't see, or that is kept out of the
 * assistant, is dropped rather than named; titles come from the database,
 * never from the client.
 */
export async function resolveChatView(
  db: Queryable,
  userId: string,
  view: ChatView | undefined,
  keptOut: KeptOut,
) {
  if (!view) return null;
  const parsed = parseChatView(view);
  let selected: {
    kind: "task" | "page" | "project";
    id: string;
    title: string;
  } | null = null;
  const pick = parsed.selected;
  if (pick && !keptOut.ids.has(pick.id) && !keptOut.projects.has(pick.id)) {
    const row =
      pick.kind === "task"
        ? (
            await db.query<{ title: string }>(
              `SELECT i.title FROM items i WHERE i.id = $2 AND ${visibleItems("i", { user: "$1", ai: true })}`,
              [userId, pick.id],
            )
          ).rows[0]
        : pick.kind === "page"
          ? (
              await db.query<{ title: string }>(
                `SELECT d.title FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")} AND ${assistantMayRead("d")}`,
                [userId, pick.id],
              )
            ).rows[0]
          : (await projectVisible(db, userId, pick.id))
            ? (
                await db.query<{ title: string }>(
                  "SELECT p.name AS title FROM projects p WHERE p.id = $1 AND NOT p.assistant_off",
                  [pick.id],
                )
              ).rows[0]
            : undefined;
    if (row) selected = { kind: pick.kind, id: pick.id, title: row.title };
  }
  return {
    pane: parsed.pane,
    screen: parsed.screen,
    ...(selected ? { selected } : {}),
    ...(Object.keys(parsed.filters).length ? { filters: parsed.filters } : {}),
  };
}

export type ResolvedChatView = NonNullable<
  Awaited<ReturnType<typeof resolveChatView>>
>;

/** A database title as quoted data: one line, bounded, JSON-escaped. */
const quoted = (title: string) =>
  JSON.stringify(
    title.replace(/[\u0000-\u001f\u2028\u2029]+/g, " ").slice(0, 120),
  );

/**
 * One explicit line naming the conversation's scope, for the lead and its
 * specialists. Structured-output providers weigh plain sentences more than
 * JSON context, so the scope is stated outright.
 */
export function scopeInstruction(
  scope: SelectedScope | null,
  view: ResolvedChatView | null,
) {
  const lines: string[] = [];
  if (scope)
    lines.push(
      `This is a ${scope.kind} chat. The selected ${scope.kind} is ${
        scope.name ? `${quoted(scope.name)} ` : ""
      }(id ${scope.id}). "This ${scope.kind}" means it. The context's "scope" holds its current facts; use the tools for more and stay inside it unless the latest request asks about something else.`,
    );
  if (view)
    lines.push(
      `The person is looking at the ${view.screen} screen in the ${view.pane} pane${
        view.selected
          ? `, with the ${view.selected.kind} ${quoted(view.selected.title)} (id ${view.selected.id}) open`
          : ""
      }. This is where they are, not a request; it does not change the chat's scope.`,
    );
  return lines.join("\n");
}

/** The scope line for a run, read back from its saved context. */
export function scopeInstructionFromContext(context: unknown) {
  if (!context || typeof context !== "object") return "";
  const { scope, viewing } = context as {
    scope?: { kind?: unknown; id?: unknown; name?: unknown };
    viewing?: ResolvedChatView;
  };
  const selected: SelectedScope | null =
    scope &&
    (scope.kind === "project" || scope.kind === "task") &&
    typeof scope.id === "string"
      ? {
          kind: scope.kind,
          id: scope.id,
          ...(typeof scope.name === "string" ? { name: scope.name } : {}),
        }
      : null;
  const view = viewing && typeof viewing.screen === "string" ? viewing : null;
  return scopeInstruction(selected, view);
}
