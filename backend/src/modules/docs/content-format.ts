import {
  fail,
  parseVersionedDocContent,
  legacyDocContent,
  requireDocContentCapability,
  downgradeDocContent,
  docContainerBlocks,
  projectDocContainers,
  type VersionedDocContent,
  type DocContentFormat,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { actAs } from "../../lib/actor.js";
import { allowPageFiles } from "../../lib/page-file-access.js";
import { linkPrivacy } from "../links/privacy.js";
import {
  VISIBLE,
  requireDoc,
  withTaskState,
  keepHiddenLabels,
  syncTicks,
  followComments,
  followSuggestions,
  snapshot,
} from "./service.js";

type StoredContent = {
  id: string;
  title: string;
  version: number;
  content_format: 1 | 2;
  content: unknown;
  content_nodes: unknown;
};
function document(row: StoredContent): VersionedDocContent {
  return row.content_format === 1
    ? legacyDocContent(row.content)
    : parseVersionedDocContent({
        format: row.content_format,
        nodes: row.content_nodes,
      });
}
function capability(
  format: DocContentFormat,
  supported: readonly DocContentFormat[],
) {
  try {
    requireDocContentCapability(format, supported);
  } catch {
    fail(409, "Update this client before editing nested document content.");
  }
}

/** Read under current visibility and project complete-page labels before redistributing leaves. */
export async function readVersionedDoc(
  db: Queryable,
  u: UserRow,
  id: string,
  supported: readonly DocContentFormat[],
) {
  const row = (
    await db.query<StoredContent>(
      `SELECT d.id,d.title,d.version,d.content,d.content_format,d.content_nodes FROM docs d WHERE d.id=$2 AND ${VISIBLE}`,
      [u.id, id],
    )
  ).rows[0];
  if (!row) fail(404, "Document not found");
  capability(row.content_format, supported);
  const content = document(row);
  const leaves =
    content.format === 1
      ? content.blocks
      : docContainerBlocks(content.nodes, { projected: true });
  const state = await withTaskState(db, id, leaves);
  const privacy = await linkPrivacy(db, u.id, state);
  const visible = privacy.value(state);
  const projected: VersionedDocContent =
    content.format === 1
      ? { format: 1, blocks: visible }
      : {
          format: 2,
          nodes: projectDocContainers(content.nodes, () => visible, {
            projected: true,
          }),
        };
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    document: projected,
  };
}

/** Save a revision atomically, preserving search/ACL leaf projection and complete structured history. */
export async function saveVersionedDoc(
  db: Db,
  u: UserRow,
  id: string,
  version: number,
  value: unknown,
  supported: readonly DocContentFormat[],
  ticksFrom: number | null = null,
) {
  await actAs(db, u.id);
  const owned = await requireDoc(db, id, u, "items:write");
  if (owned.version !== version)
    fail(409, "This document changed somewhere else. Refresh and try again.");
  let content: VersionedDocContent;
  try {
    content = parseVersionedDocContent(value, { projected: true });
  } catch {
    fail(400, "Invalid document content.");
  }
  capability(owned.content_format ?? 1, supported);
  capability(content.format, supported);
  if (owned.content_format === 2 && content.format === 1) {
    const current = (
      await db.query<StoredContent>(
        "SELECT id,title,version,content,content_format,content_nodes FROM docs WHERE id=$1",
        [id],
      )
    ).rows[0];
    try {
      downgradeDocContent(document(current));
    } catch {
      fail(409, "Nested content cannot be converted to a flat document.");
    }
  }
  const leaves =
    content.format === 1
      ? content.blocks
      : docContainerBlocks(content.nodes, { projected: true });
  const preserved = await keepHiddenLabels(db, id, u.id, leaves);
  const processed = await syncTicks(db, u, id, preserved, ticksFrom);
  // Read masks may be longer than storage permits; restore labels first, then enforce exact storage limits.
  let stored: VersionedDocContent;
  try {
    stored = parseVersionedDocContent(
      content.format === 1
        ? { format: 1, blocks: processed }
        : {
            format: 2,
            nodes: projectDocContainers(content.nodes, () => processed, {
              projected: true,
            }),
          },
    );
  } catch {
    fail(400, "Document content exceeds its storage limits.");
  }
  await allowPageFiles(db, u.id, processed);
  await followComments(db, id, processed);
  await followSuggestions(db, id, processed);
  const nodes = stored.format === 2 ? stored.nodes : null;
  await snapshot(db, id, u.id, true);
  await db.query("SELECT set_config('orbyn.doc_content_writer','2',true)");
  await db.query(
    "UPDATE docs SET content=$2::jsonb,content_format=$3,content_nodes=$4::jsonb,version=version+1,updated_at=now() WHERE id=$1",
    [
      id,
      JSON.stringify(processed),
      content.format,
      nodes === null ? null : JSON.stringify(nodes),
    ],
  );
  return readVersionedDoc(db, u, id, supported);
}
