import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  itemData,
  fail,
  HttpError,
  reanchorComments,
  reanchorSuggestions,
  type OccurrenceChanges,
  type DocTag,
  type Doc,
  type DocBlock,
  type DocComment,
  type DocSuggestion,
  type Item,
  blockText,
} from "@orbyn/core";
import {
  pool,
  reader,
  transaction,
  type Db,
  type Queryable,
} from "../../db/pool.js";
import { type UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { isOccurrence, type SeriesRow } from "../planner/calendar.js";
import { mutate, recomputeProgress, setItemStatus } from "../items/service.js";
import { announceDocChange } from "./live.js";
import { hasVectors } from "../search/semantic.js";
import { syncSavedPages } from "../study/service.js";
import { inMyTeams, readableDocs, visibleDocs } from "../../lib/visibility.js";

/**
 * The docs service: reading, checking and writing pages, their tags, task
 * lines, event notes and proposed changes. The REST routes (routes.ts), the
 * assistant, agents and the other modules (agenda, capture, templates) all
 * go through these, so a page is read and changed one way everywhere.
 */
export const COLUMNS = `d.id, d.user_id, d.team_id, t.name AS team_name, d.title, d.kind,
  d.item_id, d.project_id, p.name AS project_name, d.folder_id, d.version,
  d.created_at, d.updated_at, d.reviewed_at, d.imported_from, d.in_uploads,
  to_char(d.agenda_date, 'YYYY-MM-DD') AS agenda_date, d.occurrence,
  coalesce((SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name,
                                              'color', tg.color)
                         ORDER BY lower(tg.name), tg.name)
              FROM doc_tags dt JOIN tags tg ON tg.id = dt.tag_id
             WHERE dt.doc_id = d.id), '[]'::json) AS tags`;

/**
 * The lines of a page that are tied to a task, by block id. Every line gets
 * an id once someone remarks on it, so an id alone doesn't make a line a
 * task: clients show the "task" tag, and offer "Add to my tasks", from this.
 */
export const LINKED = `coalesce((SELECT array_agg(l.block_id ORDER BY l.block_id)
    FROM doc_task_links l WHERE l.doc_id = d.id), '{}') AS linked_block_ids`;

/** Joined wherever `COLUMNS` is selected, for the project a note hangs off. */
export const JOINS = `LEFT JOIN teams t ON t.id = d.team_id
  LEFT JOIN projects p ON p.id = d.project_id`;

/**
 * A comment as the clients read it: its anchor, its thread, and the people
 * named in it gathered into one array so a card needs no second request.
 */
export const COMMENT_SELECT = `SELECT c.id, c.doc_id, c.user_id, u.name AS author, c.body,
         c.block_id, c.quote, c.range_start, c.range_end, c.parent_id,
         c.detached, c.resolved_at, c.created_at,
         coalesce((SELECT json_agg(json_build_object('user_id', mu.id, 'name', mu.name)
                                   ORDER BY mu.name)
                     FROM doc_comment_mentions m JOIN users mu ON mu.id = m.user_id
                    WHERE m.comment_id = c.id), '[]'::json) AS mentions
    FROM doc_comments c JOIN users u ON u.id = c.user_id`;

/** Documents `$1` could see if they weren't in Trash: their own, and their teams'. */
export const SEES = readableDocs("d");

/**
 * Documents `$1` can see: their own, and their teams', leaving out anything
 * in Trash. A page in Trash is gone as far as everything but Trash itself
 * is concerned: lists, search, comments, history and exports all answer
 * "not found" for it, the same as for a page that never existed.
 */
export const VISIBLE = visibleDocs("d");

/**
 * A page may hang off a task, a project or a folder only in its own space:
 * a personal page off the author's own things, a team page off that team's.
 * Anything else is "not found" — the same answer as for an id that doesn't
 * exist, so ids from another space reveal nothing.
 */
export async function checkLinks(
  db: Queryable,
  u: UserRow,
  teamId: string | null,
  links: {
    item_id?: string | null;
    project_id?: string | null;
    folder_id?: string | null;
  },
) {
  const inSpace = (alias: string) =>
    `${alias}.team_id IS NOT DISTINCT FROM $2::uuid
       AND (${alias}.team_id IS NOT NULL OR ${alias}.user_id = $1)
       AND (${alias}.team_id IS NULL OR ${inMyTeams(alias)})`;
  for (const [id, table, alias, name] of [
    [links.item_id, "items", "i", "Task"],
    [links.project_id, "projects", "p", "Project"],
    [links.folder_id, "folders", "f", "Folder"],
  ] as const) {
    if (!id) continue;
    const found = (
      await db.query(
        `SELECT 1 FROM ${table} ${alias} WHERE ${alias}.id = $3 AND ${inSpace(alias)}`,
        [u.id, teamId, id],
      )
    ).rowCount;
    if (!found) fail(404, `${name} not found`);
  }
}

export type Owned = {
  id: string;
  user_id: string;
  team_id: string | null;
  version: number;
  kind: string;
};

/**
 * Moving a page to Trash, or back, changes neither its title nor its
 * version, so the project history trigger doesn't see it. A project page
 * says so in its project's history here: gone from the project while in
 * Trash (no state after), and back again when restored.
 */
export async function noteTrash(
  db: Queryable,
  docId: string,
  actor: string,
  trashed: boolean,
) {
  await db.query(
    `INSERT INTO project_activity (project_id, actor_id, kind, entity_type,
       entity_id, summary, before_state, after_state)
     SELECT d.project_id, $2, $3, 'note', d.id,
            left($4 || coalesce(nullif(d.title, ''), 'Untitled note'), 240),
            CASE WHEN $5 THEN jsonb_build_object('title', d.title,
              'version', d.version::text) END,
            CASE WHEN $5 THEN NULL ELSE jsonb_build_object('title', d.title,
              'version', d.version::text) END
       FROM docs d JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1`,
    [
      docId,
      actor,
      trashed ? "note_removed" : "note_added",
      trashed ? "Note moved to Trash: " : "Note restored: ",
      trashed,
    ],
  );
}

/**
 * A page in Trash can't be searched, so it isn't measured for search while
 * it is there; brought back, it is queued again, which catches any edit it
 * was still waiting on. Lines already measured keep their measurement.
 */
export async function searchTrash(db: Db, docId: string, trashed: boolean) {
  if (!(await hasVectors(db))) return;
  await db.query(
    trashed
      ? "DELETE FROM doc_embedding_queue WHERE doc_id = $1"
      : `INSERT INTO doc_embedding_queue (doc_id) VALUES ($1)
           ON CONFLICT (doc_id) DO UPDATE SET queued_at = now()`,
    [docId],
  );
}

/**
 * A page that stands in for something — today's agenda, an event's meeting
 * note — brought back from Trash is the one that opens again. While it was
 * away, opening Agenda or the event wrote a fresh copy in its place; a copy
 * nobody has touched (never saved, nothing said or tasked on it) is let go
 * so the two don't sit side by side. One that was written in is kept (the
 * event then opens whichever note was written in last). The note of a
 * class that is gone (`class_was`) is nobody's copy but that class's, so
 * bringing back the series' own note leaves it be.
 */
export async function dropStandInCopy(db: Queryable, docId: string) {
  await db.query(
    `DELETE FROM docs c
      USING docs d
      WHERE d.id = $1 AND c.id <> d.id AND c.kind = d.kind
        AND c.deleted_at IS NULL AND c.version = 1
        AND (
          (d.kind = 'agenda' AND c.user_id = d.user_id
            AND c.team_id IS NULL AND c.title = d.title
            AND c.agenda_date IS NOT DISTINCT FROM d.agenda_date)
          OR (d.kind = 'meeting' AND d.item_id IS NOT NULL
            AND c.item_id = d.item_id
            AND c.occurrence IS NOT DISTINCT FROM d.occurrence
            AND (c.class_was IS NULL
              OR c.class_was IS NOT DISTINCT FROM d.class_was)
            AND c.team_id IS NOT DISTINCT FROM d.team_id
            AND (d.team_id IS NOT NULL OR c.user_id = d.user_id))
        )
        AND NOT EXISTS (SELECT 1 FROM doc_comments m WHERE m.doc_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM doc_task_links l WHERE l.doc_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM doc_suggestions g WHERE g.doc_id = c.id)`,
    [docId],
  );
}

/**
 * The document, locked for a change, when `u` may do `permission` to it. A
 * page in Trash is "not found" unless `trashed` asks for exactly those, which
 * only restoring and deleting for good do.
 */
export async function requireDoc(
  db: Db,
  id: string,
  u: UserRow,
  permission: "items:read" | "items:write",
  trashed = false,
): Promise<Owned> {
  const row = (
    await db.query<Owned & { deleted_at: Date | null }>(
      `SELECT id, user_id, team_id, version, kind, deleted_at
         FROM docs WHERE id = $1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!row || !!row.deleted_at !== trashed) fail(404, "Document not found");
  if (row.team_id) await requireTeam(row.team_id, u, permission, db);
  else if (row.user_id !== u.id) fail(404, "Document not found");
  return row;
}

/**
 * Show a document's checklist as its tasks actually stand. A line that became
 * a task follows the task, so ticking it in the planner ticks it here too.
 */
export async function withTaskState(
  db: Queryable,
  docId: string,
  content: DocBlock[],
): Promise<DocBlock[]> {
  const ids = content.flatMap((b) => (b.type === "todo" && b.id ? [b.id] : []));
  if (!ids.length) return content;
  const rows = (
    await db.query<{ block_id: string; status: string }>(
      `SELECT l.block_id, i.status FROM doc_task_links l
         JOIN items i ON i.id = l.item_id
        WHERE l.doc_id = $1 AND l.block_id = ANY($2::text[])`,
      [docId, ids],
    )
  ).rows;
  if (!rows.length) return content;
  const done = new Map(rows.map((r) => [r.block_id, r.status === "done"]));
  return content.map((b) =>
    b.type === "todo" && b.id && done.has(b.id)
      ? { ...b, done: done.get(b.id)! }
      : b,
  );
}

/**
 * A page as a save hands it back: everything a single-page read gives,
 * with each line tied to a task showing that task as it now stands. An
 * editor takes the ticks from here, so a repeating task it just finished
 * shows unticked for its next occurrence.
 */
export async function readDoc(db: Queryable, id: string): Promise<Doc> {
  const doc = (
    await db.query<Doc>(
      `SELECT ${COLUMNS}, d.content, ${LINKED} FROM docs d
         ${JOINS} WHERE d.id = $1`,
      [id],
    )
  ).rows[0];
  return { ...doc, content: await withTaskState(db, id, doc.content ?? []) };
}

/**
 * The answers that mean "this person can't change that task here" rather
 * than that something broke: gone, not theirs to change, changed meanwhile,
 * or a saved task the usual checks won't pass.
 */
export const REFUSALS = new Set([403, 404, 409, 422]);
export const isRefusal = (e: unknown) =>
  e instanceof ZodError ||
  (e instanceof HttpError && REFUSALS.has(e.statusCode));

/**
 * Ticking a linked line in a document finishes its task, and unticking one
 * reopens it, the same way as anywhere else (see setItemStatus): its future
 * sessions go, a repeating task moves on to its next occurrence, and other
 * devices and pages hear about it.
 *
 * What counts is a tick the person made, not one the page is still carrying.
 * A repeating task moves on and reads unticked again, and a refused tick
 * reads as the task really is, so a page can go on sending a tick after it
 * has counted. How that is told apart:
 *
 * - An editor says which version of the page its ticks were taken from
 *   (`ticksFrom`, the X-Orbyn-Ticks-From header). The link keeps the first
 *   version showing the line as its task now stands (`done_version`: the
 *   version given by the save whose tick counted, or the one the page moved
 *   on to when the task changed elsewhere). A line that differs from its
 *   task counts when its ticks were taken from that version or later: the
 *   person saw the line as it stands and changed it. A tick sent from an
 *   older copy (a save queued before the answer came back) is one already
 *   made. So ticking again after the save that took the page's answer was
 *   lost, or on a page opened afresh, finishes the next occurrence.
 * - A save that doesn't say (an app from before this, a restored version)
 *   goes by what the page last said for the line (`done`, kept on the
 *   link): a line counts only when it differs from its task and from that.
 *   Such a page has to say the line is unticked before ticking it again
 *   counts. A task changed anywhere else starts it again from the task.
 *
 * A line whose task this person can't change is left alone rather than
 * failing the save; anything else that goes wrong fails it.
 *
 * Gives back the content to store: every line tied to a task reads as its
 * task now stands, so what is kept and what the editors are sent agree.
 * Must run with the page locked (requireDoc), so the version this save gives
 * it is the one after its current version.
 */
export async function syncTicks(
  db: Db,
  u: UserRow,
  docId: string,
  content: DocBlock[],
  ticksFrom: number | null,
): Promise<DocBlock[]> {
  const ticks = new Map(
    content.flatMap((b) =>
      b.type === "todo" && b.id ? [[b.id, b.done] as const] : [],
    ),
  );
  if (!ticks.size) return content;
  // The tasks first, on their own. A task being finished or reopened
  // elsewhere at this moment is waited for here, and what it changed (the
  // task, and the version this page shows it from: see followTaskState) is
  // read afresh below, once it's done. Read in the same statement as the
  // lock, the link would still say what it said before that change, so an
  // old tick on this page would count against it. The links aren't locked:
  // that change writes them while it holds the task.
  const locked = (
    await db.query<{ id: string }>(
      `SELECT i.id FROM items i
        WHERE i.id IN (SELECT l.item_id FROM doc_task_links l
                        WHERE l.doc_id = $1 AND l.block_id = ANY($2::text[]))
        ORDER BY i.id
        FOR UPDATE`,
      [docId, [...ticks.keys()]],
    )
  ).rows.map((r) => r.id);
  if (!locked.length) return content;
  const rows = (
    await db.query<{
      block_id: string;
      item_id: string;
      status: string;
      done: boolean | null;
      done_version: number | null;
      version: number;
    }>(
      `SELECT l.block_id, l.item_id, l.done, l.done_version, i.status,
              d.version
         FROM doc_task_links l
         JOIN items i ON i.id = l.item_id
         JOIN docs d ON d.id = l.doc_id
        WHERE l.doc_id = $1 AND l.block_id = ANY($2::text[])
          AND l.item_id = ANY($3::uuid[])
        ORDER BY l.item_id, l.block_id`,
      [docId, [...ticks.keys()], locked],
    )
  ).rows;
  if (!rows.length) return content;
  // A tick here never moves this page's own version (see followTaskState).
  const saving = rows[0].version + 1;
  for (const row of rows) {
    const wanted = ticks.get(row.block_id)!;
    const counts =
      wanted !== (row.status === "done") &&
      (ticksFrom !== null
        ? row.done_version === null || ticksFrom >= row.done_version
        : // A link made before pages kept their ticks (null) goes by the task.
          wanted !== row.done);
    if (counts) {
      await db.query("SAVEPOINT tick");
      try {
        await setItemStatus(
          db,
          u,
          row.item_id,
          wanted ? "done" : "todo",
          wanted ? 100 : 0,
          { fromDoc: docId },
        );
        // Reopened with a checklist, progress follows its steps again.
        if (!wanted) await recomputeProgress(db, row.item_id);
        await db.query("RELEASE SAVEPOINT tick");
      } catch (e) {
        // Only "you can't change that task" is shrugged off; anything else
        // is a real failure and fails the save.
        if (!isRefusal(e)) throw e;
        await db.query("ROLLBACK TO SAVEPOINT tick");
      }
    }
    // What the page said, even when the task wouldn't follow: a refused tick
    // isn't tried again with every save, only when the line is ticked again.
    // A tick that counted is shown as its task now stands from this save on.
    if (counts || row.done !== wanted)
      await db.query(
        `UPDATE doc_task_links SET done = $3,
           done_version = CASE WHEN $4::boolean THEN $5::int ELSE done_version END
          WHERE doc_id = $1 AND block_id = $2`,
        [docId, row.block_id, wanted, counts, saving],
      );
  }
  return withTaskState(db, docId, content);
}

/**
 * Keep every remark pointing at the words it was written about.
 *
 * An edit before a remark's words moves them along the line; an edit that
 * takes the words away leaves the remark with nothing to point at. Rather
 * than throw it away, the remark is marked detached and shown apart with the
 * words it quoted, so a thought survives the sentence it was about. Only the
 * remarks whose anchor actually moved are written.
 */
export async function followComments(
  db: Db,
  docId: string,
  content: DocBlock[],
): Promise<void> {
  const comments = (
    await db.query<DocComment>(
      `SELECT id, block_id, quote, range_start, range_end, detached
         FROM doc_comments WHERE doc_id = $1 AND resolved_at IS NULL`,
      [docId],
    )
  ).rows;
  if (!comments.length) return;
  for (const moved of reanchorComments(comments, content))
    await db.query(
      `UPDATE doc_comments SET range_start = $2, range_end = $3, detached = $4
        WHERE id = $1`,
      [moved.id, moved.range_start, moved.range_end, moved.detached],
    );
}

/**
 * Keep open proposals pointing at the words they would change. A proposal
 * whose words have gone cannot be written anywhere sensible, so it comes
 * loose and is shown as needing a fresh look rather than applied blind.
 */
export async function followSuggestions(
  db: Db,
  docId: string,
  content: DocBlock[],
): Promise<void> {
  const open = (
    await db.query<DocSuggestion>(
      `SELECT id, block_id, quote, range_start, range_end, detached
         FROM doc_suggestions WHERE doc_id = $1 AND status = 'open'`,
      [docId],
    )
  ).rows;
  if (!open.length) return;
  for (const moved of reanchorSuggestions(open, content))
    await db.query(
      `UPDATE doc_suggestions SET range_start = $2, range_end = $3, detached = $4
        WHERE id = $1`,
      [moved.id, moved.range_start, moved.range_end, moved.detached],
    );
}

/**
 * Put a page's tags where the caller asked, from the vocabulary they can
 * already use: their own tags, or their team's. A tag id that is neither is
 * quietly left out rather than failing the save — the page is what matters.
 */
export async function setTags(
  db: Db,
  docId: string,
  u: UserRow,
  teamId: string | null,
  tagIds: string[],
): Promise<void> {
  await db.query("DELETE FROM doc_tags WHERE doc_id = $1", [docId]);
  if (!tagIds.length) return;
  await db.query(
    `INSERT INTO doc_tags (doc_id, tag_id)
       SELECT $1, id FROM tags
        WHERE id = ANY($2::uuid[])
          AND (user_id = $3 OR (team_id IS NOT NULL AND team_id = $4))
     ON CONFLICT DO NOTHING`,
    [docId, [...new Set(tagIds)], u.id, teamId],
  );
}

/** A checklist line as the fields `mutate` needs to create a task. */
export function itemFromLine(text: string, teamId: string | null) {
  return itemData.parse({
    title: text.trim().slice(0, 200),
    kind: "task",
    team_id: teamId,
  });
}

/**
 * Turn a page's open checklist lines into real tasks, tying each line to
 * its task so ticking one ticks the other. Only lines that aren't tasks
 * already, and only `only` when it names some. With a project, the tasks go
 * into it, in its first stage, the way a project template's tasks do. The
 * page is read and written back under its lock; `doc` must come from
 * `requireDoc` in the same transaction. Returns the tasks made, or null
 * when there was nothing to make.
 */
export async function makeLineTasks(
  db: Db,
  u: UserRow,
  doc: { id: string; team_id: string | null },
  options: { only?: string[]; projectId?: string | null } = {},
): Promise<Item[] | null> {
  const id = doc.id;
  const content =
    (
      await db.query<{ content: DocBlock[] | null }>(
        "SELECT content FROM docs WHERE id = $1",
        [id],
      )
    ).rows[0].content ?? [];
  const only = options.only;
  const wanted = content.filter(
    (b): b is Extract<DocBlock, { type: "todo" }> =>
      b.type === "todo" &&
      !b.done &&
      b.text.trim().length > 0 &&
      (!only || (!!b.id && only.includes(b.id))),
  );
  // A line that is already tied to a task is not made again.
  const linked = new Set(
    (
      await db.query<{ block_id: string }>(
        "SELECT block_id FROM doc_task_links WHERE doc_id = $1",
        [id],
      )
    ).rows.map((r) => r.block_id),
  );
  const lines = wanted.filter((b) => !b.id || !linked.has(b.id));
  if (!lines.length) return null;
  const stage = options.projectId
    ? ((
        await db.query<{ id: string }>(
          `SELECT id FROM project_stages WHERE project_id = $1
            ORDER BY position LIMIT 1`,
          [options.projectId],
        )
      ).rows[0]?.id ?? null)
    : null;

  // Each line gets a stable id, so the link survives later edits.
  const ids = new Map(lines.map((b) => [b, b.id ?? randomUUID()]));
  const out: Item[] = [];
  for (const line of lines) {
    const item = await mutate(db, u, {
      operation: "create",
      data: itemFromLine(line.text, doc.team_id),
    });
    if (!item) continue;
    if (options.projectId) {
      await db.query(
        "UPDATE items SET project_id = $2, stage_id = $3 WHERE id = $1",
        [item.id, options.projectId, stage],
      );
      item.project_id = options.projectId;
    }
    await db.query(
      // Only unticked lines become tasks, so each starts unticked: what the
      // page last said for the line, which a save without X-Orbyn-Ticks-From
      // is measured against (see syncTicks).
      `INSERT INTO doc_task_links (doc_id, block_id, item_id, done)
         VALUES ($1,$2,$3,false)
         ON CONFLICT (doc_id, block_id) DO UPDATE SET item_id = $3, done = false`,
      [id, ids.get(line), item.id],
    );
    out.push(item);
  }
  // Write the ids back so the document knows which lines are tied.
  const next = content.map((b) =>
    ids.has(b as Extract<DocBlock, { type: "todo" }>)
      ? { ...b, id: ids.get(b as Extract<DocBlock, { type: "todo" }>) }
      : b,
  );
  await db.query(
    "UPDATE docs SET content = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1",
    [id, JSON.stringify(next)],
  );
  return out;
}

/**
 * Tags a page may carry: its own space's — your personal tags on a personal
 * page, the team's on a team page. `$2` is the reader, `$3` the page's team.
 */
export const TAG_IN_SPACE = `(($3::uuid IS NULL AND g.team_id IS NULL AND g.user_id = $2)
  OR ($3::uuid IS NOT NULL AND g.team_id = $3::uuid))`;

/** A page's tags as its tag row shows them, by name. */
export async function pageTags(
  db: Queryable,
  docId: string,
): Promise<DocTag[]> {
  return (
    await db.query<DocTag>(
      `SELECT g.id, g.name, g.color FROM doc_tags dt
         JOIN tags g ON g.id = dt.tag_id
        WHERE dt.doc_id = $1 ORDER BY lower(g.name), g.name`,
      [docId],
    )
  ).rows;
}

/**
 * Tell a page's other open editors and readers that its tags changed, so
 * their tag row follows. Tags aren't the page's words, so its version stays;
 * a failed notice only means they see the change on their next load.
 */
export const announceTags = (docId: string, version: number, by: string) =>
  announceDocChange(pool, docId, version, by, { tags: true }).catch(() => {});

/**
 * The tag called `name` in a page's space, if the space has one (names
 * compare without case, as tags always have).
 */
export async function findTagNamed(
  db: Queryable,
  u: UserRow,
  teamId: string | null,
  name: string,
): Promise<string | undefined> {
  return (
    await db.query<{ id: string }>(
      `SELECT g.id FROM tags g
        WHERE lower(g.name) = lower($1) AND ${TAG_IN_SPACE}
        ORDER BY g.created_at LIMIT 1`,
      [name, u.id, teamId],
    )
  ).rows[0]?.id;
}

/**
 * The tag called `name` in a page's space, made there if the space has no
 * tag by that name yet.
 */
export async function tagNamed(
  db: Queryable,
  u: UserRow,
  teamId: string | null,
  name: string,
): Promise<string> {
  const find = () => findTagNamed(db, u, teamId, name);
  const found = await find();
  if (found) return found;
  const made = (
    await db.query<{ id: string }>(
      `INSERT INTO tags (user_id, team_id, name) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [u.id, teamId, name],
    )
  ).rows[0]?.id;
  // Someone made the same tag a moment ago: theirs is the one.
  return made ?? (await find())!;
}

/** The event columns finding its note needs: the series, for its classes. */
export const EVENT_COLUMNS = `i.id, i.title, i.kind, i.due_at, i.end_at,
  i.location, i.team_id, i.user_id, i.rrule, i.timezone, i.series_start,
  i.exdates, i.all_day`;

export type EventRow = {
  id: string;
  title: string;
  kind: SeriesRow["kind"];
  due_at: Date | null;
  end_at: Date | null;
  location: string;
  team_id: string | null;
  user_id: string;
  rrule: string | null;
  timezone: string;
  series_start: Date | null;
  exdates: Date[];
  all_day: boolean;
};

/**
 * Which time of an event a note is for. A repeating event keeps a note per
 * class, known by the class's first start (`occurrence`, as the calendar
 * gives it); `start` is when that class now starts, and `title` and
 * `location` what it's called and where, for the note's first lines (a
 * class moved on its own can have its own). An event that doesn't repeat,
 * or a whole series (no time given), keeps one note: `occurrence` is null.
 */
export type EventTime = {
  repeats: boolean;
  occurrence: Date | null;
  start: Date | null;
  title: string;
  location: string;
};

/**
 * The time `at` of an event, as a note is kept for it. `at` is a class's
 * first start or, for a class moved on its own, its new start too; anything
 * that is neither is refused, so a note never hangs off a time the event
 * doesn't have.
 */
export async function eventTime(
  db: Queryable,
  event: EventRow,
  at: string | undefined,
): Promise<EventTime> {
  if (!event.rrule || !event.due_at)
    return {
      repeats: false,
      occurrence: null,
      start: event.due_at,
      title: event.title,
      location: event.location,
    };
  if (!at)
    return {
      repeats: true,
      occurrence: null,
      start: null,
      title: event.title,
      location: event.location,
    };
  const series = { ...event, due_at: event.due_at } as SeriesRow;
  const when = new Date(at);
  const changes = (
    await db.query<{ occurrence: Date; data: OccurrenceChanges }>(
      "SELECT occurrence, data FROM item_overrides WHERE item_id = $1",
      [event.id],
    )
  ).rows;
  const own = (occurrence: Date) =>
    changes.find((c) => c.occurrence.getTime() === occurrence.getTime())?.data;
  const classAt = (occurrence: Date, c = own(occurrence)): EventTime => ({
    repeats: true,
    occurrence,
    start: c?.due_at ? new Date(c.due_at) : occurrence,
    title: c?.title?.trim() || event.title,
    location: c?.location ?? event.location,
  });
  if (isOccurrence(series, when)) return classAt(when);
  const moved = changes.find(
    (c) =>
      !!c.data.due_at &&
      Date.parse(c.data.due_at) === when.getTime() &&
      isOccurrence(series, c.occurrence),
  );
  if (moved) return classAt(moved.occurrence, moved.data);
  return fail(422, "That isn't one of this event's times.");
}

/**
 * Wait for anyone else finding or making the note for this time of this
 * event, so two at once (two people, or a first open and a template) end up
 * with one note.
 */
export async function lockEventNote(db: Db, itemId: string, when: EventTime) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `event-note:${itemId}:${when.occurrence?.toISOString() ?? ""}`,
  ]);
}

