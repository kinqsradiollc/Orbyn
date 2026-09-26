import {
  applySuggestion,
  fail,
  overlaps,
  PAGE_TAG_LIMIT,
  type DocBlock,
  type DocComment,
  type DocSuggestion,
  type DocVersion,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import {
  COMMENT_SELECT,
  SUGGESTION_SELECT,
  TAG_IN_SPACE,
  VISIBLE,
  findTagNamed,
  followComments,
  followSuggestions,
  pageTags,
  readDoc,
  requireDoc,
  snapshot,
  tagNamed,
  withTaskState,
  type Owned,
} from "./service.js";

/**
 * What people say about a page and propose for it: comments (with
 * mentions), suggestions (taken or left), a page's tags and its kept
 * versions. The routes and the agents' tools (comment_on_doc,
 * resolve_suggestions, get_history, edit_doc's tags) share these.
 */

/** A page `userId` can see (404 otherwise). */
export async function mustSeeDoc(db: Queryable, userId: string, id: string) {
  const seen = (
    await db.query(`SELECT 1 FROM docs d WHERE d.id = $2 AND ${VISIBLE}`, [
      userId,
      id,
    ])
  ).rowCount;
  if (!seen) fail(404, "Document not found");
}

/** Everyone's remarks on a page, oldest first. */
export async function listComments(
  db: Queryable,
  userId: string,
  id: string,
): Promise<DocComment[]> {
  await mustSeeDoc(db, userId, id);
  return (
    await db.query<DocComment>(
      `${COMMENT_SELECT} WHERE c.doc_id = $1 ORDER BY c.created_at`,
      [id],
    )
  ).rows;
}

/**
 * Who can be named in a comment here: the team, or just the author on a
 * personal page. The picker never offers someone who cannot read it.
 */
export async function docPeople(db: Queryable, userId: string, id: string) {
  const doc = (
    await db.query<{ team_id: string | null; user_id: string }>(
      `SELECT d.team_id, d.user_id FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
      [userId, id],
    )
  ).rows[0];
  if (!doc) fail(404, "Document not found");
  return (
    await db.query<{ id: string; name: string; email: string }>(
      doc.team_id
        ? `SELECT u.id, u.name, u.email FROM users u
             JOIN team_members m ON m.user_id = u.id AND m.team_id = $1
            ORDER BY u.name`
        : "SELECT id, name, email FROM users WHERE id = $1",
      [doc.team_id ?? doc.user_id],
    )
  ).rows;
}

export type CommentInput = {
  body: string;
  block_id?: string;
  quote?: string;
  range_start?: number;
  range_end?: number;
  parent_id?: string;
  mentions: string[];
};

/** Remark on a page (anyone who can read it may), naming people in it. */
export async function addComment(
  db: Db,
  u: UserRow,
  id: string,
  input: CommentInput,
): Promise<DocComment> {
  const doc = await requireDoc(db, id, u, "items:read");
  let parentId = input.parent_id ?? null;
  if (parentId) {
    // A reply belongs to a remark on this page, and threads stay one
    // deep: replying to a reply joins the same thread.
    const parent = (
      await db.query<{ id: string; parent_id: string | null }>(
        "SELECT id, parent_id FROM doc_comments WHERE id = $1 AND doc_id = $2",
        [parentId, id],
      )
    ).rows[0];
    if (!parent) fail(404, "Comment not found");
    parentId = parent.parent_id ?? parent.id;
  }
  const made = (
    await db.query<{ id: string }>(
      `INSERT INTO doc_comments
         (doc_id, user_id, body, block_id, quote,
          range_start, range_end, parent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        id,
        u.id,
        input.body,
        input.block_id ?? null,
        input.quote ?? null,
        input.range_start ?? null,
        input.range_end ?? null,
        parentId,
      ],
    )
  ).rows[0].id;
  await nameMentions(db, doc, made, u, input.body, input.mentions);
  return (
    await db.query<DocComment>(`${COMMENT_SELECT} WHERE c.id = $1`, [made])
  ).rows[0];
}

/**
 * Record who a comment names, and tell them.
 *
 * Only people who can already see the document can be named: a mention is
 * not a way to show a page to someone who has no business reading it. The
 * notice is kept to one per person per comment by its ref.
 */
async function nameMentions(
  db: Db,
  doc: Owned,
  commentId: string,
  by: UserRow,
  body: string,
  wanted: string[],
) {
  const ids = [...new Set(wanted)].filter((w) => w !== by.id);
  if (!ids.length) return;
  const allowed = (
    await db.query<{ id: string; name: string }>(
      doc.team_id
        ? `SELECT u.id, u.name FROM users u
             JOIN team_members m ON m.user_id = u.id AND m.team_id = $2
            WHERE u.id = ANY($1::uuid[])`
        : `SELECT u.id, u.name FROM users u WHERE u.id = ANY($1::uuid[]) AND u.id = $2`,
      [ids, doc.team_id ?? doc.user_id],
    )
  ).rows;
  if (!allowed.length) return;
  await db.query(
    `INSERT INTO doc_comment_mentions (comment_id, user_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [commentId, allowed.map((a) => a.id)],
  );
  const title = (
    await db.query<{ title: string }>("SELECT title FROM docs WHERE id = $1", [
      doc.id,
    ])
  ).rows[0]?.title;
  for (const person of allowed)
    await db.query(
      `INSERT INTO notifications (user_id, item_id, item_version, channel,
         destination, title, body, state, kind, ref)
       VALUES ($1, NULL, 0, 'inapp', '', $2, $3, 'sent', 'mention', $4)
       ON CONFLICT DO NOTHING`,
      [
        person.id,
        `${by.name} mentioned you in ${title ?? "a document"}`,
        body.slice(0, 400),
        `doc:${doc.id}:${commentId}`,
      ],
    );
}

/** Resolve a remark, or bring it back. */
export async function resolveComment(
  db: Db,
  u: UserRow,
  id: string,
  commentId: string,
  resolved: boolean,
) {
  await requireDoc(db, id, u, "items:read");
  const updated = (
    await db.query<DocComment>(
      `UPDATE doc_comments SET resolved_at = CASE WHEN $3 THEN now() ELSE NULL END
        WHERE id = $1 AND doc_id = $2
        RETURNING id, doc_id, user_id, body, resolved_at, created_at`,
      [commentId, id, resolved],
    )
  ).rows[0];
  if (!updated) fail(404, "Comment not found");
  return updated;
}

/** Only the person who wrote a remark can take it back. */
export async function deleteComment(
  db: Db,
  u: UserRow,
  id: string,
  commentId: string,
) {
  await requireDoc(db, id, u, "items:read");
  const gone = (
    await db.query(
      "DELETE FROM doc_comments WHERE id = $1 AND doc_id = $2 AND user_id = $3",
      [commentId, id, u.id],
    )
  ).rowCount;
  if (!gone) fail(404, "Comment not found");
}

/** Every proposal on a page, oldest first. */
export async function listSuggestions(
  db: Queryable,
  userId: string,
  id: string,
): Promise<DocSuggestion[]> {
  await mustSeeDoc(db, userId, id);
  return (
    await db.query<DocSuggestion>(
      `${SUGGESTION_SELECT} WHERE s.doc_id = $1 ORDER BY s.created_at`,
      [id],
    )
  ).rows;
}

/**
 * Take a proposal, or leave it. Only someone who may change the page can
 * decide. Accepting writes the change into the line and bumps the page's
 * version (a version is kept first), so it shows in history as an ordinary
 * edit with the accepter's name on it; any other open proposal over the
 * same words comes loose. Returns the page after taking, or null.
 */
export async function decideSuggestion(
  db: Db,
  u: UserRow,
  id: string,
  sid: string,
  take: boolean,
) {
  await requireDoc(db, id, u, "items:write");
  const s = (
    await db.query<DocSuggestion>(
      `${SUGGESTION_SELECT} WHERE s.id = $1 AND s.doc_id = $2 FOR UPDATE OF s`,
      [sid, id],
    )
  ).rows[0];
  if (!s) fail(404, "Suggestion not found");
  if (s.status !== "open") fail(409, "That suggestion was already decided");
  if (!take) {
    await db.query(
      `UPDATE doc_suggestions SET status = 'rejected', resolved_by = $2,
         resolved_at = now() WHERE id = $1`,
      [sid, u.id],
    );
    return null;
  }
  if (s.detached)
    fail(
      409,
      "The words this was about have gone from the page. Look at it again.",
    );
  const doc = (
    await db.query<{ content: DocBlock[]; title: string }>(
      "SELECT content, title FROM docs WHERE id = $1",
      [id],
    )
  ).rows[0];
  const at = doc.content.findIndex((b) => b.id === s.block_id);
  if (at === -1) fail(409, "That line has gone from the page.");
  const block = doc.content[at];
  if (block.type === "divider") fail(409, "That line has no words.");
  const edited = doc.content.slice();
  edited[at] = { ...block, text: applySuggestion(block.text, s) };
  await snapshot(db, id, u.id);
  // Taking a proposal changes words, never a tick, so no task is finished
  // or reopened here; the lines tied to tasks are stored as their tasks now
  // stand, as every save stores them.
  const next = await withTaskState(db, id, edited);
  await db.query(
    `UPDATE docs SET content = $2::jsonb, version = version + 1,
       updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(next)],
  );
  await db.query(
    `UPDATE doc_suggestions SET status = 'accepted', resolved_by = $2,
       resolved_at = now() WHERE id = $1`,
    [sid, u.id],
  );
  // Everything else on the page now points at words that may have moved.
  await followComments(db, id, next);
  await followSuggestions(db, id, next);
  // A proposal over the very same words can no longer be written.
  const rivals = (
    await db.query<DocSuggestion>(
      `${SUGGESTION_SELECT} WHERE s.doc_id = $1 AND s.status = 'open'
         AND s.block_id = $2 AND s.id <> $3`,
      [id, s.block_id, sid],
    )
  ).rows;
  for (const rival of rivals)
    if (overlaps(rival, s))
      await db.query(
        "UPDATE doc_suggestions SET detached = true WHERE id = $1",
        [rival.id],
      );
  return readDoc(db, id);
}

