import type { Queryable } from "../../db/pool.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
} from "../../lib/visibility.js";
import { policy, type Principal } from "../../capabilities/policy.js";
import { CapabilityError } from "../../capabilities/registry.js";
import { itemSourceSql } from "../../capabilities/sources.js";
import { MAX_RESULT_CHARS } from "../../capabilities/format.js";
import { assistantExecutionDigest } from "./execution-authority.js";

/** Private server evidence, never accepted as capability/model input. End is exclusive. */
export type QuietReadEvidence = {
  kind: "task" | "doc";
  source_id: string;
  scope: "task_fields" | "doc_content";
  revision: string;
  digest: string;
  start: number;
  end: number;
  total: number;
  complete: boolean;
  supported: boolean;
};

/** V1 compares one task's displayed record, or a page's own title and blocks.
 * Linked entities, files, tags, sessions and child tasks are separate sources. */
export async function readCurrentQuietProjection(
  db: Queryable,
  principal: Principal,
  source: { kind: "task" | "doc"; id: string },
  options: { lock?: boolean } = {},
) {
  const p = new Params();
  const spaces = scopeFor(policy.spaces(principal), p);
  const id = p.add(source.id);
  const lock = options.lock ? " FOR SHARE" : "";
  const row =
    source.kind === "task"
      ? (
          await db.query(
            `SELECT i.id,i.title,i.notes,i.kind,i.status,i.priority,i.due_at,i.end_at,i.all_day,i.rrule,i.location,i.estimate_minutes,i.spent_minutes,i.version,${itemSourceSql("i")} AS imported_from FROM items i WHERE i.id=${id} AND i.kind='task' AND ${visibleItems("i", spaces)}${lock}`,
            p.values,
          )
        ).rows[0]
      : (
          await db.query(
            `SELECT d.id,d.title,d.kind,d.content,d.version,d.imported_from FROM docs d WHERE d.id=${id} AND d.kind <> 'memory' AND ${visibleDocs("d", spaces)}${lock}`,
            p.values,
          )
        ).rows[0];
  if (!row)
    throw new CapabilityError(
      "NOT_FOUND",
      "This check's source is unavailable.",
    );
  const { version, imported_from, kind, id: rowId, ...content } = row;
  // Generic fetch can hide imported text, and binary blocks have no complete textual
  // representation. Neither is a qualified no-change read in this first version.
  const blocks = Array.isArray(row.content) ? row.content : [];
  const textComplete =
    source.kind === "task"
      ? String(row.notes ?? "").length < MAX_RESULT_CHARS &&
        String(row.location ?? "").length <= 300 &&
        String(row.title ?? "").length <= 200
      : String(row.title ?? "").length <= 200 &&
        blocks.every(
          (b: unknown) =>
            !!b &&
            typeof b === "object" &&
            new Set([
              "heading",
              "paragraph",
              "bullet",
              "numbered",
              "todo",
              "quote",
              "code",
              "math",
              "divider",
              "callout",
              "table",
              "footnote",
              "reference",
            ]).has(String((b as { type?: unknown }).type ?? "")) &&
            JSON.stringify(b).length < MAX_RESULT_CHARS,
        );
  return {
    kind: source.kind,
    id: String(rowId),
    title: String(row.title || "Untitled"),
    revision: String(version),
    digest: assistantExecutionDigest({
      projection: 1,
      kind: source.kind,
      content,
    }),
    total: source.kind === "task" ? 1 : blocks.length,
    supported: !imported_from && textComplete,
  };
}
