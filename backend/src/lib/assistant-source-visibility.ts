import { deliveryBindingVisible } from "./assistant-binding-visibility.js";
import { assistantChatContainerVisible } from "./assistant-visibility.js";
import {
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
  type Scope,
} from "./visibility.js";

/** A direct-source proof belongs to one statement and one authority context.
 * Callers supply source identities, never authorization results. Materialize
 * before reusing the predicate; derived turn/binding guards remain separate. */
export function assistantSourceVisibilitySet(
  name: string,
  sources: string,
  user = "$1",
  scope?: Scope,
  includeDerived = true,
) {
  if (!/^[a-z_][a-z0-9_]{0,39}$/.test(name))
    throw new Error("Invalid source visibility relation.");
  const context = (
    owner: string,
    restriction: Scope | undefined,
    derived: boolean,
  ) =>
    JSON.stringify([
      owner,
      restriction?.user,
      restriction?.teams,
      restriction?.personal,
      restriction?.ai,
      derived,
    ]);
  const binding = context(user, scope, includeDerived);
  return {
    cte: `${name} AS MATERIALIZED (
      SELECT source_root.kind,source_root.id,
        ${assistantSourceVisible("source_root.kind", "source_root.id", user, false, scope, includeDerived)} AS visible
      FROM (SELECT DISTINCT kind,id FROM (${sources}) direct_sources) source_root
    )`,
    predicate(
      kind: string,
      id: string,
      owner: string,
      restriction: Scope | undefined,
      derived: boolean,
    ) {
      if (binding !== context(owner, restriction, derived))
        throw new Error("Source visibility cannot cross authority contexts.");
      return `EXISTS(SELECT 1 FROM ${name} source_proof
        WHERE source_proof.kind=${kind} AND source_proof.id=${id} AND source_proof.visible)`;
    },
  };
}

/** Item facts and derived busy time must also honor the team's current AI consent. */
export function visibleAiItems(alias = "i", user = "$1"): string {
  return `${visibleItems(alias, { user, ai: true })} AND NOT EXISTS(SELECT 1 FROM teams ai_team WHERE ai_team.id=${alias}.team_id AND NOT ai_team.assistant_allowed)`;
}

function retainedEntryContainerVisible(
  id: string,
  user: string,
  restriction?: Scope,
) {
  return `EXISTS(SELECT 1 FROM assistant_conversation_entries lineage_entry
    JOIN assistant_conversation_streams lineage_stream ON lineage_stream.id=lineage_entry.destination_id
    JOIN ai_chats lineage_chat ON lineage_chat.id=lineage_stream.chat_id
    JOIN users lineage_owner ON lineage_owner.id=lineage_stream.owner_id
    WHERE lineage_entry.id=${id} AND lineage_entry.sources_checked AND lineage_stream.owner_id=${user}
      AND NOT lineage_owner.disabled AND lineage_stream.retired_at IS NULL AND lineage_chat.swept_at IS NULL
      AND ${assistantChatContainerVisible("lineage_chat", user, restriction)})`;
}

/** Every outgoing document edge, shared by traversal and the leaf proof. */
function documentSourceEdges(kind: string, id: string): string[] {
  return [
    `SELECT s.source_type AS kind,s.source_id AS id FROM memory_sources s
        WHERE ${kind}='doc' AND s.doc_id=${id} AND s.source_id IS NOT NULL AND s.source_type IN ('task','doc','project','chat') AND NOT (s.source_type='chat' AND s.retained_entries)`,
    `SELECT 'entry',s.source_entry_id FROM memory_entry_sources s WHERE ${kind}='doc' AND s.doc_id=${id}`,
  ];
}

/** Complete installed function body, including the one-node document shortcut.
 * These are exactly the graph's outgoing document edges. A STABLE function
 * observes the same statement snapshot for the base check and edge checks.
 */