/**
 * An event's own notes before the notes of classes it no longer has (which
 * are kept as the event's, remembering their class in `class_was`).
 */
export const OWN_NOTE_FIRST =
  "(d.occurrence IS NULL AND d.class_was IS NOT NULL)";

/**
 * The note an event already has, as opening the event finds it: a meeting
 * page hanging off it in the event's own space, not in Trash — for a class
 * of a repeating event, that class's own, and for a whole series, the
 * series'. When there are several (written before an event kept to one),
 * the latest edited — but a former class's note (its class skipped,
 * deleted or dropped: `class_was`) only when the event has no note of its
 * own, so the running note of a weekly one-to-one isn't swapped out.
 */
export async function eventNote(
  db: Queryable,
  u: UserRow,
  itemId: string,
  teamId: string | null,
  when: EventTime,
): Promise<Doc | undefined> {
  return (
    await db.query<Doc>(
      `SELECT ${COLUMNS}, d.content FROM docs d ${JOINS}
        WHERE d.item_id = $2 AND d.kind = 'meeting'
          AND d.team_id IS NOT DISTINCT FROM $3::uuid AND ${VISIBLE}
          AND (NOT $4::boolean
            OR d.occurrence IS NOT DISTINCT FROM $5::timestamptz)
        ORDER BY ${OWN_NOTE_FIRST}, d.updated_at DESC, d.created_at LIMIT 1`,
      [u.id, itemId, teamId, when.repeats, when.occurrence],
    )
  ).rows[0];
}