/** Take back a proposal you made. Only its author, and only while open. */
export async function withdrawSuggestion(
  db: Db,
  u: UserRow,
  id: string,
  sid: string,
) {
  await requireDoc(db, id, u, "items:read");
  const gone = (
    await db.query(
      `DELETE FROM doc_suggestions
        WHERE id = $1 AND doc_id = $2 AND user_id = $3 AND status = 'open'`,
      [sid, id, u.id],
    )
  ).rowCount;
  if (!gone) fail(404, "Suggestion not found");
}

/**
 * Put exactly these tags on a page, from its own space's tags (a tag the
 * page already carries may stay, wherever it came from). Returns the tags
 * and the page's version (tags don't change it).
 */
export async function setPageTags(
  db: Db,
  u: UserRow,
  id: string,
  tags: string[],
) {
  const wanted = [...new Set(tags)];
  const doc = await requireDoc(db, id, u, "items:write");
  const allowed = (
    await db.query<{ id: string }>(
      `SELECT g.id FROM tags g
        WHERE g.id = ANY($1::uuid[])
          AND (${TAG_IN_SPACE} OR EXISTS (SELECT 1 FROM doc_tags dt
                 WHERE dt.doc_id = $4 AND dt.tag_id = g.id))`,
      [wanted, u.id, doc.team_id, id],
    )
  ).rows.map((row) => row.id);
  if (allowed.length !== wanted.length) fail(404, "Tag not found");
  await db.query(
    "DELETE FROM doc_tags WHERE doc_id = $1 AND NOT (tag_id = ANY($2::uuid[]))",
    [id, allowed],
  );
  await db.query(
    `INSERT INTO doc_tags (doc_id, tag_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [id, allowed],
  );
  return { tags: await pageTags(db, id), version: doc.version };
}

/**
 * Add tags to a page by name, as typing "#physics" in a line does. A name
 * the page's space has no tag for yet makes one there; past PAGE_TAG_LIMIT
 * names are left off. Returns the tags, the names added and the version.
 */
export async function addPageTagNames(
  db: Db,
  u: UserRow,
  id: string,
  names: string[],
) {
  const doc = await requireDoc(db, id, u, "items:write");
  const current = await pageTags(db, id);
  const have = new Set(current.map((t) => t.id));
  // A name the page already carries, from wherever, is already there.
  const seen = new Set(current.map((t) => t.name.toLowerCase()));
  const added: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const found = await findTagNamed(db, u, doc.team_id, name);
    if (found && have.has(found)) continue;
    // A full page takes no more, and a tag is only made when it will go on
    // the page: a name left off here leaves nothing behind.
    if (have.size >= PAGE_TAG_LIMIT) break;
    const tag = found ?? (await tagNamed(db, u, doc.team_id, name));
    await db.query(
      "INSERT INTO doc_tags (doc_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [id, tag],
    );
    have.add(tag);
    added.push(name);
  }
  return { tags: await pageTags(db, id), added, version: doc.version };
}

/** Columns of a kept version (with its author's name and agent). */
export const VERSION_COLUMNS = `v.version, v.title, v.created_at, v.user_id,
  us.name AS author, jsonb_array_length(v.content) AS blocks,
  (SELECT coalesce(nullif(g.client_name, ''), g.name) FROM agent_grants g
    WHERE g.id = v.via_grant_id) AS via_agent`;

/** A page's kept versions, newest first (404 for a page out of sight). */
export async function docVersions(
  db: Queryable,
  userId: string,
  id: string,
  limit = 200,
): Promise<DocVersion[]> {
  await mustSeeDoc(db, userId, id);
  return (
    await db.query<DocVersion>(
      `SELECT ${VERSION_COLUMNS} FROM doc_versions v
         LEFT JOIN users us ON us.id = v.user_id
         WHERE v.doc_id = $1 ORDER BY v.version DESC LIMIT $2`,
      [id, limit],
    )
  ).rows;
}

/** One kept version with its content (404 when it isn't kept). */
export async function docVersion(
  db: Queryable,
  userId: string,
  id: string,
  n: number,
): Promise<DocVersion & { content: DocBlock[] }> {
  await mustSeeDoc(db, userId, id);
  const row = (
    await db.query<DocVersion & { content: DocBlock[] }>(
      `SELECT ${VERSION_COLUMNS}, v.content FROM doc_versions v
         LEFT JOIN users us ON us.id = v.user_id
         WHERE v.doc_id = $1 AND v.version = $2`,
      [id, n],
    )
  ).rows[0];
  if (!row) fail(404, "That version is not kept");
  return row;
}