export function assistantSourceGraphBody(): string {
  const scope = { user: "p_user", personal: "p_personal", teams: "p_teams" };
  const documentVisible = assistantSourceVisible(
    "'doc'",
    "p_id",
    "p_user",
    false,
    scope,
    false,
  );
  const noDocumentEdges = documentSourceEdges("p_kind", "p_id")
    .map((select) => `NOT EXISTS (\n      ${select}\n    )`)
    .join(" AND ");
  return `BEGIN
  IF p_kind='doc' THEN
    IF NOT ${documentVisible} THEN
      RETURN false;
    END IF;
    IF ${noDocumentEdges} THEN
      RETURN true;
    END IF;
  END IF;
  RETURN ${assistantSourceGraphSql("SELECT p_kind AS kind,p_id AS id", "p_user", scope)};
END`;
}

/** Current transitive authority for retained entries, Memory and legacy chats.
 * Scope travels with each edge: a narrower grant cannot borrow the owner's
 * broader access through a nested Memory document. UNION terminates cycles.
 * Terminal checks never expand the graph again.
 */
export function assistantSourceGraphSql(
  seed: string,
  user: string,
  restriction?: Scope,
): string {
  const personal =
    restriction?.personal === false
      ? "false"
      : restriction?.personal === undefined || restriction.personal === true
        ? "true"
        : restriction.personal;
  const teams =
    restriction?.teams ??
    `ARRAY(SELECT team_id FROM team_members WHERE user_id=${user})`;
  const scope = {
    user,
    personal: "lineage_source.personal",
    teams: "lineage_source.teams",
    ai: true,
  };
  return `NOT EXISTS (
    WITH RECURSIVE lineage(kind,id,personal,teams) AS (
      SELECT seed.kind,seed.id,${personal}::boolean,${teams}::uuid[] FROM (${seed}) seed
      UNION
      SELECT edge.kind,edge.id,
        parent.personal AND CASE WHEN parent.kind='binding' THEN coalesce(edge_grant.personal,false) AND coalesce(edge_binding.reason<>'personal' OR edge_grant.personal,false) ELSE true END,
        CASE WHEN parent.kind='binding' THEN ARRAY(
          SELECT unnest(parent.teams) INTERSECT SELECT unnest(CASE WHEN edge_binding.reason='personal' THEN '{}'::uuid[] ELSE coalesce(edge_grant.team_ids,parent.teams) END)
          ORDER BY 1) ELSE parent.teams END
      FROM lineage parent
      LEFT JOIN assistant_delivery_bindings edge_binding ON parent.kind='binding' AND edge_binding.id=parent.id
      LEFT JOIN agent_grants edge_grant ON edge_grant.id=edge_binding.grant_id
      CROSS JOIN LATERAL (
        ${documentSourceEdges("parent.kind", "parent.id").join("\n        UNION ")}
        UNION SELECT s.source_kind,s.source_id FROM assistant_chat_sources s WHERE parent.kind='chat' AND s.chat_id=parent.id
        UNION SELECT 'entry',s.source_entry_id FROM assistant_turn_entry_sources s WHERE parent.kind='chat' AND s.chat_id=parent.id
        UNION SELECT 'doc',r.source_doc_id FROM work_records r WHERE parent.kind='record' AND r.id=parent.id AND r.source_doc_id IS NOT NULL
        UNION SELECT 'doc',g.plan_doc_id FROM goals g WHERE parent.kind='goal' AND g.id=parent.id AND g.plan_doc_id IS NOT NULL
        UNION SELECT 'doc',p.doc_id FROM assistant_page_bindings p WHERE parent.kind='page' AND p.id=parent.id
        UNION SELECT 'doc',c.doc_id FROM doc_comments c WHERE parent.kind='comment' AND c.id=parent.id
        UNION SELECT 'doc',unnest(e.doc_ids) FROM study_exams e WHERE parent.kind='exam' AND e.id=parent.id
        UNION SELECT s.source_kind,s.source_id FROM assistant_conversation_entry_sources s WHERE parent.kind='entry' AND s.entry_id=parent.id
        UNION SELECT 'entry',s.source_entry_id FROM assistant_conversation_entries e
          JOIN assistant_conversation_streams stream ON stream.id=e.destination_id
          JOIN assistant_turn_entry_sources s ON s.chat_id=stream.chat_id AND s.turn_id=e.turn_id WHERE parent.kind='entry' AND e.id=parent.id
        UNION SELECT 'binding',i.binding_id FROM assistant_conversation_entries e
          JOIN assistant_delivery_intents i ON i.id=e.intent_id WHERE parent.kind='entry' AND e.id=parent.id
        UNION SELECT s.source_kind,s.source_id FROM assistant_delivery_sources s WHERE parent.kind='binding' AND s.binding_id=parent.id
        UNION SELECT 'entry',s.source_entry_id FROM assistant_delivery_entry_sources s WHERE parent.kind='binding' AND s.binding_id=parent.id
        UNION SELECT s.source_kind,s.source_id FROM assistant_delivery_bindings b
          JOIN assistant_job_sources s ON b.work_kind='job' AND s.job_id=b.work_id WHERE parent.kind='binding' AND b.id=parent.id
        UNION SELECT 'entry',s.source_entry_id FROM assistant_delivery_bindings b
          JOIN ai_jobs j ON b.work_kind='job' AND j.id=b.work_id
          JOIN assistant_turn_entry_sources s ON s.chat_id=j.chat_id AND s.turn_id=j.turn_id WHERE parent.kind='binding' AND b.id=parent.id
      ) edge
    )
    SELECT 1 FROM lineage lineage_source WHERE NOT (
      CASE WHEN lineage_source.kind='entry' THEN ${retainedEntryContainerVisible("lineage_source.id", user, scope)}
      WHEN lineage_source.kind='binding' THEN EXISTS(
        SELECT 1 FROM assistant_delivery_bindings lineage_binding WHERE lineage_binding.id=lineage_source.id
        AND ${deliveryBindingVisible("lineage_binding", user, false)}
      ) ELSE ${assistantSourceVisible("lineage_source.kind", "lineage_source.id", user, false, scope, false)}
      END
      AND (lineage_source.kind<>'chat' OR EXISTS(
        SELECT 1 FROM ai_chats memory_chat WHERE memory_chat.id=lineage_source.id
        AND (memory_chat.origin='person' OR EXISTS(SELECT 1 FROM assistant_chat_sources recorded WHERE recorded.chat_id=memory_chat.id))
      ))
    ))`;
}

