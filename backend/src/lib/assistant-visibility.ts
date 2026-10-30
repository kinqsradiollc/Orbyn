import {
  assistantSourceVisible,
  assistantChatEntrySourcesVisible,
  type assistantSourceVisibilitySet,
} from "./assistant-source-visibility.js";
import { visibleItems, visibleProjects, type Scope } from "./visibility.js";

/** Publication and active handoffs retain the execution context they still need. */
export function assistantChatPendingDelivery(chatId: string) {
  return `(EXISTS(SELECT 1 FROM ai_jobs pending_job
    JOIN assistant_delivery_bindings pending_binding ON pending_binding.work_kind='job' AND pending_binding.work_id=pending_job.id
    JOIN assistant_delivery_intents pending_intent ON pending_intent.binding_id=pending_binding.id
    WHERE pending_job.chat_id=${chatId} AND pending_intent.state IN ('pending','deferred'))
    OR EXISTS(SELECT 1 FROM ai_jobs handoff_job JOIN assistant_handoffs pending_handoff
      ON pending_handoff.producer_job_id=handoff_job.id OR pending_handoff.recipient_job_id=handoff_job.id
      WHERE handoff_job.chat_id=${chatId} AND pending_handoff.status IN ('proposed','accepted')))`;
}

/** Container authority without interpreting a union of individual turn dependencies. */
export function assistantChatContainerVisible(
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
    AND NOT EXISTS(SELECT 1 FROM assistant_conversation_streams retired_source WHERE retired_source.chat_id=${chat}.id AND retired_source.retired_at IS NOT NULL)
    AND (${chat}.project_id IS NULL OR EXISTS(SELECT 1 FROM projects visible_project
      WHERE visible_project.id = ${chat}.project_id AND ${visibleProjects("visible_project", scope)}))
    AND (${chat}.scope_kind IS DISTINCT FROM 'task' OR EXISTS(SELECT 1 FROM items visible_task
      WHERE visible_task.id = ${chat}.scope_id AND ${visibleItems("visible_task", scope)})))`;
}

/** Legacy chats retain their whole-history dependency boundary. */
export function assistantChatVisible(
  chat = "c",
  user = "$1",
  restriction?: Scope,
  sourceSet?: ReturnType<typeof assistantSourceVisibilitySet>,
): string {
  const directSource = sourceSet
    ? sourceSet.predicate(
        "chat_dependency.source_kind",
        "chat_dependency.source_id",
        user,
        restriction,
        true,
      )
    : assistantSourceVisible(
        "chat_dependency.source_kind",
        "chat_dependency.source_id",
        user,
        false,
        restriction,
      );
  return `(${assistantChatContainerVisible(chat, user, restriction)} AND NOT EXISTS(SELECT 1 FROM assistant_chat_sources chat_dependency WHERE chat_dependency.chat_id=${chat}.id AND NOT ${directSource}) AND ${assistantChatEntrySourcesVisible(`${chat}.id`, user, restriction)})`;
}

/** Only callers that filter individual saved turns and execution context may use this. */
export function conversationExecutionChatVisible(
  chat = "c",
  owner = "$1",
  restriction?: Scope,
) {
  return `(${assistantChatVisible(chat, owner, restriction)} OR (${assistantChatContainerVisible(chat, owner, restriction)} AND ${chat}.swept_at IS NULL
  AND EXISTS(SELECT 1 FROM assistant_conversation_streams retained_stream WHERE retained_stream.chat_id=${chat}.id AND retained_stream.owner_id=${owner} AND retained_stream.retired_at IS NULL)))`;
}
