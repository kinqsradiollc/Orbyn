/**
 * The connected agent a row was made through, by its app's name, as a
 * column: `<alias>.<column>` is an agent_grants id filled by the
 * fill_via_grant triggers (from orbyn.agent_grant, see lib/actor.ts), null
 * for a person's own change. The apps show it as "via Claude"
 * (activityOriginLabel).
 */
export const viaAgentColumn = (
  alias: string,
  column = "via_grant_id",
  as = "via_agent",
) =>
  `(SELECT coalesce(nullif(g.client_name, ''), g.name) FROM agent_grants g
     WHERE g.id = ${alias}.${column}) AS ${as}`;
