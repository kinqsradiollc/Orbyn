import {
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
  type Scope,
} from "./visibility.js";

/** Item facts and derived busy time must also honor the team's current AI consent. */
export function visibleAiItems(alias = "i", user = "$1"): string {
  return `${visibleItems(alias, { user, ai: true })} AND NOT EXISTS(SELECT 1 FROM teams ai_team WHERE ai_team.id=${alias}.team_id AND NOT ai_team.assistant_allowed)`;
}

/** Current source access for saved reminder cards, independent of whether work is now done. */
export function assistantSourceVisible(
  kind: string,
  id: string,
  user = "$1",
  includeJob = true,
  restriction?: Scope,
): string {
  const scope = { ...restriction, user, ai: true };
  const personal =
    restriction?.personal === undefined || restriction.personal === true
      ? "true"
      : restriction.personal === false
        ? "false"
        : restriction.personal;
  const teamScope = restriction?.teams
    ? ` AND source_member.team_id=ANY(${restriction.teams}::uuid[])`
    : "";
  const containerScope = restriction
    ? ` AND (${personal} OR source_chat.project_id IS NOT NULL OR source_chat.scope_kind='task')`
    : "";
  const jobCase = includeJob
    ? `WHEN 'job' THEN EXISTS(SELECT 1 FROM ai_jobs source_job JOIN ai_chats source_chat ON source_chat.id=source_job.chat_id WHERE source_job.id=${id} AND source_job.user_id=${user} AND source_chat.user_id=${user}${containerScope} AND (source_chat.project_id IS NULL OR EXISTS(SELECT 1 FROM projects source_project WHERE source_project.id=source_chat.project_id AND ${visibleProjects("source_project", scope)})) AND (source_chat.scope_kind IS DISTINCT FROM 'task' OR EXISTS(SELECT 1 FROM items source_item WHERE source_item.id=source_chat.scope_id AND ${visibleItems("source_item", scope)})) AND NOT EXISTS(SELECT 1 FROM assistant_chat_sources dependency WHERE dependency.chat_id=source_chat.id AND NOT ${assistantSourceVisible("dependency.source_kind", "dependency.source_id", user, false, restriction)}))`
    : "";
  // Chat content dependencies are flattened into each derived job/transcript by
  // recordAssistantSources. This terminal edge checks the original container's
  // current existence, owner and scope without recursively expanding CASE SQL.
  const chatCase = `WHEN 'chat' THEN EXISTS(SELECT 1 FROM ai_chats source_chat WHERE source_chat.id=${id} AND source_chat.user_id=${user}${containerScope}
      AND (source_chat.project_id IS NULL OR EXISTS(SELECT 1 FROM projects source_project WHERE source_project.id=source_chat.project_id AND ${visibleProjects("source_project", scope)}))
      AND (source_chat.scope_kind IS DISTINCT FROM 'task' OR EXISTS(SELECT 1 FROM items source_item WHERE source_item.id=source_chat.scope_id AND ${visibleItems("source_item", scope)})))`;
  const terminal: Record<string, string> = {
    page: `EXISTS(SELECT 1 FROM assistant_page_bindings source_binding JOIN docs source_doc ON source_doc.id=source_binding.doc_id WHERE source_binding.id=${id} AND source_binding.user_id=${user} AND ${visibleDocs("source_doc", scope)})`,
    doc: `EXISTS(SELECT 1 FROM docs source_doc WHERE source_doc.id=${id} AND ${visibleDocs("source_doc", scope)})`,
    project: `EXISTS(SELECT 1 FROM projects source_project WHERE source_project.id=${id} AND ${visibleProjects("source_project", scope)})`,
    team: `EXISTS(SELECT 1 FROM team_members source_member WHERE source_member.team_id=${id} AND source_member.user_id=${user}${teamScope})`,
    calendar: `EXISTS(SELECT 1 FROM calendar_subscriptions source_calendar WHERE source_calendar.id=${id} AND source_calendar.user_id=${user} AND ${personal})`,
    task: `EXISTS(SELECT 1 FROM items source_item WHERE source_item.id=${id} AND ${visibleItems("source_item", scope)})`,
    record: `EXISTS(SELECT 1 FROM work_records source_record WHERE source_record.id=${id} AND ${visibleRecords("source_record", scope)}
      AND (source_record.source_doc_id IS NULL OR EXISTS(SELECT 1 FROM docs source_doc WHERE source_doc.id=source_record.source_doc_id AND ${visibleDocs("source_doc", scope)})))`,
    routine: `EXISTS(SELECT 1 FROM agent_routines source_routine WHERE source_routine.id=${id} AND source_routine.user_id=${user} AND ${personal})`,
    habit: `EXISTS(SELECT 1 FROM habits source_habit WHERE source_habit.id=${id} AND source_habit.user_id=${user} AND ${personal})`,
    goal: `EXISTS(SELECT 1 FROM goals source_goal WHERE source_goal.id=${id} AND source_goal.user_id=${user} AND ${personal}
      AND (source_goal.project_id IS NULL OR EXISTS(SELECT 1 FROM projects source_project WHERE source_project.id=source_goal.project_id AND ${visibleProjects("source_project", scope)}))
      AND (source_goal.plan_doc_id IS NULL OR EXISTS(SELECT 1 FROM docs source_doc WHERE source_doc.id=source_goal.plan_doc_id AND ${visibleDocs("source_doc", scope)})))`,
    comment: `EXISTS(SELECT 1 FROM doc_comments source_comment JOIN docs source_doc ON source_doc.id=source_comment.doc_id WHERE source_comment.id=${id} AND ${visibleDocs("source_doc", scope)})`,
    exam: `EXISTS(SELECT 1 FROM study_exams source_exam WHERE source_exam.id=${id} AND source_exam.user_id=${user} AND ${personal}
      AND NOT EXISTS(SELECT 1 FROM unnest(source_exam.doc_ids) source_doc_id LEFT JOIN docs source_doc ON source_doc.id=source_doc_id WHERE source_doc.id IS NULL OR NOT ${visibleDocs("source_doc", scope)})
      AND (source_exam.own OR coalesce(source_exam.source_ref,source_exam.exam_key) NOT LIKE 'sub:%' OR EXISTS(SELECT 1 FROM calendar_subscriptions source_calendar JOIN external_events source_event ON source_event.subscription_id=source_calendar.id WHERE source_calendar.user_id=${user} AND ${personal} AND source_calendar.id::text=split_part(coalesce(source_exam.source_ref,source_exam.exam_key), ':', 2) AND md5(source_event.uid)=split_part(split_part(coalesce(source_exam.source_ref,source_exam.exam_key), ':', 3), '|', 1)))
      AND (source_exam.exam_key NOT LIKE 'item:%' OR EXISTS(SELECT 1 FROM items source_item WHERE source_item.id::text=split_part(split_part(source_exam.exam_key, ':', 2), '|', 1) AND ${visibleItems("source_item", scope)})))`,
  };
  // Literal callers already know the family. Avoid expanding unrelated
  // permission subqueries into every receipt query.
  // Dynamic source-kind columns still evaluate the complete allowlist.
  const literal = /^'([a-z]+)'$/.exec(kind)?.[1];
  if (literal && Object.prototype.hasOwnProperty.call(terminal, literal))
    return `(${terminal[literal]})`;
  return `(CASE ${kind}
    ${Object.entries(terminal)
      .map(([family, predicate]) => `WHEN '${family}' THEN ${predicate}`)
      .join("\n    ")}
    ${jobCase}
    ${chatCase}
    ELSE false END)`;
}