/**
 * Keep the state a save is about to replace. Saves come every second or
 * so while someone types, so a state is kept only when the last kept one
 * is by someone else or older than a sitting; history then reads as a
 * list of sittings, not keystrokes.
 */
export const SITTING = "5 minutes";
export async function snapshot(db: Queryable, docId: string, byUser: string) {
  const current = (
    await db.query<{ version: number; title: string; content: unknown }>(
      "SELECT version, title, content FROM docs WHERE id = $1",
      [docId],
    )
  ).rows[0];
  if (!current) return;
  const last = (
    await db.query<{ user_id: string | null; recent: boolean }>(
      `SELECT user_id, created_at > now() - $2::interval AS recent
         FROM doc_versions WHERE doc_id = $1
         ORDER BY version DESC LIMIT 1`,
      [docId, SITTING],
    )
  ).rows[0];
  if (last && last.recent && last.user_id === byUser) return;
  await db.query(
    `INSERT INTO doc_versions (doc_id, version, title, content, user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (doc_id, version) DO NOTHING`,
    [
      docId,
      current.version,
      current.title,
      JSON.stringify(current.content),
      byUser,
    ],
  );
}

/**
 * Add lines to a page as one save by `u`, under the page's lock: `place`
 * gets the page's lines and gives back the page with the new ones in. The
 * state before is kept for history as any save's is, and open editors are
 * told, so a page open on another device takes the lines in. 404 for a
 * page the person can't see, 403 for one they may only read.
 */
