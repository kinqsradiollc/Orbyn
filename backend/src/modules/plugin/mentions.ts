import { z } from "zod";
import type { Principal } from "../../capabilities/policy.js";
import { policy } from "../../capabilities/policy.js";
import { refUrl } from "../../capabilities/refs.js";
import type { ToolDescription } from "../../capabilities/registry.js";
import type { ToolResult } from "../../capabilities/execute.js";
import type { Queryable } from "../../db/pool.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
} from "../../lib/visibility.js";

export const PLUGIN_MENTIONS = "search_orbyn_mentions";
export const pluginMentionInput = z
  .object({ query: z.string().trim().max(200) })
  .strict();
export const pluginMentionTool: ToolDescription & {
  _meta: Record<string, unknown>;
} = {
  name: PLUGIN_MENTIONS,
  title: "Find Orbyn items",
  description:
    "Find titles and links to mention in the host composer. Does not return item contents.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", maxLength: 200 } },
    required: ["query"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            type: { const: "resource_link" },
            uri: { type: "string" },
            name: { type: "string" },
          },
          required: ["type", "uri", "name"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  annotations: {
    title: "Find Orbyn items",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: { ui: { visibility: ["app"] } },
};

/** Titles only: shared visibility rechecks membership and AI exclusions in SQL. */
export async function searchPluginMentions(
  db: Queryable,
  principal: Principal,
  query: string,
): Promise<ToolResult> {
  const params = new Params();
  const scope = scopeFor(policy.spaces(principal), params);
  // Escape LIKE metacharacters so typeahead text cannot become an unbounded wildcard.
  const pattern = params.add(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  const rows = await db.query<{
    id: string;
    type: "doc" | "task" | "event" | "project";
    title: string;
  }>(
    `SELECT id,type,title FROM (
       SELECT d.id,'doc' AS type,d.title,d.updated_at FROM docs d
       WHERE ${visibleDocs("d", scope)} AND d.kind NOT IN ('memory','agent') AND d.title ILIKE ${pattern}
       UNION ALL
       SELECT i.id,CASE WHEN i.kind='event' THEN 'event' ELSE 'task' END AS type,i.title,i.updated_at FROM items i
       WHERE ${visibleItems("i", scope)} AND i.title ILIKE ${pattern}
       UNION ALL
       SELECT p.id,'project' AS type,p.name AS title,p.updated_at FROM projects p
       WHERE ${visibleProjects("p", scope)} AND p.name ILIKE ${pattern}
     ) found ORDER BY updated_at DESC,type,id LIMIT 20`,
    params.values,
  );
  return {
    content: [],
    structuredContent: {
      items: rows.rows.map((row) => ({
        type: "resource_link",
        uri: refUrl({ type: row.type, id: row.id }),
        name: row.title,
      })),
    },
  };
}
