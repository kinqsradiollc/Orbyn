import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  docCommentInput,
  docCommentUpdate,
  docInput,
  docListQuery,
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
  applySuggestion,
  overlaps,
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
import { requireTeam } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { announceDocChange } from "./live.js";
import {
  agendaDayOf,
  agendaOn,
  writeAgendaOn,
  writeTodaysAgenda,
} from "./agenda.js";
import { adoptDeviceZone } from "../planner/timezone.js";
import { syncSavedPages } from "../study/service.js";
import { docToDocx } from "./docx.js";
import { docToPdf } from "./pdf.js";
import { visibleItems } from "../../lib/visibility.js";
import {
  COLUMNS,
  COMMENT_SELECT,
  EVENT_COLUMNS,
  type EventRow,
  JOINS,
  LINKED,
  OWN_NOTE_FIRST,
  type Owned,
  SEES,
  TAG_IN_SPACE,
  VISIBLE,
  announceTags,
  checkLinks,
  dropStandInCopy,
  eventNote,
  eventTime,
  findTagNamed,
  followComments,
  followSuggestions,
  lockEventNote,
  makeLineTasks,
  noteTrash,
  pageTags,
  readDoc,
  requireDoc,
  searchTrash,
  setTags,
  snapshot,
  syncTicks,
  tagNamed,
  withTaskState,
  proposeChanges,
  createDoc,
  saveDoc,
  trashDoc,
  restoreDocVersion,
  SUGGESTION_SELECT,
} from "./service.js";
import { actAs } from "../../lib/actor.js";

/**
 * Documents: notes, briefs and agendas. Personal documents belong to their
 * author; team documents follow the same team roles as team items (viewers
 * read, members and above write). Edits carry the version they were made
 * against, so two open tabs can't silently overwrite each other.
 */

/** When GET /agenda/today (it writes) gave way to POST /agenda/today. */
const AGENDA_GET_DEPRECATED = Date.UTC(2026, 8, 26);

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
    const doc = await transaction((db) => createDoc(db, u, data));
    await syncSavedPages(doc.id);
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
    const saved = await transaction((db) =>
      saveDoc(db, u, id, body, { ticksFrom: ticksFrom(r, body.version) }),
    );
    // Announced after the transaction commits, so anyone who comes running
    // to re-read the document finds the new version already there.
    await announceDocChange(pool, id, saved.version, editorOf(r));
    // Study follows the page (its card lines, and who can read it).
    await syncSavedPages(id);
    return saved;
  });

  const VERSION_COLUMNS = `v.version, v.title, v.created_at, v.user_id,
    us.name AS author, jsonb_array_length(v.content) AS blocks,
    (SELECT coalesce(nullif(g.client_name, ''), g.name) FROM agent_grants g
      WHERE g.id = v.via_grant_id) AS via_agent`;

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
    const restored = await transaction((db) => restoreDocVersion(db, u, id, n));
    await announceDocChange(pool, id, restored.version, editorOf(r));
    await syncSavedPages(id);
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
   *
   * Writing it is a POST (201 when it was written just now, 200 when it was
   * already there). `timezone` is the device's, adopted when the person
   * hasn't picked one, so their first agenda isn't written in UTC (see
   * planner/timezone.ts).
   */
  app.post("/agenda/today", async (r, reply) => {
    const u = await authenticate(r);
    const zone = (r.body as { timezone?: unknown } | null)?.timezone;
    if (typeof zone === "string")
      await adoptDeviceZone(u.id, zone.slice(0, 64));
    const made = await writeTodaysAgenda(u.id);
    if (made.created) await syncSavedPages(made.doc.id);
    reply.code(made.created ? 201 : 200);
    return made.doc;
  });

  /**
   * The same for app builds from before 26 Sep 2026, which asked with a GET.
   * It still writes, so it is marked deprecated (RFC 9745) and goes once
   * those builds have been replaced; everything current uses the POST.
   */
  app.get("/agenda/today", async (r, reply) => {
    const u = await authenticate(r);
    const zone = (r.query as { timezone?: unknown }).timezone;
    if (typeof zone === "string")
      await adoptDeviceZone(u.id, zone.slice(0, 64));
    reply.header("Deprecation", `@${Math.floor(AGENDA_GET_DEPRECATED / 1000)}`);
    reply.header("Link", '</api/agenda/today>; rel="successor-version"');
    return (await writeTodaysAgenda(u.id)).doc;
  });

  /** A day for the agenda routes: "2026-09-24", or a 422 answer. */
  const dateParam = (r: { params: unknown }) => {
    const date = String((r.params as { date?: unknown }).date ?? "");
    if (!isDateKey(date)) fail(422, "That isn't a date like 2026-09-24.");
    return date;
  };

  /**
   * One day's agenda, for stepping back and forward from today's. It only
   * reads: a day's page is there only if it was written, and otherwise
   * `doc` is null and the app writes it (today's) or offers to (another
   * day's) with the POST below. Days more than a year back or two months
   * ahead are out of reach.
   */
  app.get("/agenda/:date", async (r) => {
    const u = await authenticate(r);
    const date = dateParam(r);
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
    const zone = (r.body as { timezone?: unknown } | null)?.timezone;
    if (typeof zone === "string")
      await adoptDeviceZone(u.id, zone.slice(0, 64));
    const made = await writeAgendaOn(u.id, date);
    if (made?.created) await syncSavedPages(made.doc.id);
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
          WHERE i.id = $2 AND ${visibleItems()}`,
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
    if (made.created) await syncSavedPages(made.doc.id);
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
    await syncSavedPages(id);
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
      return proposeChanges(db, id, u.id, changes, note);
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
    if (out) await syncSavedPages(id);
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
    const doc = await transaction((db) => trashDoc(db, u, id));
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
      await actAs(db, u.id);
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
    await syncSavedPages(id);
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
      await actAs(db, u.id);
      await requireDoc(db, id, u, "items:write", true);
      await db.query("DELETE FROM docs WHERE id = $1", [id]);
    });
    reply.code(204);
  });
}