export async function addToPage(
  u: UserRow,
  docId: string,
  place: (content: DocBlock[]) => DocBlock[],
): Promise<{ id: string; title: string; version: number }> {
  const saved = await transaction(async (db) => {
    await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
    await requireDoc(db, docId, u, "items:write");
    const current = (
      await db.query<{ content: DocBlock[] | null }>(
        "SELECT content FROM docs WHERE id = $1",
        [docId],
      )
    ).rows[0].content;
    await snapshot(db, docId, u.id);
    return (
      await db.query<{ id: string; title: string; version: number }>(
        `UPDATE docs SET content = $2::jsonb, version = version + 1,
           updated_at = now()
         WHERE id = $1 RETURNING id, title, version`,
        [docId, JSON.stringify(place(current ?? []))],
      )
    ).rows[0];
  });
  await announceDocChange(pool, saved.id, saved.version, "share").catch(
    () => {},
  );
  await syncSavedPages(saved.id);
  return saved;
}

// --- Proposed changes --------------------------------------------------

/** A proposal as the clients read it, with its author's name. */
export const SUGGESTION_SELECT = `SELECT s.id, s.doc_id, s.block_id, s.user_id,
       u.name AS author, s.kind, s.range_start, s.range_end, s.text,
       s.quote, s.note, s.status, s.detached, s.created_at
  FROM doc_suggestions s JOIN users u ON u.id = s.user_id`;

