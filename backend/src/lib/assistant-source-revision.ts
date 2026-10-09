/**
 * Content-free current entity revision for a handoff's recorded dependencies.
 * Call only alongside current source visibility; a digest never grants access.
 * Versioned entities use their optimistic revision. Other entities use their
 * row content, excluding read/poll timestamps that do not represent new work.
 */
export function assistantSourceRevision(kind: string, id: string): string {
  const tables: Record<string, string> = {
    task: "items",
    doc: "docs",
    project: "projects",
    record: "work_records",
    goal: "goals",
    routine: "agent_routines",
    habit: "habits",
    exam: "study_exams",
    team: "teams",
    calendar: "calendar_subscriptions",
    chat: "ai_chats",
  };
  const cases = Object.entries(tables).map(([sourceKind, table]) => {
    const row = "to_jsonb(revision_source)";
    const content = `${row} - ARRAY['last_used_at','last_polled_at','last_fetched_at']::text[]`;
    return `WHEN '${sourceKind}' THEN (SELECT encode(sha256(convert_to(
      (CASE WHEN ${row} ? 'version' THEN ${row}->'version' ELSE ${content} END)::text,
      'UTF8')),'hex') FROM ${table} revision_source WHERE revision_source.id=${id} FOR SHARE OF revision_source)`;
  });
  return `(CASE ${kind} ${cases.join("\n")} ELSE NULL END)`;
}