export function assistantMemorySourcesVisible(
  docId: string,
  user = "$1",
  restriction?: Scope,
): string {
  return sourceGraphCall("'doc'", docId, user, restriction);
}

export function assistantTurnSourcesVisible(
  chatId: string,
  turnId: string,
  user = "$1",
  restriction?: Scope,
): string {
  return `NOT EXISTS(SELECT 1 FROM assistant_turn_entry_sources turn_source WHERE turn_source.chat_id=${chatId} AND turn_source.turn_id=${turnId} AND NOT ${sourceGraphCall("'entry'", "turn_source.source_entry_id", user, restriction)})`;
}

export function assistantBindingEntrySourcesVisible(
  bindingId: string,
  user = "$1",
  restriction?: Scope,
): string {
  return `NOT EXISTS(SELECT 1 FROM assistant_delivery_entry_sources binding_source WHERE binding_source.binding_id=${bindingId} AND NOT ${sourceGraphCall("'entry'", "binding_source.source_entry_id", user, restriction)})`;
}

export function assistantChatEntrySourcesVisible(
  chatId: string,
  user = "$1",
  restriction?: Scope,
): string {
  return `NOT EXISTS(SELECT 1 FROM assistant_turn_entry_sources chat_source WHERE chat_source.chat_id=${chatId} AND NOT ${sourceGraphCall("'entry'", "chat_source.source_entry_id", user, restriction)})`;
}

