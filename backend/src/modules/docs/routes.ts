import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  docCommentInput,
  maintainedPageRunDecision,
  docCommentUpdate,
  docInput,
  docListQuery,
  docPreview,
  docSuggestionInput,
  docToHtml,
  docHtmlPage,
  docContainersHtml,
  docContainersText,
  parseVersionedDocContent,
  docContainerBlocks,
  docContainerTaskBlocks,
  applyDocContainerTaskBlocks,
  projectDocContainers,
  serializeDocContainers,
  type DocContainerNode,
  docToMarkdown,
  docToText,
  docUpdate,
  docEditorUpdate,
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
  blocksWithExportLinks,
  keepLinkLabels,
  refFromUrl,
  parseObjectHref,
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
import { idParam, writeRateLimit } from "../../lib/params.js";
import {
  listMaintainedPageRuns,
  decideMaintainedPageRun,
} from "./maintenance-runs.js";
import { assistantPrincipal } from "../agents/assistant.js";
import {
  createMaintainedPageBinding,
  listMaintainedPageBindings,
  updateMaintainedPageBinding,
  deleteMaintainedPageBinding,
} from "./maintenance.js";
import { requireTeam } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { announceDocChange, announceCrdtUpdate } from "./live.js";
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
import { exportRenderedPdf, exportRenderedHtml } from "./pdf-client.js";
import { exportImages } from "./export-images.js";
import { claimToken } from "../imports/tokens.js";
import { visibleItems } from "../../lib/visibility.js";
import { docContentFormatsHeader } from "./content-routes.js";
import { readVersionedDoc } from "./content-format.js";
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
  app.get("/docs/:id/maintenance/runs", async (r, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = await authenticate(r);
    const id = idParam(r);
    return transaction((db) => listMaintainedPageRuns(db, user, id));
  });
  app.post(
    "/docs/:id/maintenance/runs/:runId/decision",
    writeRateLimit,
    async (r) => {
      const user = await authenticate(r);
      const id = idParam(r);
      const runId = idParam(r, "runId");
      const input = maintainedPageRunDecision.parse(r.body);
      const result = await transaction(async (db) => {
        const owned = await db.query(
          `SELECT 1 FROM assistant_page_runs r JOIN assistant_page_bindings b ON b.id=r.binding_id
        WHERE r.id=$1 AND r.user_id=$2 AND b.doc_id=$3`,
          [runId, user.id, id],
        );
        if (!owned.rowCount) fail(404, "Page run not found.");
        return decideMaintainedPageRun(
          db,
          user.id,
          runId,
          input.waiting_id,
          input.approved,
        );
      });
      if (result.state === "done") await syncSavedPages(result.doc.id);
      return { state: result.state };
    },
  );
  app.get("/docs/:id/maintenance", async (r) => {
    const user = await authenticate(r);
    const id = idParam(r);
    return transaction((db) => listMaintainedPageBindings(db, user, id));
  });
  app.post("/docs/:id/maintenance", writeRateLimit, async (r, reply) => {
    const user = await authenticate(r);
    const id = idParam(r);
    const principal = await assistantPrincipal(user);
    const binding = await transaction((db) =>
      createMaintainedPageBinding(db, user, principal, id, r.body),
    );
    return reply.code(201).send(binding);
  });
  app.put("/docs/:id/maintenance/:bindingId", writeRateLimit, async (r) => {
    const user = await authenticate(r);
    const id = idParam(r);
    const bindingId = idParam(r, "bindingId");
    const principal = await assistantPrincipal(user);
    return transaction((db) =>
      updateMaintainedPageBinding(db, user, principal, id, bindingId, r.body),
    );
  });
  app.delete("/docs/:id/maintenance/:bindingId", writeRateLimit, async (r) => {
    const user = await authenticate(r);
    const id = idParam(r);
    const bindingId = idParam(r, "bindingId");
    return transaction((db) =>
      deleteMaintainedPageBinding(db, user, id, bindingId, r.body),
    );
  });

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
    const raw = r.body as Record<string, unknown> | undefined;
    const structured = raw !== undefined && "document" in raw;
    const data = structured
      ? docInput.extend({ document: z.unknown() }).parse(raw)
      : docInput.parse(r.body ?? {});
    const document = structured
      ? parseVersionedDocContent(raw!.document, {
          projected: true,
        })
      : null;
    if (document && document.format !== 2)
      fail(400, "Structured creation requires a complete container tree.");
    if (document && data.kind !== "doc")
      fail(400, "Structured creation is available for pages.");
    if (
      document &&
      !docContentFormatsHeader(r.headers["x-orbyn-doc-formats"]).includes(2)
    )
      fail(409, "This client does not support nested document content.");
    if (structured && raw && "content" in raw)
      fail(400, "Specify one document content source.");
    const content = document
      ? docContainerBlocks(document.nodes, { projected: true })
      : data.content;
    const doc = await transaction((db) =>
      createDoc(
        db,
        u,
        { ...data, content },
        document?.format === 2 ? document : undefined,
      ),
    );
    await syncSavedPages(doc.id);
    reply.code(201);
    return document ? { ...doc, document } : doc;
  });

  app.get("/docs/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const declared = r.headers["x-orbyn-doc-formats"];
    const supported = docContentFormatsHeader(declared);
    // A capable editor gets ownership and metadata from one current row.
    const db = declared === undefined ? reader(r.headers) : pool;
    if (declared !== undefined) reply.header("Cache-Control", "no-store");
    const doc = (
      await db.query<Doc & { content_format: 1 | 2; content_nodes: unknown }>(
        `SELECT ${COLUMNS}, d.content, d.content_format, d.content_nodes, ${LINKED} FROM docs d ${JOINS}
          WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    if (!supported.includes(doc.content_format))
      fail(409, "Update this client before opening nested document content.");
    const { content_format, content_nodes, ...metadata } = doc;
    // Never send the unredacted stored tree through a metadata response.
    if (declared === undefined)
      return readableLinks(db, u.id, {
        ...metadata,
        content: await withTaskState(db, id, doc.content ?? []),
      });
    const stored = parseVersionedDocContent(
      content_format === 2
        ? { format: 2, nodes: content_nodes }
        : { format: 1, blocks: doc.content ?? [] },
    );
    const taskView =
      stored.format === 2
        ? docContainerTaskBlocks(stored.nodes, { projected: true })
        : stored.blocks;
    const state = await withTaskState(db, id, taskView);
    const privacy = await linkPrivacy(db, u.id, state);
    const visible = privacy.value(state);
    const document = parseVersionedDocContent(
      stored.format === 2
        ? {
            format: 2,
            nodes: applyDocContainerTaskBlocks(stored.nodes, visible, {
              projected: true,
            }),
          }
        : { format: 1, blocks: visible },
      { projected: true },
    );
    const content =
      document.format === 2
        ? docContainerBlocks(document.nodes, { projected: true })
        : document.blocks;
    const shownMetadata = await readableLinks(db, u.id, metadata);
    return { ...shownMetadata, content, document };
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
    const { format, version: expectedVersion } = z
      .object({
        format: z.enum(EXPORT_FORMATS).default("md"),
        version: z.coerce
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      })
      .strict()
      .parse(r.query ?? {});
    // File actions require current revisions and visibility even without a
    // client read-your-writes header; a replica can still hold the old page.
    const doc = (
      await pool.query<{
        title: string;
        content: DocBlock[];
        version: number;
        content_format: 1 | 2;
        content_nodes: unknown;
      }>(
        `SELECT d.title, d.content, d.version, d.content_format, d.content_nodes FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    if (expectedVersion !== undefined && doc.version !== expectedVersion)
      fail(409, "This page changed. Refresh it before exporting.");
    const title = doc.title || "Untitled";
    const structure =
      doc.content_format === 2
        ? parseVersionedDocContent({ format: 2, nodes: doc.content_nodes })
        : null;
    // Ticks as the tasks stand, the same as the page reads, and links to
    // pages, tasks and projects as web links anyone with access can open.
    const stateBlocks = await withTaskState(pool, id, doc.content ?? []);
    const privacy = await linkPrivacy(pool, u.id, stateBlocks);
    const blocks = blocksWithExportLinks(
      stateBlocks,
      env.APP_URL,
      privacy.hidden,
    );
    const nodes: DocContainerNode[] | null =
      structure?.format === 2
        ? projectDocContainers(structure.nodes, () => blocks, {
            projected: true,
          })
        : null;
    const imageFormat = format === "pdf" || format === "html";
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (imageFormat) {
      r.raw.once("aborted", abort);
      reply.raw.once("close", abort);
      if (r.raw.aborted || reply.raw.destroyed) abort();
    }
    try {
      const images = imageFormat
        ? await exportImages(pool, u.id, blocks, {
            baseUrl: env.FILES_URL,
            signal: controller.signal,
            readPath: (file) => {
              if (env.FILES_SECRET.length < 16)
                fail(503, "Picture export is not configured.");
              return `/files/r/${claimToken("page-read", {
                f: file,
                e: Math.floor(Date.now() / 1000) + 30,
              })}`;
            },
          })
        : undefined;
      const htmlOptions = {
        math: createMathHtml(),
        diagramSources: true,
        fileUrl: images?.fileUrl,
      };
      const html = imageFormat
        ? nodes
          ? docHtmlPage(
              title,
              docContainersHtml(nodes, {
                ...htmlOptions,
                projected: true,
                anchors: true,
              }),
            )
          : docToHtml(title, blocks, htmlOptions)
        : undefined;
      if (html && Buffer.byteLength(html) > 20 * 1024 * 1024)
        fail(413, "This document is too large to export.");
      const body =
        format === "docx"
          ? docToDocx(title, blocks, undefined, {
              ...(nodes ? { containers: nodes } : {}),
              linkUrl: (href) => {
                const ref = refFromUrl(href);
                if (ref && ref.kind !== "date" && privacy.hidden(ref))
                  return undefined;
                const native = parseObjectHref(href);
                if (!native)
                  return href.startsWith("/")
                    ? new URL(href, env.APP_URL).href
                    : href;
                if (native.kind === "person" || native.kind === "date")
                  return undefined;
                const kind = native.kind === "event" ? "task" : native.kind;
                return `${env.APP_URL.replace(/\/+$/, "")}/app/${kind}/${native.id}${native.block ? `#${native.block}` : ""}`;
              },
            })
          : format === "pdf"
            ? await exportRenderedPdf(html!, r, reply)
            : format === "html"
              ? await exportRenderedHtml(html!, r, reply)
              : format === "txt"
                ? nodes
                  ? docContainersText(title, nodes, { projected: true })
                  : docToText(title, blocks)
                : nodes
                  ? `# ${title}\n\n${serializeDocContainers(nodes, { projected: true })}\n`
                  : docToMarkdown(title, blocks);
      if (imageFormat) {
        const current = (
          await pool.query<{ version: number }>(
            `SELECT d.version FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
            [u.id, id],
          )
        ).rows[0];
        if (!current) fail(404, "Document not found");
        if (current.version !== doc.version)
          fail(409, "This page changed. Refresh it before exporting.");
      }
      await images?.revalidate();
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
    } finally {
      controller.abort();
      if (imageFormat) {
        r.raw.removeListener("aborted", abort);
        reply.raw.removeListener("close", abort);
      }
    }
  });

  app.get("/docs/:id/markdown", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const doc = (
      await pool.query<{
        title: string;
        content: DocBlock[];
        content_format: 1 | 2;
        content_nodes: unknown;
      }>(
        `SELECT d.title, d.content, d.content_format, d.content_nodes FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    const state = await withTaskState(pool, id, doc.content ?? []);
    const privacy = await linkPrivacy(pool, u.id, state);
    const blocks = blocksWithExportLinks(state, env.APP_URL, privacy.hidden);
    const stored =
      doc.content_format === 2
        ? parseVersionedDocContent({ format: 2, nodes: doc.content_nodes })
        : null;
    const source =
      stored?.format === 2
        ? serializeDocContainers(
            projectDocContainers(stored.nodes, () => blocks, {
              projected: true,
            }),
            { projected: true },
          )
        : serializeDoc(blocks);
    return reply
      .type("text/markdown; charset=utf-8")
      .send(`# ${doc.title}\n\n${source}`);
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

  app.put(
    "/docs/:id",
    {
      bodyLimit: 32_000_000,
      onRequest: async (r) => {
        await authenticate(r);
      },
    },
    async (r) => {
      const u = await authenticate(r);
      const id = idParam(r);
      const full =
        !!r.body &&
        typeof r.body === "object" &&
        Object.hasOwn(r.body, "document");
      const structured = full ? docEditorUpdate.parse(r.body) : undefined;
      const body = structured
        ? (({ document: _document, ...metadata }) => metadata)(structured)
        : docUpdate.parse(r.body);
      const supported = structured
        ? docContentFormatsHeader(r.headers["x-orbyn-doc-formats"])
        : undefined;
      const saved = await transaction(async (db) => {
        const saved = await saveDoc(db, u, id, body, {
          ticksFrom: ticksFrom(r, body.version),
          ...(structured && supported
            ? { structured: { document: structured.document, supported } }
            : {}),
        });
        if (!structured || !supported) return saved;
        const read = await readVersionedDoc(db, u, id, supported);
        return { ...saved, document: read.document };
      });
      // Announced after the transaction commits, so anyone who comes running
      // to re-read the document finds the new version already there.
      await announceDocChange(pool, id, saved.version, editorOf(r));
      // Study follows the page (its card lines, and who can read it).
      await syncSavedPages(id);
      return saved;
    },
  );

  /**
   * One batch of CRDT updates for a page (EDT-live). The bytes are opaque
   * here — the Yjs documents on each side make sense of them — so this only
   * checks the sender can write the page, keeps each batch to a sane size,
   * and files the updates in order. The NOTIFY that follows carries only
   * the page's id: readers SELECT what they have not seen, so the news can
   * stay small whatever the updates weigh.
   */
  app.post("/docs/:id/updates", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const batch = z
      .object({ updates: z.array(z.string().max(60_000)).max(64) })
      .strict()
      .parse(r.body ?? {});
    const editor = editorOf(r);
    // The write check happens under the transaction, against the row: a
    // page moved to Trash (or a share withdrawn) mid-batch is refused.
    await transaction(async (db) => {
      const owned = await requireDoc(db, id, u, "items:write");
      if (owned.content_format === 2)
        fail(
          409,
          "This page requires a collaboration client that supports nested content.",
        );
      for (const encoded of batch.updates)
        await db.query(
          `INSERT INTO doc_updates (doc_id, editor_id, update)
            VALUES ($1, $2, decode($3, 'base64'))`,
          [id, editor, encoded],
        );
    });
    await announceCrdtUpdate(pool, id, editor).catch(() => {});
    reply.code(204);
    return null;
  });

  /**
   * The CRDT updates a reader has not seen yet, oldest first, as base64.
   * Editors pull this when they open a page (everything since their last
   * `seq`) and after a stream hiccup; while the stream is healthy the SSE
   * channel delivers the same rows as they land.
   */
  app.get("/docs/:id/updates", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction((db) => requireDoc(db, id, u, "items:read"));
    const since = z
      .object({ since: z.coerce.number().int().min(0).default(0) })
      .parse(r.query ?? {});
    const rows = (
      await reader(r.headers).query<{ seq: string; update: Buffer }>(
        `SELECT seq, update FROM doc_updates
          WHERE doc_id = $2 AND seq > $1 ORDER BY seq LIMIT 500`,
        [since.since, id],
      )
    ).rows;
    return {
      updates: rows.map((row) => ({
        seq: Number(row.seq),
        update: row.update.toString("base64"),
      })),
    };
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
    return docVersion(
      reader(r.headers),
      u.id,
      id,
      n,
      docContentFormatsHeader(r.headers["x-orbyn-doc-formats"]),
    );
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
    const declared = r.headers["x-orbyn-doc-formats"];
    const supported = docContentFormatsHeader(declared);
    const restored = await transaction(async (db) => {
      const saved = await restoreDocVersion(db, u, id, n, supported);
      if (declared === undefined) return saved;
      const read = await readVersionedDoc(db, u, id, supported);
      return { ...saved, document: read.document };
    });
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
      const doc = await requireDoc(db, id, u, "items:write");
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
