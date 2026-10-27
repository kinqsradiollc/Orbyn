import {
  fail,
  parseVersionedDocContent,
  projectDocContainers,
  docContainerBlocks,
  type DocBlock,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";

/**
 * Persist edits to existing leaves under the caller's authorized transaction.
 * Callers retain history, comments, task synchronization and announcement duties.
 * This cannot insert, remove or reidentify structured leaves.
 */
export async function writeDocLeafEdits(
  db: Db,
  id: string,
  blocks: DocBlock[],
) {
  const row = (
    await db.query<{ content_format: 1 | 2; content_nodes: unknown }>(
      "SELECT content_format,content_nodes FROM docs WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Document not found");
  if (row.content_format === 1) {
    const document = parseVersionedDocContent({ format: 1, blocks });
    if (document.format !== 1) fail(400, "Invalid document content.");
    await db.query(
      "UPDATE docs SET content=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
      [id, JSON.stringify(document.blocks)],
    );
    return;
  }
  const document = parseVersionedDocContent({
    format: row.content_format,
    nodes: row.content_nodes,
  });
  if (document.format !== 2) fail(409, "Unsupported document content format.");
  let nodes;
  try {
    nodes = projectDocContainers(document.nodes, () => blocks);
  } catch {
    fail(409, "This edit changed document ownership. Refresh and try again.");
  }
  // Validate the complete new tree before authorizing the SQL projection writer.
  const next = parseVersionedDocContent({ format: 2, nodes });
  if (next.format !== 2) fail(400, "Invalid document content.");
  const leaves = docContainerBlocks(next.nodes);
  await db.query("SELECT set_config('orbyn.doc_content_writer','2',true)");
  await db.query(
    "UPDATE docs SET content=$2::jsonb,content_nodes=$3::jsonb,version=version+1,updated_at=now() WHERE id=$1",
    [id, JSON.stringify(leaves), JSON.stringify(next.nodes)],
  );
}
