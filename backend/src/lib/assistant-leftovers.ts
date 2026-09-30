import { NIGHT_SHIFT_KINDS } from "@orbyn/core";
import type { Queryable } from "../db/pool.js";
import { assistantSourceVisible } from "./assistant-source-visibility.js";

/** Project saved candidate labels through current access before exposing them. */
export async function visibleNightLeftovers(
  db: Queryable,
  userId: string,
  value: unknown,
) {
  if (!Array.isArray(value)) return [];
  const rows = value.filter(
    (row): row is Record<string, unknown> =>
      !!row &&
      typeof row === "object" &&
      typeof row.title === "string" &&
      typeof row.reason === "string",
  );
  const sources = rows.flatMap((row) =>
    typeof row.source_kind === "string" &&
    typeof row.source_id === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.source_id)
      ? [{ kind: row.source_kind, id: row.source_id }]
      : [],
  );
  const allowed = new Set(
    sources.length
      ? (
          await db.query<{ kind: string; id: string }>(
            `SELECT source.kind, source.id FROM jsonb_to_recordset($2::jsonb) source(kind text,id uuid) WHERE ${assistantSourceVisible("source.kind", "source.id", "$1")}`,
            [userId, JSON.stringify(sources)],
          )
        ).rows.map((row) => `${row.kind}:${row.id}`)
      : [],
  );
  return rows.map((row) => {
    const safe = row.source_id
      ? allowed.has(`${row.source_kind}:${row.source_id}`)
      : typeof row.kind === "string" &&
        (NIGHT_SHIFT_KINDS as readonly string[]).includes(row.kind) &&
        row.kind !== "handed";
    return safe
      ? { title: row.title as string, reason: row.reason as string }
      : {
          title: "Restricted work",
          reason: "Its source is no longer available to the assistant.",
        };
  });
}
