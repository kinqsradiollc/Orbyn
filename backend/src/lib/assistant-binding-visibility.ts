import {
  assistantSourceVisible,
  assistantBindingEntrySourcesVisible,
} from "./assistant-source-visibility.js";
import { assistantJobSourcesVisible } from "./assistant-job-sources.js";

/** Current grant scope and every persisted dependency, not a union on the chat. */
export function deliveryBindingVisible(
  binding = "b",
  owner = "$1",
  includeDerived = true,
) {
  const scope = {
    user: owner,
    personal: "delivery_grant.personal",
    teams: `coalesce(delivery_grant.team_ids,ARRAY(SELECT team_id FROM team_members WHERE user_id=${owner}))`,
  };
  return `(${binding}.owner_id=${owner} AND ${binding}.sources_checked AND EXISTS(
    SELECT 1 FROM agent_grants delivery_grant JOIN users delivery_owner ON delivery_owner.id=delivery_grant.user_id
    WHERE delivery_grant.id=${binding}.grant_id AND delivery_grant.user_id=${owner}
      AND NOT delivery_owner.disabled AND delivery_grant.revoked_at IS NULL AND delivery_grant.suspended_at IS NULL
      AND (delivery_grant.expires_at IS NULL OR delivery_grant.expires_at>now())
      AND NOT EXISTS(SELECT 1 FROM assistant_delivery_sources ds WHERE ds.binding_id=${binding}.id
        AND NOT ${assistantSourceVisible("ds.source_kind", "ds.source_id", owner, false, scope, includeDerived)})
      AND (${binding}.reason<>'personal' OR (delivery_grant.personal AND NOT EXISTS(
        SELECT 1 FROM assistant_delivery_sources ds WHERE ds.binding_id=${binding}.id AND NOT
        ${assistantSourceVisible("ds.source_kind", "ds.source_id", owner, false, { user: owner, personal: true, teams: "'{}'::uuid[]" }, includeDerived)})))
      ${includeDerived ? `AND ${assistantBindingEntrySourcesVisible(`${binding}.id`, owner, scope)}` : ""}
      AND ((${binding}.work_kind='job' AND EXISTS(SELECT 1 FROM ai_jobs delivery_job
        WHERE delivery_job.id=${binding}.work_id AND ${assistantJobSourcesVisible("delivery_job", owner, false, scope, includeDerived)}))
        OR (${binding}.work_kind='page_run' AND EXISTS(SELECT 1 FROM assistant_page_runs delivery_page
          JOIN assistant_page_bindings page_binding ON page_binding.id=delivery_page.binding_id
          WHERE delivery_page.id=${binding}.work_id AND delivery_page.user_id=${owner}
            AND delivery_page.agent_grant_id=delivery_grant.id AND page_binding.user_id=${owner}))
        OR (${binding}.work_kind='night' AND EXISTS(SELECT 1 FROM assistant_nights delivery_night
          WHERE delivery_night.id=${binding}.work_id AND delivery_night.user_id=${owner}))
        OR (${binding}.work_kind='night' AND EXISTS(SELECT 1 FROM assistant_delivery_windows delivery_window
          WHERE delivery_window.id=${binding}.work_id AND delivery_window.owner_id=${owner}))
        OR (NOT EXISTS(SELECT 1 FROM ai_jobs retired_job WHERE ${binding}.work_kind='job' AND retired_job.id=${binding}.work_id)
          AND NOT EXISTS(SELECT 1 FROM assistant_page_runs retired_page WHERE ${binding}.work_kind='page_run' AND retired_page.id=${binding}.work_id)
          AND NOT EXISTS(SELECT 1 FROM assistant_nights retired_night WHERE ${binding}.work_kind='night' AND retired_night.id=${binding}.work_id)
          AND ((${binding}.summary_retained_at IS NOT NULL AND EXISTS(
            SELECT 1 FROM assistant_conversation_streams summary_destination WHERE summary_destination.id=${binding}.destination_id
              AND summary_destination.owner_id=${owner} AND summary_destination.retired_at IS NULL))
            OR EXISTS(SELECT 1 FROM assistant_delivery_intents retained_intent JOIN assistant_conversation_entries retained_entry ON retained_entry.intent_id=retained_intent.id
            JOIN assistant_conversation_streams retained_stream ON retained_stream.id=retained_entry.destination_id
            WHERE (retained_intent.binding_id=${binding}.id OR EXISTS(
                SELECT 1 FROM assistant_conversation_entry_sources retained_source WHERE retained_source.entry_id=retained_entry.id
                  AND retained_source.source_kind='binding' AND retained_source.source_id=${binding}.id))
              AND retained_intent.state='published' AND retained_entry.sources_checked
              AND retained_stream.retired_at IS NULL AND retained_stream.owner_id=${owner}))))))`;
}