/** One proposed change to a line: its place in the line and the new words. */
export type ProposedChange = {
  block_id: string;
  kind: "replace" | "insert" | "delete";
  range_start: number;
  range_end: number;
  text: string;
  quote: string;
};

/**
 * Propose changes to a page, beside its words for someone who may change it
 * to take or leave. The one way proposals are made: a person's (POST
 * /docs/:id/suggestions), the assistant's rewrite of a passage and its
 * propose_doc_edit tool all come here. The caller has checked the person may
 * read the page (proposing is open to every reader). Returns the proposals,
 * oldest first.
 */
export async function proposeChanges(
  db: Queryable,
  docId: string,
  userId: string,
  changes: ProposedChange[],
  note: string,
): Promise<DocSuggestion[]> {
  if (!changes.length) return [];
  const ids = (
    await db.query<{ id: string }>(
      // In the order given (each a moment after the last, so a list of
      // proposals reads in the order they were made).
      `INSERT INTO doc_suggestions
         (doc_id, user_id, block_id, kind, range_start, range_end,
          text, quote, note, created_at)
       SELECT $1, $2, c.block_id, c.kind, c.range_start, c.range_end,
              c.text, c.quote, $4, now() + (c.ord * interval '1 microsecond')
         FROM jsonb_to_recordset($3::jsonb)
           AS c(block_id text, kind text, range_start int, range_end int,
                text text, quote text, ord int)
       RETURNING id`,
      [
        docId,
        userId,
        JSON.stringify(changes.map((c, ord) => ({ ...c, ord }))),
        note,
      ],
    )
  ).rows.map((r) => r.id);
  return (
    await db.query<DocSuggestion>(
      `${SUGGESTION_SELECT} WHERE s.id = ANY($1::uuid[]) ORDER BY s.created_at, s.id`,
      [ids],
    )
  ).rows;
}

/**
 * The change that turns `find` into `replace` on a page as it stands: the
 * first line holding those exact words, and where in it. Null when no line
 * does (a proposal against words that aren't there would have nothing to
 * apply).
 */
export function changeFor(
  content: DocBlock[],
  find: string,
  replace: string,
): ProposedChange | null {
  const block = content.find((b) => b.id && blockText(b).includes(find));
  if (!block?.id) return null;
  const at = blockText(block).indexOf(find);
  return {
    block_id: block.id,
    kind: replace ? "replace" : "delete",
    range_start: at,
    range_end: at + find.length,
    text: replace,
    quote: find,
  };
}
