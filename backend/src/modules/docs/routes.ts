import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import {
  docCommentInput,
  docCommentUpdate,
  docInput,
  docListQuery,
  itemData,
  docPreview,
  docSuggestionInput,
  docToHtml,
  docToMarkdown,
  docToText,
  docUpdate,
  EXPORT_FORMATS,
  EXPORT_LABELS,
  exportName,
  fail,
  HttpError,
  applySuggestion,
  overlaps,
  reanchorComments,
  reanchorSuggestions,
  meetingNoteTemplate,
  serializeDoc,
  TRASH_DAYS,
  MAX_SITTINGS,
  docTasksInput,
  docTagsInput,
  docTagNamesInput,
  isDateKey,
  agendaTitleOn,
  PAGE_TAG_LIMIT,
  blankDate,
  eventNotesQuery,
  itemNoteInput,
  type EventNoteRef,
  type OccurrenceChanges,
  type DocTag,
  type TrashedDoc,
  type Doc,
  type DocBlock,
  type DocComment,
  type DocSuggestion,
  type DocSummary,
  type DocVersion,
  type DocVersionChanges,
  type Item,
} from "@orbyn/core";
import {
  pool,
  reader,
  transaction,
  type Db,
  type Queryable,
} from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam, VISIBLE_ITEMS } from "../../lib/teams.js";
import {
  isOccurrence,
  loadPrefs,
  type SeriesRow,
} from "../planner/calendar.js";
import { mutate, recomputeProgress, setItemStatus } from "../items/service.js";
import { announceDocChange } from "./live.js";
import { hasVectors } from "../search/semantic.js";
import {
  agendaDayOf,
  agendaOn,
  todaysAgenda,
  writeAgendaOn,
} from "./agenda.js";
import { adoptDeviceZone } from "../planner/timezone.js";
import { docToDocx } from "./docx.js";
import { docToPdf } from "./pdf.js";

/**
 * Documents: notes, briefs and agendas. Personal documents belong to their
 * author; team documents follow the same team roles as team items (viewers
 * read, members and above write). Edits carry the version they were made
 * against, so two open tabs can't silently overwrite each other.
 */