export function assistantPageRunEntrySourcesVisible(
  runId: string,
  user = "$1",
  restriction?: Scope,
): string {
  return `NOT EXISTS(SELECT 1 FROM assistant_page_run_entry_sources page_source WHERE page_source.run_id=${runId} AND NOT ${sourceGraphCall("'entry'", "page_source.source_entry_id", user, restriction)})`;
}

export function assistantRetainedEntryVisible(
  entryId: string,
  user = "$1",
  restriction?: Scope,
) {
  return sourceGraphCall("'entry'", entryId, user, restriction);
}

/** Completeness evidence for automated transcripts; absence is not an empty source set. */
export function assistantChatEvidenceKnown(chat: string, user = "$1") {
  return `(${chat}.origin='person' OR EXISTS(SELECT 1 FROM ai_jobs known_job WHERE known_job.chat_id=${chat}.id AND known_job.user_id=${user} AND known_job.sources_checked)
    OR EXISTS(SELECT 1 FROM assistant_delivery_bindings known_binding JOIN assistant_delivery_intents known_intent ON known_intent.binding_id=known_binding.id
      JOIN assistant_conversation_entries known_entry ON known_entry.intent_id=known_intent.id
      WHERE known_binding.owner_id=${user} AND known_binding.sources_checked AND known_entry.sources_checked
        AND known_intent.state='published' AND known_intent.payload->>'execution_chat_id'=${chat}.id::text))`;
}

function sourceGraphCall(
  kind: string,
  id: string,
  user: string,
  restriction?: Scope,
) {
  const personal =
    restriction?.personal === false
      ? "false"
      : restriction?.personal === undefined || restriction.personal === true
        ? "true"
        : restriction.personal;
  const teams =
    restriction?.teams ??
    `ARRAY(SELECT team_id FROM team_members WHERE user_id=${user})`;
  return `assistant_source_graph_visible(${kind},${id},${user},${personal},${teams})`;
}

