/** Match the current waiting identity, never just a job that happens to be waiting. */
export function conversationWaitingKind(payload: string, owner: string) {
  return `(SELECT waiting.kind FROM (
    SELECT j.run_state->'state'->'waiting'->>'kind' AS kind FROM ai_jobs j
      WHERE ${payload}->>'event'='question' AND ${payload}->'work'->>'kind'='job'
        AND j.id::text=${payload}->'work'->>'id' AND j.user_id=${owner}
        AND j.state='waiting' AND j.run_state->'state'->'waiting'->>'id'=${payload}->>'waiting_id'
        AND j.run_state->'state'->'waiting'->>'kind' IN ('person','approval')
    UNION ALL
    SELECT 'approval' FROM assistant_page_runs p
      WHERE ${payload}->>'event'='question' AND ${payload}->'work'->>'kind'='page_run'
        AND p.id::text=${payload}->'work'->>'id' AND p.user_id=${owner}
        AND p.state='waiting' AND p.waiting_id::text=${payload}->>'waiting_id'
  ) waiting LIMIT 1)`;
}