export const COLUMNS = `d.id, d.user_id, d.team_id, t.name AS team_name, d.title, d.kind,
  d.item_id, d.project_id, p.name AS project_name, d.folder_id, d.version,
  d.created_at, d.updated_at, d.reviewed_at, d.imported_from, d.in_uploads,
  CASE WHEN d.imported_from IS NOT NULL THEN (
    SELECT json_build_object('id', k.id, 'doc_id', k.doc_id, 'file_name', k.file_name,
      'file_type', k.file_type, 'bytes', k.bytes, 'created_at', k.created_at)
      FROM kept_files k WHERE k.doc_id = d.id) END AS original,
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
const COMMENT_SELECT = `SELECT c.id, c.doc_id, c.user_id, u.name AS author, c.body,
         c.block_id, c.quote, c.range_start, c.range_end, c.parent_id,
         c.detached, c.resolved_at, c.created_at,
         coalesce((SELECT json_agg(json_build_object('user_id', mu.id, 'name', mu.name)
                                   ORDER BY mu.name)
                     FROM doc_comment_mentions m JOIN users mu ON mu.id = m.user_id
                    WHERE m.comment_id = c.id), '[]'::json) AS mentions
    FROM doc_comments c JOIN users u ON u.id = c.user_id`;

/** Documents `$1` could see if they weren't in Trash: their own, and their teams'. */
const SEES = `((d.team_id IS NULL AND d.user_id = $1)
  OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

/**
 * Documents `$1` can see: their own, and their teams', leaving out anything
 * in Trash. A page in Trash is gone as far as everything but Trash itself
 * is concerned: lists, search, comments, history and exports all answer
 * "not found" for it, the same as for a page that never existed.
 */
const VISIBLE = `(${SEES} AND d.deleted_at IS NULL)`;

/**
 * A page may hang off a task, a project or a folder only in its own space:
 * a personal page off the author's own things, a team page off that team's.
 * Anything else is "not found" — the same answer as for an id that doesn't
 * exist, so ids from another space reveal nothing.
 */
async function checkLinks(
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
       AND (${alias}.team_id IS NULL OR ${alias}.team_id IN
         (SELECT team_id FROM team_members WHERE user_id = $1))`;
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

type Owned = {
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
async function noteTrash(
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
async function searchTrash(db: Db, docId: string, trashed: boolean) {
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
async function dropStandInCopy(db: Queryable, docId: string) {
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
async function requireDoc(
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
async function withTaskState(
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
async function readDoc(db: Queryable, id: string): Promise<Doc> {
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
const REFUSALS = new Set([403, 404, 409, 422]);
const isRefusal = (e: unknown) =>
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
async function syncTicks(
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
async function followComments(
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
async function followSuggestions(
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
async function setTags(
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
function itemFromLine(text: string, teamId: string | null) {
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
const TAG_IN_SPACE = `(($3::uuid IS NULL AND g.team_id IS NULL AND g.user_id = $2)
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
const announceTags = (docId: string, version: number, by: string) =>
  announceDocChange(pool, docId, version, by, { tags: true }).catch(() => {});

/**
 * The tag called `name` in a page's space, if the space has one (names
 * compare without case, as tags always have).
 */
async function findTagNamed(
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
const OWN_NOTE_FIRST = "(d.occurrence IS NULL AND d.class_was IS NOT NULL)";

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
const SITTING = "5 minutes";
async function snapshot(db: Queryable, docId: string, byUser: string) {
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
  return saved;
}

export async function docRoutes(app: FastifyInstance) {
  /** The documents someone can see, newest edit first. */
  app.get("/docs", async (r) => {
    const u = await authenticate(r);
    const q = docListQuery.parse(r.query ?? {});
    const rows = (
      await reader(r.headers).query<DocSummary & { content: DocBlock[] }>(
        `SELECT ${COLUMNS}, d.content FROM docs d ${JOINS}
          WHERE ${VISIBLE}
            AND ($2::text IS NULL OR d.kind = $2)
            AND ($3::uuid IS NULL OR d.project_id = $3)
            AND ($4::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM doc_tags dt
                   WHERE dt.doc_id = d.id AND dt.tag_id = $4))
          ORDER BY d.updated_at DESC
          LIMIT 200`,
        [u.id, q.kind ?? null, q.project ?? null, q.tag ?? null],
      )
    ).rows;
    // The preview is derived here so the list stays light on the wire.
    return rows.map(({ content, ...rest }) => ({
      ...rest,
      preview: docPreview(content ?? []),
    }));
  });

  app.post("/docs", async (r, reply) => {
    const u = await authenticate(r);
    const data = docInput.parse(r.body ?? {});
    if (data.team_id) await requireTeam(data.team_id, u, "items:write");
    await checkLinks(pool, u, data.team_id ?? null, data);
    const doc = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, team_id, title, kind, content, item_id,
             folder_id, project_id)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id`,
          [
            u.id,
            data.team_id,
            data.title,
            data.kind,
            JSON.stringify(data.content),
            data.item_id,
            data.folder_id,
            data.project_id,
          ],
        )
      ).rows[0].id;
      await setTags(db, id, u, data.team_id, data.tags);
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content, ${LINKED} FROM docs d
             ${JOINS} WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
    });
    reply.code(201);
    return doc;
  });

  app.get("/docs/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const doc = (
      await db.query<Doc>(
        `SELECT ${COLUMNS}, d.content, ${LINKED} FROM docs d ${JOINS}
          WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    return { ...doc, content: await withTaskState(db, id, doc.content ?? []) };
  });

  /** Export as Markdown, with any LaTeX kept as source. */
  /**
   * A page as a file to keep: Markdown, plain words, a web page, Word or
   * PDF. One route rather than five, because the only thing that differs is
   * the shape the same blocks come out in.
   */
  app.get("/docs/:id/export", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { format } = z
      .object({ format: z.enum(EXPORT_FORMATS).default("md") })
      .strict()
      .parse(r.query ?? {});
    const doc = (
      await reader(r.headers).query<{ title: string; content: DocBlock[] }>(
        `SELECT d.title, d.content FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    const title = doc.title || "Untitled";
    // Ticks as the tasks stand, the same as the page reads.
    const blocks = await withTaskState(
      reader(r.headers),
      id,
      doc.content ?? [],
    );
    const body =
      format === "docx"
        ? docToDocx(title, blocks)
        : format === "pdf"
          ? docToPdf(title, blocks)
          : format === "html"
            ? docToHtml(title, blocks)
            : format === "txt"
              ? docToText(title, blocks)
              : docToMarkdown(title, blocks);
    return (
      reply
        .type(`${EXPORT_LABELS[format].type}; charset=utf-8`)
        // The name is offered here so every client gets the same file name.
        .header(
          "content-disposition",
          `attachment; filename="${exportName(title, format).replace(/"/g, "")}"`,
        )
        .send(body)
    );
  });

  app.get("/docs/:id/markdown", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const doc = (
      await reader(r.headers).query<{ title: string; content: DocBlock[] }>(
        `SELECT d.title, d.content FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    const blocks = await withTaskState(
      reader(r.headers),
      id,
      doc.content ?? [],
    );
    return reply
      .type("text/markdown; charset=utf-8")
      .send(`# ${doc.title}\n\n${serializeDoc(blocks)}`);
  });

  // Let go of the listening connection when the server stops.

  /**
   * Which open editor a request came from. Two tabs belonging to the same
   * person are two editors, so this is the tab's own id rather than the
   * user's; a tab should not be told about the change it just made itself.
   */
  const editorOf = (r: { headers: Record<string, unknown> }) =>
    typeof r.headers["x-orbyn-editor"] === "string"
      ? (r.headers["x-orbyn-editor"] as string).slice(0, 64)
      : "";

  /**
   * The version of the page an editor's ticks were taken from (see
   * syncTicks), or null when it doesn't say. Never later than the version
   * the save is based on.
   */
  const ticksFrom = (
    r: { headers: Record<string, unknown> },
    base: number,
  ): number | null => {
    const raw = r.headers["x-orbyn-ticks-from"];
    const n = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? +raw : 0;
    return n > 0 ? Math.min(n, base) : null;
  };

  app.put("/docs/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = docUpdate.parse(r.body);
    const saved = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const current = await requireDoc(db, id, u, "items:write");
      await checkLinks(db, u, current.team_id, {
        project_id: body.project_id,
        folder_id: body.folder_id,
      });
      if (current.version !== body.version)
        fail(
          409,
          "This document changed somewhere else. Refresh and try again.",
        );
      // Lines tied to tasks are stored as their tasks now stand.
      const content = body.content
        ? await syncTicks(db, u, id, body.content, ticksFrom(r, body.version))
        : undefined;
      if (content) await followComments(db, id, content);
      if (content) await followSuggestions(db, id, content);
      await snapshot(db, id, u.id);
      await db.query(
        `UPDATE docs SET
           title = coalesce($2, title),
           content = coalesce($3::jsonb, content),
           folder_id = CASE WHEN $4::boolean THEN $5::uuid ELSE folder_id END,
           project_id = CASE WHEN $6::boolean THEN $7::uuid ELSE project_id END,
           -- Filing an imported page anywhere takes it out of Uploads.
           in_uploads = CASE WHEN $4::boolean OR $6::boolean THEN false
                             ELSE in_uploads END,
           version = version + 1,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.title ?? null,
          content === undefined ? null : JSON.stringify(content),
          body.folder_id !== undefined,
          body.folder_id ?? null,
          body.project_id !== undefined,
          body.project_id ?? null,
        ],
      );
      if (body.tags) await setTags(db, id, u, current.team_id, body.tags);
      return readDoc(db, id);
    });
    // Announced after the transaction commits, so anyone who comes running
    // to re-read the document finds the new version already there.
    await announceDocChange(pool, id, saved.version, editorOf(r));
    return saved;
  });

  const VERSION_COLUMNS = `v.version, v.title, v.created_at, v.user_id,
    us.name AS author, jsonb_array_length(v.content) AS blocks`;

  /** 404 unless the reader may see this document. */
  async function mustSee(db: Queryable, id: string, u: UserRow) {
    const row = (
      await db.query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!row) fail(404, "Document not found");
  }

  /** Past states of a document, newest first. */
  app.get("/docs/:id/versions", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await mustSee(reader(r.headers), id, u);
    return (
      await reader(r.headers).query<DocVersion>(
        `SELECT ${VERSION_COLUMNS} FROM doc_versions v
           LEFT JOIN users us ON us.id = v.user_id
           WHERE v.doc_id = $1 ORDER BY v.version DESC LIMIT 200`,
        [id],
      )
    ).rows;
  });

  /** One past state, with its content, to read or compare. */
  app.get("/docs/:id/versions/:version", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const n = Number((r.params as { version: string }).version);
    if (!Number.isInteger(n) || n < 1) fail(422, "Not a version");
    await mustSee(reader(r.headers), id, u);
    const row = (
      await reader(r.headers).query<DocVersion>(
        `SELECT ${VERSION_COLUMNS}, v.content FROM doc_versions v
           LEFT JOIN users us ON us.id = v.user_id
           WHERE v.doc_id = $1 AND v.version = $2`,
        [id, n],
      )
    ).rows[0];
    if (!row) fail(404, "That version is not kept");
    return row;
  });

  /**
   * What "Show changes" reads for one version, in one request rather than
   * one per version: the version, the one kept before it, and every one
   * kept since (up to MAX_SITTINGS), each with its content and author.
   */
  app.get("/docs/:id/versions/:version/changes", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const n = Number((r.params as { version: string }).version);
    if (!Number.isInteger(n) || n < 1) fail(422, "Not a version");
    const db = reader(r.headers);
    await mustSee(db, id, u);
    // The one before, this one, and one more than can be named since, so
    // "too many to name" is known without counting them all.
    const rows = (
      await db.query<Required<DocVersion>>(
        `SELECT ${VERSION_COLUMNS}, v.content FROM doc_versions v
           LEFT JOIN users us ON us.id = v.user_id
          WHERE v.doc_id = $1
            AND v.version >= coalesce(
              (SELECT max(p.version) FROM doc_versions p
                WHERE p.doc_id = $1 AND p.version < $2), $2)
          ORDER BY v.version LIMIT $3`,
        [id, n, MAX_SITTINGS + 2],
      )
    ).rows;
    const at = rows.findIndex((v) => v.version === n);
    if (at < 0) fail(404, "That version is not kept");
    const newer = rows.slice(at + 1);
    const answer: DocVersionChanges = {
      version: rows[at],
      older: at > 0 ? rows[at - 1] : null,
      sittings:
        newer.length < MAX_SITTINGS
          ? [rows[at], ...newer].map((v) => ({
              content: v.content,
              author: v.author,
            }))
          : null,
    };
    return answer;
  });

  /**
   * Put a past state back. It becomes a new version on top, so history is
   * only ever added to; the state being replaced is kept like any other.
   */
  app.post("/docs/:id/versions/:version/restore", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const n = Number((r.params as { version: string }).version);
    if (!Number.isInteger(n) || n < 1) fail(422, "Not a version");
    const restored = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireDoc(db, id, u, "items:write");
      const past = (
        await db.query<{ title: string; content: DocBlock[] }>(
          "SELECT title, content FROM doc_versions WHERE doc_id = $1 AND version = $2",
          [id, n],
        )
      ).rows[0];
      if (!past) fail(404, "That version is not kept");
      // A restored version's ticks are ones the page said before.
      const content = await syncTicks(db, u, id, past.content, null);
      // Going back in time moves the words a remark points at, so the same
      // pass a save makes runs here too — a remark left behind by a restore
      // comes loose rather than pointing at the wrong sentence.
      await followComments(db, id, content);
      await followSuggestions(db, id, content);
      // A restore is a sitting of its own: always keep what it replaces.
      const current = (
        await db.query<{ version: number; title: string; content: unknown }>(
          "SELECT version, title, content FROM docs WHERE id = $1",
          [id],
        )
      ).rows[0];
      await db.query(
        `INSERT INTO doc_versions (doc_id, version, title, content, user_id)
           VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (doc_id, version) DO NOTHING`,
        [
          id,
          current.version,
          current.title,
          JSON.stringify(current.content),
          u.id,
        ],
      );
      await db.query(
        `UPDATE docs SET title = $2, content = $3::jsonb, version = version + 1,
           updated_at = now() WHERE id = $1`,
        [id, past.title, JSON.stringify(content)],
      );
      return readDoc(db, id);
    });
    await announceDocChange(pool, id, restored.version, editorOf(r));
    return restored;
  });

  // A document's changes as they happen are streamed by the realtime
  // service (modules/realtime), which holds the long-lived connections.

  /**
   * Today's agenda. Written once per day from the calendar (see agenda.ts)
   * and then kept as an ordinary document, so edits survive; asking again
   * the same day returns the same page rather than overwriting what you
   * wrote. It never waits on the AI provider: the worker writes the morning's
   * page with the assistant's summary, and "Rewrite" asks for one.
   */
  app.get("/agenda/today", async (r) => {
    const u = await authenticate(r);
    // The device's zone, so the first agenda of someone who never set one
    // isn't written in UTC (see planner/timezone.ts).
    const zone = (r.query as { timezone?: unknown }).timezone;
    if (typeof zone === "string")
      await adoptDeviceZone(u.id, zone.slice(0, 64));
    return todaysAgenda(u.id);
  });

  /** A day for the agenda routes: "2026-09-24", or a 422 answer. */
  const dateParam = (r: { params: unknown }) => {
    const date = String((r.params as { date?: unknown }).date ?? "");
    if (!isDateKey(date)) fail(422, "That isn't a date like 2026-09-24.");
    return date;
  };

  /**
   * One day's agenda, for stepping back and forward from today's. Today's
   * is written on the spot, as `/agenda/today` does; another day's page is
   * there only if it was written, and otherwise `doc` is null and the app
   * offers to write it. Days more than a year back or two months ahead are
   * out of reach.
   */
  app.get("/agenda/:date", async (r) => {
    const u = await authenticate(r);
    const date = dateParam(r);
    const zone = (r.query as { timezone?: unknown }).timezone;
    if (typeof zone === "string")
      await adoptDeviceZone(u.id, zone.slice(0, 64));
    const day = await agendaDayOf(u.id, date);
    if (!day) fail(422, "The agenda goes back a year and ahead two months.");
    return {
      date,
      title: agendaTitleOn(date),
      today: day.today,
      doc: await agendaOn(u.id, date),
    };
  });

  /** Write one day's agenda from the calendar, if it isn't written yet. */
  app.post("/agenda/:date", async (r, reply) => {
    const u = await authenticate(r);
    const date = dateParam(r);
    const made = await writeAgendaOn(u.id, date);
    if (!made) fail(422, "The agenda goes back a year and ahead two months.");
    reply.code(made.created ? 201 : 200);
    return made.doc;
  });

  /**
   * The note for one event, created from a template the first time it's
   * opened. It belongs to whoever opened it, and to the event's team when it
   * has one, so a shared meeting keeps one shared note. A repeating event
   * keeps one per class: `occurrence` says which (without it, the note is
   * the whole series').
   */
  app.post("/items/:id/note", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { occurrence } = itemNoteInput.parse(r.body ?? {});
    const event = (
      await pool.query<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM items i
          WHERE i.id = $2 AND ${VISIBLE_ITEMS}`,
        [u.id, id],
      )
    ).rows[0];
    if (!event) fail(404, "Item not found");
    const when = await eventTime(pool, event, occurrence);

    const existing = await eventNote(pool, u, id, event.team_id, when);
    if (existing)
      return {
        ...existing,
        content: await withTaskState(pool, existing.id, existing.content ?? []),
      };

    const prefs = await loadPrefs(pool, u.id);
    const timeZone = prefs.timezone || "UTC";
    const content = meetingNoteTemplate({
      title: when.title,
      due_at: when.start ? when.start.toISOString() : null,
      location: when.location,
      timeZone,
    });
    // A class's note says which class in its name, so a term of them reads
    // apart in the library.
    const title =
      when.occurrence && when.start
        ? `${when.title} · ${blankDate(when.start, timeZone)}`
        : when.title;
    const made = await transaction(async (db) => {
      // Two first opens at once (or a note being made from a template) must
      // not leave the event with two notes: the check is made again under
      // the lock for this time of the event.
      await lockEventNote(db, id, when);
      const again = await eventNote(db, u, id, event.team_id, when);
      if (again) return { doc: again, created: false };
      const newId = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, team_id, title, kind, content, item_id,
             occurrence)
             VALUES ($1,$2,$3,'meeting',$4::jsonb,$5,$6) RETURNING id`,
          [
            u.id,
            event.team_id,
            title.slice(0, 200),
            JSON.stringify(content),
            id,
            when.occurrence,
          ],
        )
      ).rows[0].id;
      return {
        doc: (
          await db.query<Doc>(
            `SELECT ${COLUMNS}, d.content, ${LINKED} FROM docs d
               ${JOINS} WHERE d.id = $1`,
            [newId],
          )
        ).rows[0],
        created: true,
      };
    });
    if (made.created) reply.code(201);
    return made.doc;
  });

  /**
   * Turn a document's unticked checklist lines into real tasks. Blank lines
   * are skipped, and the answer says how many were made, so the page can tell
   * you plainly.
   */
  app.post("/docs/:id/tasks", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    // Just these lines, when asked: "Make task" and the / menu's "New task"
    // turn one line into a task, not every open line on the page.
    const { block_ids: only } = docTasksInput.parse(r.body ?? {});
    const made = await transaction(async (db) => {
      // The page is read and written back under its lock, so a save that
      // lands meanwhile waits, then finds the version moved on and merges,
      // rather than being written over with the copy read here.
      const doc = await requireDoc(db, id, u, "items:read");
      // An agenda's lines are copies of tasks you already have; making them
      // into tasks would only make each one twice.
      if (doc.kind === "agenda")
        fail(422, "This agenda lists tasks you already have.");
      return makeLineTasks(db, u, doc, { only });
    });
    if (!made) return { created: 0, items: [], doc: null };
    const updated = (
      await pool.query<Doc>(
        `SELECT ${COLUMNS}, d.content, ${LINKED} FROM docs d
           ${JOINS} WHERE d.id = $1`,
        [id],
      )
    ).rows[0];
    await announceDocChange(pool, id, updated.version, editorOf(r));
    return {
      created: made.length,
      items: made,
      doc: {
        ...updated,
        content: await withTaskState(pool, id, updated.content ?? []),
      },
    };
  });

  /**
   * Put exactly these tags on a page, from its own space's tags. A tag the
   * page already carries may stay, wherever it came from; any other tag
   * outside the page's space is "not found". Tags aren't the page's words,
   * so this doesn't make a new version of it.
   */
  app.put("/docs/:id/tags", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { tags } = docTagsInput.parse(r.body);
    const wanted = [...new Set(tags)];
    const out = await transaction(async (db) => {
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
    });
    await announceTags(id, out.version, editorOf(r));
    return { tags: out.tags };
  });

  /**
   * Add tags to a page by name, as typing "#physics" in a line does. A name
   * the page's space has no tag for yet makes one there. A page holds at
   * most PAGE_TAG_LIMIT tags; names past that are left off, and the answer
   * says which were added.
   */
  app.post("/docs/:id/tags", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { names } = docTagNamesInput.parse(r.body);
    const out = await transaction(async (db) => {
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
        // A full page takes no more, and a tag is only made when it will
        // go on the page: a name left off here leaves nothing behind.
        if (have.size >= PAGE_TAG_LIMIT) break;
        const tag = found ?? (await tagNamed(db, u, doc.team_id, name));
        await db.query(
          "INSERT INTO doc_tags (doc_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [id, tag],
        );
        have.add(tag);
        added.push(name);
      }
      return {
        tags: await pageTags(db, id),
        added,
        version: doc.version,
      };
    });
    if (out.added.length) await announceTags(id, out.version, editorOf(r));
    return { tags: out.tags, added: out.added };
  });

  /** Everyone's remarks on a document, oldest first. */
  app.get("/docs/:id/comments", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const seen = (
      await db.query(`SELECT 1 FROM docs d WHERE d.id = $2 AND ${VISIBLE}`, [
        u.id,
        id,
      ])
    ).rowCount;
    if (!seen) fail(404, "Document not found");
    return (
      await db.query<DocComment>(
        `${COMMENT_SELECT} WHERE c.doc_id = $1 ORDER BY c.created_at`,
        [id],
      )
    ).rows;
  });

  /**
   * Who can be named in a comment here: the team, or just the author on a
   * personal page. The picker never offers someone who cannot read it.
   */
  app.get("/docs/:id/people", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const doc = (
      await db.query<{ team_id: string | null; user_id: string }>(
        `SELECT d.team_id, d.user_id FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
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
  });

  app.post("/docs/:id/comments", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const input = docCommentInput.parse(r.body);
    const comment = await transaction(async (db) => {
      // Anyone who can read the document can remark on it.
      const doc = await requireDoc(db, id, u, "items:read");
      if (input.parent_id) {
        // A reply belongs to a remark on this page, and threads stay one
        // deep: replying to a reply joins the same thread.
        const parent = (
          await db.query<{ id: string; parent_id: string | null }>(
            "SELECT id, parent_id FROM doc_comments WHERE id = $1 AND doc_id = $2",
            [input.parent_id, id],
          )
        ).rows[0];
        if (!parent) fail(404, "Comment not found");
        input.parent_id = parent.parent_id ?? parent.id;
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
            input.parent_id ?? null,
          ],
        )
      ).rows[0].id;
      await nameMentions(db, doc, made, u, input.body, input.mentions);
      return (
        await db.query<DocComment>(`${COMMENT_SELECT} WHERE c.id = $1`, [made])
      ).rows[0];
    });
    reply.code(201);
    return comment;
  });

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
      await db.query<{ title: string }>(
        "SELECT title FROM docs WHERE id = $1",
        [doc.id],
      )
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
  app.put("/docs/:id/comments/:commentId", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const commentId = String((r.params as { commentId: string }).commentId);
    const { resolved } = docCommentUpdate.parse(r.body);
    return transaction(async (db) => {
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
    });
  });

  /** Only the person who wrote a remark can take it back. */
  app.delete("/docs/:id/comments/:commentId", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const commentId = String((r.params as { commentId: string }).commentId);
    await transaction(async (db) => {
      await requireDoc(db, id, u, "items:read");
      const gone = (
        await db.query(
          "DELETE FROM doc_comments WHERE id = $1 AND doc_id = $2 AND user_id = $3",
          [commentId, id, u.id],
        )
      ).rowCount;
      if (!gone) fail(404, "Comment not found");
    });
    reply.code(204);
  });

  // --- Proposed changes --------------------------------------------------

  const SUGGESTION_SELECT = `SELECT s.id, s.doc_id, s.block_id, s.user_id,
         u.name AS author, s.kind, s.range_start, s.range_end, s.text,
         s.quote, s.note, s.status, s.detached, s.created_at
    FROM doc_suggestions s JOIN users u ON u.id = s.user_id`;

  /** Every proposal on a page, oldest first. */
  app.get("/docs/:id/suggestions", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    await mustSee(db, id, u);
    return (
      await db.query<DocSuggestion>(
        `${SUGGESTION_SELECT} WHERE s.doc_id = $1 ORDER BY s.created_at`,
        [id],
      )
    ).rows;
  });

  /**
   * Propose changes to a page. Anyone who can read it may propose, which is
   * the point: a proposal is a way to say something about the words without
   * being trusted to change them.
   */
  app.post("/docs/:id/suggestions", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { changes, note } = docSuggestionInput.parse(r.body);
    const made = await transaction(async (db) => {
      await requireDoc(db, id, u, "items:read");
      const ids: string[] = [];
      for (const c of changes)
        ids.push(
          (
            await db.query<{ id: string }>(
              `INSERT INTO doc_suggestions
                 (doc_id, user_id, block_id, kind, range_start, range_end,
                  text, quote, note)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [
                id,
                u.id,
                c.block_id,
                c.kind,
                c.range_start,
                c.range_end,
                c.text,
                c.quote,
                note,
              ],
            )
          ).rows[0].id,
        );
      return (
        await db.query<DocSuggestion>(
          `${SUGGESTION_SELECT} WHERE s.id = ANY($1::uuid[]) ORDER BY s.created_at`,
          [ids],
        )
      ).rows;
    });
    reply.code(201);
    return made;
  });

  /**
   * Take a proposal, or leave it. Only someone who may change the page can
   * decide; proposing is open to every reader, deciding is not.
   *
   * Accepting writes the change into the line and bumps the page's version,
   * so it shows in history as an ordinary edit with the accepter's name on
   * it. Any other open proposal over the same words would then be written
   * against words that are no longer there, so it comes loose and is shown
   * as needing a fresh look.
   */
  app.post("/docs/:id/suggestions/:sid", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const sid = String((r.params as { sid: string }).sid);
    const { take } = z
      .object({ take: z.boolean() })
      .strict()
      .parse(r.body ?? {});
    const out = await transaction(async (db) => {
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
      // Taking a proposal changes words, never a tick, so no task is
      // finished or reopened here; the lines tied to tasks are stored as
      // their tasks now stand, as every save stores them.
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
    });
    if (out) await announceDocChange(pool, id, out.version, editorOf(r));
    return { doc: out };
  });

  /** Take back a proposal you made. Only its author, and only while open. */
  app.delete("/docs/:id/suggestions/:sid", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const sid = String((r.params as { sid: string }).sid);
    await transaction(async (db) => {
      await requireDoc(db, id, u, "items:read");
      const gone = (
        await db.query(
          `DELETE FROM doc_suggestions
            WHERE id = $1 AND doc_id = $2 AND user_id = $3 AND status = 'open'`,
          [sid, id, u.id],
        )
      ).rowCount;
      if (!gone) fail(404, "Suggestion not found");
    });
    reply.code(204);
  });

  /**
   * Delete a page: it moves to Trash, where it waits for `TRASH_DAYS` before
   * the sweeper deletes it for good. Its history, comments and task links
   * stay with it, so bringing it back brings everything back.
   */
  app.delete("/docs/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const doc = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const doc = await requireDoc(db, id, u, "items:write");
      await db.query(
        "UPDATE docs SET deleted_at = now(), deleted_by = $2 WHERE id = $1",
        [id, u.id],
      );
      await noteTrash(db, id, u.id, true);
      await searchTrash(db, id, true);
      return doc;
    });
    // Anyone with it open is told, so their editor lets it go.
    await announceDocChange(pool, id, doc.version, editorOf(r), {
      trashed: true,
    });
    reply.code(204);
  });

  /**
   * The notes these events have, to mark them: one row per note, with the
   * class it is for on a repeating event (or, for a class that is gone, the
   * class it was for), latest edited first after the event's own notes —
   * the order eventNote keeps. Scoped to the events asked about
   * (and, with `from`/`to`, a repeating event's classes to those times), so
   * it holds however many pages someone has.
   */
  app.get("/docs/event-notes", async (r): Promise<EventNoteRef[]> => {
    const u = await authenticate(r);
    const q = eventNotesQuery.parse(r.query ?? {});
    return (
      await reader(r.headers).query<EventNoteRef>(
        `SELECT d.id AS doc_id, d.title, d.item_id, d.occurrence, d.team_id,
                d.class_was
           FROM docs d JOIN items i ON i.id = d.item_id
          WHERE d.item_id = ANY($2::uuid[]) AND d.kind = 'meeting'
            AND d.team_id IS NOT DISTINCT FROM i.team_id AND ${VISIBLE}
            AND ($3::timestamptz IS NULL OR d.occurrence IS NULL
              OR d.occurrence >= $3)
            AND ($4::timestamptz IS NULL OR d.occurrence IS NULL
              OR d.occurrence < $4)
          ORDER BY ${OWN_NOTE_FIRST}, d.updated_at DESC
          LIMIT 5000`,
        [u.id, q.items, q.from ?? null, q.to ?? null],
      )
    ).rows;
  });

  /**
   * The pages in Trash this reader can see, most recently deleted first:
   * their own, and their teams'. Viewers see a team's but can't act on them.
   */
  app.get("/docs/trash", async (r) => {
    const u = await authenticate(r);
    const rows = (
      await reader(r.headers).query<TrashedDoc & { content: DocBlock[] }>(
        `SELECT d.id, d.title, d.kind, d.team_id, t.name AS team_name,
                d.deleted_at, db.name AS deleted_by, d.content,
                d.deleted_at + make_interval(days => $2::int) AS purge_at,
                (d.team_id IS NULL OR m.role IN ('owner', 'admin', 'member'))
                  AS can_restore
           FROM docs d
           LEFT JOIN teams t ON t.id = d.team_id
           LEFT JOIN users db ON db.id = d.deleted_by
           LEFT JOIN team_members m ON m.team_id = d.team_id AND m.user_id = $1
          WHERE d.deleted_at IS NOT NULL AND ${SEES}
          ORDER BY d.deleted_at DESC
          LIMIT 200`,
        [u.id, TRASH_DAYS],
      )
    ).rows;
    return rows.map(({ content, ...rest }) => ({
      ...rest,
      preview: docPreview(content ?? []),
    }));
  });

  /** Bring a page back from Trash, just as it was. */
  app.post("/docs/:id/restore", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const back = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireDoc(db, id, u, "items:write", true);
      await db.query(
        "UPDATE docs SET deleted_at = NULL, deleted_by = NULL WHERE id = $1",
        [id],
      );
      await noteTrash(db, id, u.id, false);
      await searchTrash(db, id, false);
      await dropStandInCopy(db, id);
      const doc = (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d ${JOINS} WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
      return { ...doc, content: await withTaskState(db, id, doc.content) };
    });
    await announceDocChange(pool, id, back.version, editorOf(r));
    return back;
  });

  /**
   * Delete a page in Trash for good, without waiting for the sweeper. Only a
   * page already in Trash: deleting is always two steps, and the first can
   * be undone.
   */
  app.delete("/docs/:id/forever", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireDoc(db, id, u, "items:write", true);
      await db.query("DELETE FROM docs WHERE id = $1", [id]);
    });
    reply.code(204);
  });
}