/** Current source access for saved reminder cards, independent of whether work is now done. */
export function assistantSourceVisible(
  kind: string,
  id: string,
  user = "$1",
  includeJob = true,
  restriction?: Scope,
  includeDerived = true,
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
  const derivedDoc = includeDerived
    ? ` AND ${assistantMemorySourcesVisible("source_doc.id", user, restriction)}`
    : "";
  const jobCase = includeJob
    ? `WHEN 'job' THEN EXISTS(SELECT 1 FROM ai_jobs source_job JOIN ai_chats source_chat ON source_chat.id=source_job.chat_id WHERE source_job.id=${id} AND source_job.user_id=${user} AND source_chat.user_id=${user}${containerScope} AND (source_chat.project_id IS NULL OR EXISTS(SELECT 1 FROM projects source_project WHERE source_project.id=source_chat.project_id AND ${visibleProjects("source_project", scope)})) AND (source_chat.scope_kind IS DISTINCT FROM 'task' OR EXISTS(SELECT 1 FROM items source_item WHERE source_item.id=source_chat.scope_id AND ${visibleItems("source_item", scope)})) AND NOT EXISTS(SELECT 1 FROM assistant_chat_sources dependency WHERE dependency.chat_id=source_chat.id AND NOT ${assistantSourceVisible("dependency.source_kind", "dependency.source_id", user, false, restriction)}))`
    : "";
  // Chat content dependencies are flattened into each derived job/transcript by
  // recordAssistantSources. This terminal edge checks the original container's
  // current existence, owner and scope without recursively expanding CASE SQL.
  const chatCase = `WHEN 'chat' THEN EXISTS(SELECT 1 FROM ai_chats source_chat WHERE source_chat.id=${id} AND ${assistantChatContainerVisible("source_chat", user, restriction)})`;
  const terminal: Record<string, string> = {
    binding: includeDerived
      ? sourceGraphCall("'binding'", id, user, restriction)
      : `EXISTS(SELECT 1 FROM assistant_delivery_bindings source_delivery JOIN agent_grants source_grant ON source_grant.id=source_delivery.grant_id
          JOIN users source_owner ON source_owner.id=source_delivery.owner_id
          WHERE source_delivery.id=${id} AND source_delivery.owner_id=${user} AND source_delivery.sources_checked
            AND source_grant.user_id=${user} AND NOT source_owner.disabled
            AND source_grant.revoked_at IS NULL AND source_grant.suspended_at IS NULL
            AND (source_grant.expires_at IS NULL OR source_grant.expires_at>now()))`,
    entry: includeDerived
      ? sourceGraphCall("'entry'", id, user, restriction)
      : retainedEntryContainerVisible(id, user, restriction),
    page: `EXISTS(SELECT 1 FROM assistant_page_bindings source_binding JOIN docs source_doc ON source_doc.id=source_binding.doc_id WHERE source_binding.id=${id} AND source_binding.user_id=${user} AND ${visibleDocs("source_doc", scope)}${derivedDoc})`,
    doc: `EXISTS(SELECT 1 FROM docs source_doc WHERE source_doc.id=${id} AND ${visibleDocs("source_doc", scope)}${derivedDoc})`,
    project: `EXISTS(SELECT 1 FROM projects source_project WHERE source_project.id=${id} AND ${visibleProjects("source_project", scope)})`,
    team: `EXISTS(SELECT 1 FROM team_members source_member WHERE source_member.team_id=${id} AND source_member.user_id=${user}${teamScope})`,
    calendar: `EXISTS(SELECT 1 FROM calendar_subscriptions source_calendar WHERE source_calendar.id=${id} AND source_calendar.user_id=${user} AND ${personal})`,
    task: `EXISTS(SELECT 1 FROM items source_item WHERE source_item.id=${id} AND ${visibleItems("source_item", scope)})`,
    record: `EXISTS(SELECT 1 FROM work_records source_record WHERE source_record.id=${id} AND ${visibleRecords("source_record", scope)}
      AND (source_record.source_doc_id IS NULL OR EXISTS(SELECT 1 FROM docs source_doc WHERE source_doc.id=source_record.source_doc_id AND ${visibleDocs("source_doc", scope)}${derivedDoc})))`,
    routine: `EXISTS(SELECT 1 FROM agent_routines source_routine WHERE source_routine.id=${id} AND source_routine.user_id=${user} AND ${personal})`,
    habit: `EXISTS(SELECT 1 FROM habits source_habit WHERE source_habit.id=${id} AND source_habit.user_id=${user} AND ${personal})`,
    goal: `EXISTS(SELECT 1 FROM goals source_goal WHERE source_goal.id=${id} AND source_goal.user_id=${user} AND ${personal}
      AND (source_goal.project_id IS NULL OR EXISTS(SELECT 1 FROM projects source_project WHERE source_project.id=source_goal.project_id AND ${visibleProjects("source_project", scope)}))
      AND (source_goal.plan_doc_id IS NULL OR EXISTS(SELECT 1 FROM docs source_doc WHERE source_doc.id=source_goal.plan_doc_id AND ${visibleDocs("source_doc", scope)}${derivedDoc})))`,
    comment: `EXISTS(SELECT 1 FROM doc_comments source_comment JOIN docs source_doc ON source_doc.id=source_comment.doc_id WHERE source_comment.id=${id} AND ${visibleDocs("source_doc", scope)}${derivedDoc})`,
    exam: `EXISTS(SELECT 1 FROM study_exams source_exam WHERE source_exam.id=${id} AND source_exam.user_id=${user} AND ${personal}
      AND NOT EXISTS(SELECT 1 FROM unnest(source_exam.doc_ids) source_doc_id LEFT JOIN docs source_doc ON source_doc.id=source_doc_id WHERE source_doc.id IS NULL OR NOT (${visibleDocs("source_doc", scope)}${derivedDoc}))
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
