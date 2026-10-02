import { assistantSourceVisible } from "./assistant-source-visibility.js";
import { visibleItems, visibleProjects, type Scope } from "./visibility.js";

/** Current owner and source access for saved assistant conversations. */
export function assistantChatVisible(
  chat = "c",
  user = "$1",
  restriction?: Scope,
): string {
  const scope = { ...restriction, user, ai: true };
  const personal =
    restriction?.personal === undefined || restriction.personal === true
      ? "true"
      : restriction.personal === false
        ? "false"
        : restriction.personal;
  const containerScope = restriction
    ? ` AND (${personal} OR ${chat}.project_id IS NOT NULL OR ${chat}.scope_kind='task')`
    : "";
  return `(${chat}.user_id = ${user}${containerScope}
    AND (${chat}.project_id IS NULL OR EXISTS(SELECT 1 FROM projects visible_project
      WHERE visible_project.id = ${chat}.project_id AND ${visibleProjects("visible_project", scope)}))
    AND NOT EXISTS(SELECT 1 FROM assistant_chat_sources chat_dependency WHERE chat_dependency.chat_id=${chat}.id AND NOT ${assistantSourceVisible("chat_dependency.source_kind", "chat_dependency.source_id", user, false, restriction)})
    AND (${chat}.scope_kind IS DISTINCT FROM 'task' OR EXISTS(SELECT 1 FROM items visible_task
      WHERE visible_task.id = ${chat}.scope_id AND ${visibleItems("visible_task", scope)})))`;
}
