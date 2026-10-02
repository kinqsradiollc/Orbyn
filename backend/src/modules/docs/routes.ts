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
  blocksWithWebLinks,
  keepLinkLabels,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import {
  pool,
  reader,
  transaction,
  type Db,
  type Queryable,
} from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { contentDisposition } from "../../lib/disposition.js";
import { createMathHtml } from "../../lib/math-html.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { announceDocChange } from "./live.js";
import { docArchived } from "../../lib/doc-visibility.js";
import { linkPrivacy, readableLinks } from "../links/privacy.js";
import { carryRanges } from "./ranges.js";
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
  untrashDoc,
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
import {
  addComment,
  addPageTagNames,
  decideSuggestion,
  deleteComment,
  docPeople,
  docVersion,
  docVersions,
  listComments,
  listSuggestions,
  resolveComment,
  setPageTags,
  withdrawSuggestion,
} from "./comments.js";

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
            AND (($2::text IS NOT NULL AND d.kind = $2)
              OR ($2::text IS NULL AND d.kind NOT IN ('memory', 'agent')))
            AND ($3::uuid IS NULL OR d.project_id = $3)
            AND ($4::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM doc_tags dt
                   WHERE dt.doc_id = d.id AND dt.tag_id = $4))
            ${
              q.archived === "include"
                ? ""
                : q.archived === "only"
                  ? `AND ${docArchived("d")}`
                  : `AND NOT ${docArchived("d")}`
            }
          ORDER BY d.updated_at DESC
          LIMIT 200`,
        [u.id, q.kind ?? null, q.project ?? null, q.tag ?? null],
      )
    ).rows;
    // The preview is derived here so the list stays light on the wire,
    // from the words this reader may see of each page's links.
    const links = await linkPrivacy(
      reader(r.headers),
      u.id,
      rows.map((row) => row.content),
    );
    return rows.map(({ content, ...rest }) => ({
      ...rest,
      preview: docPreview(links.value(content ?? [])),
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
    return readableLinks(db, u.id, {
      ...doc,
      content: await withTaskState(db, id, doc.content ?? []),
    });
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
    // Ticks as the tasks stand, the same as the page reads, and links to
    // pages, tasks and projects as web links anyone with access can open.
    const blocks = blocksWithWebLinks(
      await readableLinks(
        reader(r.headers),
        u.id,
        await withTaskState(reader(r.headers), id, doc.content ?? []),
      ),
      env.APP_URL,
    );
    const body =
      format === "docx"
        ? docToDocx(title, blocks)
        : format === "pdf"
          ? docToPdf(title, blocks)
          : format === "html"
            ? docToHtml(title, blocks, { math: createMathHtml() })
            : format === "txt"
              ? docToText(title, blocks)
              : docToMarkdown(title, blocks);
    return (
      reply
        .type(`${EXPORT_LABELS[format].type}; charset=utf-8`)
        // The name is offered here so every client gets the same file name.
        // Written as RFC 5987 so a title holding an emoji or any non-Latin
        // letter can ride in the header without the server refusing it.
        .header(
          "content-disposition",
          contentDisposition("attachment", exportName(title, format)),
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
    const blocks = blocksWithWebLinks(
      await readableLinks(
        reader(r.headers),
        u.id,
        await withTaskState(reader(r.headers), id, doc.content ?? []),
      ),
      env.APP_URL,
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
    return docVersions(reader(r.headers), u.id, idParam(r));
  });

  /** One past state, with its content, to read or compare. */
  app.get("/docs/:id/versions/:version", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const n = Number((r.params as { version: string }).version);
    if (!Number.isInteger(n) || n < 1) fail(422, "Not a version");
    return docVersion(reader(r.headers), u.id, id, n);
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
    return readableLinks(db, u.id, answer);
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
      return readableLinks(pool, u.id, {
        ...existing,
        content: await withTaskState(pool, existing.id, existing.content ?? []),
      });

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
      doc: await readableLinks(pool, u.id, {
        ...updated,
        content: await withTaskState(pool, id, updated.content ?? []),
      }),
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
    const out = await transaction((db) => setPageTags(db, u, id, tags));
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
    const out = await transaction((db) => addPageTagNames(db, u, id, names));
    if (out.added.length) await announceTags(id, out.version, editorOf(r));
    return { tags: out.tags, added: out.added };
  });

  /** Everyone's remarks on a document, oldest first. */
  app.get("/docs/:id/comments", async (r) => {
    const u = await authenticate(r);
    return listComments(reader(r.headers), u.id, idParam(r));
  });

  /**
   * Who can be named in a comment here: the team, or just the author on a
   * personal page. The picker never offers someone who cannot read it.
   */
  app.get("/docs/:id/people", async (r) => {
    const u = await authenticate(r);
    return docPeople(reader(r.headers), u.id, idParam(r));
  });

  app.post("/docs/:id/comments", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const input = docCommentInput.parse(r.body);
    // Places and words come back as this reader is shown them (D3aF).
    const comment = await transaction((db) => addComment(db, u, id, input));
    reply.code(201);
    return comment;
  });

  /** Resolve a remark, or bring it back. */
  app.put("/docs/:id/comments/:commentId", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const commentId = String((r.params as { commentId: string }).commentId);
    const { resolved, expected_revision } = docCommentUpdate.parse(r.body);
    return transaction((db) =>
      resolveComment(db, u, id, commentId, resolved, expected_revision),
    );
  });

  /** Only the person who wrote a remark can take it back. */
  app.delete("/docs/:id/comments/:commentId", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const commentId = String((r.params as { commentId: string }).commentId);
    await transaction((db) => deleteComment(db, u, id, commentId));
    reply.code(204);
  });

  // --- Proposed changes --------------------------------------------------

  /** Every proposal on a page, oldest first. */
  app.get("/docs/:id/suggestions", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    return listSuggestions(reader(r.headers), u.id, id);
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
      // Places counted in the words the reader was shown, and the words of
      // links they were shown as "Private page" put back (D3aF).
      const placed = await carryRanges(db, u.id, id, changes, "stored");
      const stored = (
        await db.query<{ content: DocBlock[] | null }>(
          "SELECT content FROM docs WHERE id = $1",
          [id],
        )
      ).rows[0]?.content;
      const shownPrivate = stored
        ? (await linkPrivacy(db, u.id, stored)).hidden
        : () => false;
      return proposeChanges(
        db,
        id,
        u.id,
        placed.map((c) =>
          stored
            ? { ...c, text: keepLinkLabels(c.text, stored, shownPrivate) }
            : c,
        ),
        note,
      );
    });
    reply.code(201);
    return readableLinks(
      pool,
      u.id,
      await carryRanges(pool, u.id, id, made, "shown"),
    );
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
    const out = await transaction((db) =>
      decideSuggestion(db, u, id, sid, take),
    );
    if (out) await announceDocChange(pool, id, out.version, editorOf(r));
    if (out) await syncSavedPages(id);
    return { doc: out };
  });

  /** Take back a proposal you made. Only its author, and only while open. */
  app.delete("/docs/:id/suggestions/:sid", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const sid = String((r.params as { sid: string }).sid);
    await transaction((db) => withdrawSuggestion(db, u, id, sid));
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
    const links = await linkPrivacy(
      reader(r.headers),
      u.id,
      rows.map((row) => row.content),
    );
    return rows.map(({ content, ...rest }) => ({
      ...rest,
      preview: docPreview(links.value(content ?? [])),
    }));
  });

  /** Bring a page back from Trash, just as it was. */
  app.post("/docs/:id/restore", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const back = await transaction(async (db) => {
      await untrashDoc(db, u, id);
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
    return readableLinks(pool, u.id, back);
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
