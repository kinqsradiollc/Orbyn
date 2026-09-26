import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import argon2 from "argon2";
import katex from "katex";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  blocksHtml,
  cardDescription,
  docOutline,
  docPlainText,
  fail,
  parseObjectHref,
  publishedFolderHtml,
  publishedLockHtml,
  publishedMissingHtml,
  publishedPageHtml,
  publishInput,
  publishSlug,
  webDescriptionInput,
  type DocBlock,
  type PageFile,
  type PublishedInfo,
  type PublishState,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, reader, type Db } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authenticate } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { privacyFrom } from "../links/privacy.js";
import { PAGE_FILE_COLUMNS, readLink } from "../page-files/routes.js";
import { importsEnabled } from "../imports/tokens.js";

/**
 * Publishing a page or a folder to the web (SHR-05, SHR-06).
 *
 * Signed-in routes turn it on, change it and take it off; the public ones
 * write the page at /p/<slug> as plain HTML. Everything a reader sees is
 * checked when it is read: the row still there (Unpublish deletes it), the
 * team still allowing it, the page not in Trash, the password if there is
 * one. Nothing is cached, so taking a page off the web works at once.
 */

type Row = {
  id: string;
  doc_id: string | null;
  folder_id: string | null;
  slug: string;
  noindex: boolean;
  description: string;
  password_hash: string | null;
  views: number;
  created_at: Date;
  updated_at: Date;
};

const info = (r: Row): PublishedInfo => ({
  id: r.id,
  kind: r.doc_id ? "page" : "folder",
  slug: r.slug,
  path: `/p/${r.slug}`,
  noindex: r.noindex,
  description: r.description,
  has_password: !!r.password_hash,
  views: Number(r.views),
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

const ROW = `pp.id, pp.doc_id, pp.folder_id, pp.slug, pp.noindex, pp.description,
  pp.password_hash, pp.views, pp.created_at, pp.updated_at`;

type Owner = {
  user_id: string;
  team_id: string | null;
  title: string;
  allowed: boolean;
};

/** A page or folder you can see, with whether its team allows publishing. */
async function ownerOf(
  db: Db | typeof pool,
  kind: "doc" | "folder",
  id: string,
  userId: string,
): Promise<Owner> {
  const table = kind === "doc" ? "docs" : "folders";
  const title = kind === "doc" ? "x.title" : "x.name";
  const trash = kind === "doc" ? "AND x.deleted_at IS NULL" : "";
  const row = (
    await db.query<Owner>(
      `SELECT x.user_id, x.team_id, ${title} AS title,
              coalesce(t.publishing_allowed, true) AS allowed
         FROM ${table} x LEFT JOIN teams t ON t.id = x.team_id
        WHERE x.id = $2 ${trash}
          AND ((x.team_id IS NULL AND x.user_id = $1)
            OR x.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`,
      [userId, id],
    )
  ).rows[0];
  if (!row) fail(404, kind === "doc" ? "Page not found" : "Folder not found");
  return row;
}

/** Whether this person may put it on the web or take it off, and why not. */
async function mayPublish(
  owner: Owner,
  u: Awaited<ReturnType<typeof authenticate>>,
): Promise<string | null> {
  if (owner.team_id) {
    try {
      await requireTeam(owner.team_id, u, "items:write");
    } catch {
      return "Only people who can change this team's pages can publish them.";
    }
    if (!owner.allowed)
      return "Publishing is switched off for this team. An owner or admin can switch it on in the team's settings.";
  } else if (owner.user_id !== u.id) return "Only its owner can publish it.";
  return null;
}

async function freeSlug(db: Db | typeof pool, wanted: string, taken?: string) {
  let slug = wanted;
  for (let n = 2; n < 50; n++) {
    const clash = (
      await db.query(
        "SELECT 1 FROM published_pages WHERE slug = $1 AND id IS DISTINCT FROM $2",
        [slug, taken ?? null],
      )
    ).rows.length;
    if (!clash) return slug;
    slug = `${wanted.slice(0, 76)}-${n}`;
  }
  fail(409, "That address is taken. Try another.");
}

/** The cookie that says this browser typed the password (a hash of its hash). */
const unlockValue = (row: Pick<Row, "id" | "password_hash">) =>
  createHash("sha256")
    .update(`${row.id}:${row.password_hash ?? ""}`)
    .digest("base64url");
const cookieName = (row: Pick<Row, "id">) =>
  `orbyn_pub_${row.id.replace(/-/g, "").slice(0, 16)}`;

function unlocked(r: FastifyRequest, row: Row) {
  if (!row.password_hash) return true;
  const header = r.headers.cookie ?? "";
  const want = `${cookieName(row)}=`;
  const found = header
    .split(/;\s*/)
    .find((c) => c.startsWith(want))
    ?.slice(want.length);
  if (!found) return false;
  const a = Buffer.from(found);
  const b = Buffer.from(unlockValue(row));
  return a.length === b.length && timingSafeEqual(a, b);
}

const SECURITY = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  // Plain HTML: no script at all, pictures from this site only, forms only
  // back here (the password), never framed.
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const send = (
  reply: FastifyReply,
  status: number,
  html: string,
  noindex = true,
) =>
  reply
    .code(status)
    .headers({
      ...SECURITY,
      ...(noindex ? { "x-robots-tag": "noindex, nofollow" } : {}),
    })
    .send(html);

const origin = () => env.APP_URL.replace(/\/+$/, "");

/** The published row at a slug, if its team still allows it. */
async function rowAt(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) return null;
  return (
    (
      await pool.query<Row & { team_ok: boolean }>(
        `SELECT ${ROW},
              coalesce(t.publishing_allowed, true) AS team_ok
         FROM published_pages pp
         LEFT JOIN docs d ON d.id = pp.doc_id
         LEFT JOIN folders f ON f.id = pp.folder_id
         LEFT JOIN teams t ON t.id = coalesce(d.team_id, f.team_id)
        WHERE pp.slug = $1
          AND (pp.doc_id IS NULL OR d.deleted_at IS NULL)`,
        [slug],
      )
    ).rows.find((r) => r.team_ok) ?? null
  );
}

type PublicDoc = {
  id: string;
  title: string;
  content: DocBlock[];
  updated_at: Date;
  web_description: string;
  folder_id: string | null;
  team_id: string | null;
};

/**
 * Where each linked page can be read on the web, for the pages a page links
 * to: its own address, or its folder's. A page that isn't published loses
 * its link, and its words read "Private page" (see visitorView).
 */
async function publicPaths(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = (
    await pool.query<{ id: string; path: string }>(
      `SELECT d.id,
              CASE WHEN pp.id IS NOT NULL THEN '/p/' || pp.slug
                   ELSE '/p/' || fp.slug || '/' || d.id END AS path
         FROM docs d
         LEFT JOIN teams t ON t.id = d.team_id
         LEFT JOIN published_pages pp ON pp.doc_id = d.id
         LEFT JOIN folders f ON f.id = d.folder_id
              AND f.team_id IS NOT DISTINCT FROM d.team_id
         LEFT JOIN published_pages fp ON fp.folder_id = f.id
        WHERE d.id = ANY($1::uuid[]) AND d.deleted_at IS NULL
          AND coalesce(t.publishing_allowed, true)
          AND (pp.id IS NOT NULL OR fp.id IS NOT NULL)`,
      [ids],
    )
  ).rows;
  return new Map(rows.map((r) => [r.id, r.path]));
}

const linkedIds = (blocks: DocBlock[]) => {
  const ids = new Set<string>();
  for (const b of blocks) {
    const text = "text" in b ? String(b.text) : "";
    for (const m of text.matchAll(/\((orbyn:\/\/doc\/[^)\s]+)\)/g)) {
      const ref = parseObjectHref(m[1]);
      if (ref?.kind === "doc") ids.add(ref.id);
    }
  }
  return [...ids];
};

/** What a visitor may read of links: pages published at `paths` only. */
const visitorView = (paths: Map<string, string>) =>
  privacyFrom((ref) => !(ref.kind === "doc" && paths.has(ref.id)));

/** A page's pictures, as links a reader can load for the next hour. */
async function pictures(docId: string): Promise<Map<string, string>> {
  if (!importsEnabled()) return new Map();
  const files = (
    await pool.query<PageFile>(
      `SELECT ${PAGE_FILE_COLUMNS} FROM page_files f
         JOIN page_file_refs r ON r.file_id = f.id
        WHERE r.doc_id = $1 AND f.status = 'ready'`,
      [docId],
    )
  ).rows;
  return new Map(
    files.map((f) => [
      f.id,
      `/api${readLink({ ...f, bytes: Number(f.bytes) }).url_path}`,
    ]),
  );
}

async function renderPage(
  doc: PublicDoc,
  row: Row,
  path: string,
  folder: {
    name: string;
    href: string;
    pages: { id: string; title: string }[];
  } | null,
) {
  const links = await publicPaths(linkedIds(doc.content));
  // A visitor can open only published pages: every other link's words are
  // hidden, so a private title never reaches the web (D3aF).
  const content = visitorView(links).value(doc.content);
  const files = await pictures(doc.id);
  const bodyHtml = blocksHtml(content, {
    anchors: true,
    math: typeset,
    fileUrl: (id) => files.get(id) ?? null,
    linkUrl: (href) => {
      const ref = parseObjectHref(href);
      if (!ref) return /^https?:\/\//i.test(href) ? href : null;
      if (ref.kind !== "doc") return null;
      const at = links.get(ref.id);
      return at ?? null;
    },
  });
  // Published pages that link here.
  const here = (
    await pool.query<{ id: string; title: string }>(
      `SELECT DISTINCT d.id, d.title FROM object_links l
         JOIN docs d ON d.id = l.source_id
        WHERE l.target_kind = 'doc' AND l.target_id = $1::text
          AND l.source_kind = 'doc' AND l.link_kind = 'link'
          AND d.deleted_at IS NULL AND d.id <> $1::uuid
        LIMIT 50`,
      [doc.id],
    )
  ).rows;
  const herePaths = await publicPaths(here.map((h) => h.id));
  const firstPicture = content.find(
    (b): b is Extract<DocBlock, { type: "image" }> => b.type === "image",
  );
  const image = firstPicture ? files.get(firstPicture.file) : undefined;
  return publishedPageHtml({
    title: doc.title,
    bodyHtml,
    description:
      doc.web_description ||
      (row.doc_id ? row.description : "") ||
      cardDescription(docPlainText(content)),
    url: `${origin()}${path}`,
    image: image ? `${origin()}${image}` : null,
    noindex: row.noindex,
    updatedAt: doc.updated_at.toISOString(),
    contents: docOutline(content),
    linkedHere: here
      .filter((h) => herePaths.has(h.id))
      .map((h) => ({
        title: h.title || "Untitled",
        href: herePaths.get(h.id)!,
      })),
    folder: folder
      ? {
          name: folder.name,
          href: folder.href,
          pages: folder.pages.map((p) => ({
            title: p.title || "Untitled",
            href: `${folder.href}/${p.id}`,
            here: p.id === doc.id,
          })),
        }
      : null,
  });
}

/**
 * Maths on a published page, as MathML: browsers draw it themselves, so
 * the page needs no script, stylesheet or font from anywhere.
 */
function typeset(tex: string, display: boolean): string | null {
  try {
    const html = katex.renderToString(tex, {
      output: "mathml",
      displayMode: display,
      throwOnError: false,
      trust: false,
      maxSize: 20,
      maxExpand: 200,
    });
    return display ? `<div class="math">${html}</div>` : html;
  } catch {
    return null;
  }
}

const DOC_COLUMNS = `d.id, d.title, d.content, d.updated_at, d.web_description,
  d.folder_id, d.team_id`;

async function folderPages(folderId: string, teamId: string | null) {
  return (
    await pool.query<{
      id: string;
      title: string;
      web_description: string;
      content: DocBlock[];
    }>(
      `SELECT d.id, d.title, d.web_description, d.content FROM docs d
        WHERE d.folder_id = $1 AND d.deleted_at IS NULL
          AND d.team_id IS NOT DISTINCT FROM $2 AND d.kind <> 'agenda'
        ORDER BY d.updated_at DESC LIMIT 500`,
      [folderId, teamId],
    )
  ).rows;
}

export async function publishRoutes(app: FastifyInstance) {
  // The password form posts like any web form.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 4_096 },
    (_req, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  // ------------------------------------------------------------ signed in

  const state = async (
    kind: "doc" | "folder",
    id: string,
    u: Awaited<ReturnType<typeof authenticate>>,
    db: Db | typeof pool = pool,
  ): Promise<PublishState> => {
    const owner = await ownerOf(db, kind, id, u.id);
    const column = kind === "doc" ? "doc_id" : "folder_id";
    const own = (
      await db.query<Row>(
        `SELECT ${ROW} FROM published_pages pp WHERE pp.${column} = $1`,
        [id],
      )
    ).rows[0];
    let viaFolder: PublishState["via_folder"] = null;
    let description = "";
    if (kind === "doc") {
      const d = (
        await db.query<{ folder_id: string | null; web_description: string }>(
          "SELECT folder_id, web_description FROM docs WHERE id = $1",
          [id],
        )
      ).rows[0];
      description = d?.web_description ?? "";
      if (d?.folder_id) {
        const f = (
          await db.query<Row & { folder_name: string }>(
            `SELECT ${ROW}, f.name AS folder_name FROM published_pages pp
               JOIN folders f ON f.id = pp.folder_id
              WHERE pp.folder_id = $1 AND f.team_id IS NOT DISTINCT FROM $2`,
            [d.folder_id, owner.team_id],
          )
        ).rows[0];
        if (f)
          viaFolder = {
            ...info(f),
            folder_name: f.folder_name,
            path: `/p/${f.slug}/${id}`,
          };
      }
    }
    const reason = await mayPublish(owner, u);
    return {
      published: own ? info(own) : null,
      via_folder: owner.allowed ? viaFolder : null,
      can_publish: !reason,
      reason,
      web_description: description,
    };
  };

  for (const kind of ["doc", "folder"] as const) {
    const base = kind === "doc" ? "/docs/:id/publish" : "/folders/:id/publish";
    const column = kind === "doc" ? "doc_id" : "folder_id";

    app.get(base, async (r) => {
      const u = await authenticate(r);
      return state(kind, idParam(r), u, reader(r.headers));
    });

    // Publish, or change how it is published.
    app.put(base, strictRateLimit, async (r) => {
      const u = await authenticate(r);
      const id = idParam(r);
      const d = publishInput.parse(r.body ?? {});
      const owner = await ownerOf(pool, kind, id, u.id);
      const reason = await mayPublish(owner, u);
      if (reason) fail(403, reason);
      const existing = (
        await pool.query<Row>(
          `SELECT ${ROW} FROM published_pages pp WHERE pp.${column} = $1`,
          [id],
        )
      ).rows[0];
      const slug = await freeSlug(
        pool,
        d.slug ?? existing?.slug ?? publishSlug(owner.title, id),
        existing?.id,
      );
      const hash =
        d.password === undefined
          ? (existing?.password_hash ?? null)
          : d.password === null
            ? null
            : await argon2.hash(d.password);
      const row = (
        await pool.query<Row>(
          `INSERT INTO published_pages AS pp (${column}, slug, published_by, noindex, description, password_hash)
             VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (${column}) DO UPDATE
             SET slug = excluded.slug, noindex = excluded.noindex,
                 description = excluded.description,
                 password_hash = excluded.password_hash, updated_at = now()
           RETURNING ${ROW}`,
          [id, slug, u.id, d.noindex, d.description, hash],
        )
      ).rows[0];
      if (!existing)
        await audit({
          actorId: u.id,
          action: "page.published",
          targetType: kind === "doc" ? "page" : "folder",
          targetId: id,
          details: { slug },
        });
      return state(kind, id, u);
    });

    // Unpublish: the address stops working at once.
    app.delete(base, async (r) => {
      const u = await authenticate(r);
      const id = idParam(r);
      const owner = await ownerOf(pool, kind, id, u.id);
      // Anyone who may change it may take it off, even with publishing off.
      if (owner.team_id) await requireTeam(owner.team_id, u, "items:write");
      else if (owner.user_id !== u.id)
        fail(403, "Only its owner can unpublish it.");
      const gone = await pool.query(
        `DELETE FROM published_pages WHERE ${column} = $1`,
        [id],
      );
      if (gone.rowCount)
        await audit({
          actorId: u.id,
          action: "page.unpublished",
          targetType: kind === "doc" ? "page" : "folder",
          targetId: id,
          details: {},
        });
      return state(kind, id, u);
    });
  }

  // A page's own description for its card, published alone or in a folder.
  app.put("/docs/:id/web-description", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = webDescriptionInput.parse(r.body ?? {});
    const owner = await ownerOf(pool, "doc", id, u.id);
    if (owner.team_id) await requireTeam(owner.team_id, u, "items:write");
    else if (owner.user_id !== u.id) fail(403, "Only its owner can change it.");
    await pool.query("UPDATE docs SET web_description = $2 WHERE id = $1", [
      id,
      d.description,
    ]);
    return state("doc", id, u);
  });

  // The team switch: owners and admins can turn publishing off for the team.
  app.get("/teams/:id/publishing", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { effective } = await requireTeam(id, u, "items:read");
    const row = (
      await pool.query<{ allowed: boolean; published: string }>(
        `SELECT t.publishing_allowed AS allowed,
                (SELECT count(*) FROM published_pages pp
                   LEFT JOIN docs d ON d.id = pp.doc_id
                   LEFT JOIN folders f ON f.id = pp.folder_id
                  WHERE coalesce(d.team_id, f.team_id) = t.id) AS published
           FROM teams t WHERE t.id = $1`,
        [id],
      )
    ).rows[0];
    return {
      allowed: row.allowed,
      published: Number(row.published),
      can_change: effective === "owner" || effective === "admin",
    };
  });

  app.put("/teams/:id/publishing", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = z.object({ allowed: z.boolean() }).parse(r.body ?? {});
    await requireTeam(id, u, "team:update");
    await pool.query("UPDATE teams SET publishing_allowed = $2 WHERE id = $1", [
      id,
      d.allowed,
    ]);
    await audit({
      actorId: u.id,
      action: d.allowed ? "team.publishing_on" : "team.publishing_off",
      targetType: "team",
      targetId: id,
      details: {},
    });
    const published = (
      await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM published_pages pp
           LEFT JOIN docs d ON d.id = pp.doc_id
           LEFT JOIN folders f ON f.id = pp.folder_id
          WHERE coalesce(d.team_id, f.team_id) = $1`,
        [id],
      )
    ).rows[0];
    return {
      allowed: d.allowed,
      published: Number(published.n),
      can_change: true,
    };
  });

  // --------------------------------------------------------------- public

  const lockOr = async (
    r: FastifyRequest,
    reply: FastifyReply,
    row: Row,
    title: string,
    action: string,
  ) => {
    if (unlocked(r, row)) return false;
    await send(reply, 401, publishedLockHtml({ title, action, wrong: false }));
    return true;
  };

  app.get("/p/:slug", async (r, reply) => {
    const slug = String((r.params as { slug: string }).slug).toLowerCase();
    const row = await rowAt(slug);
    if (!row) return send(reply, 404, publishedMissingHtml());
    const path = `/p/${row.slug}`;
    if (row.doc_id) {
      const doc = (
        await pool.query<PublicDoc>(
          `SELECT ${DOC_COLUMNS} FROM docs d WHERE d.id = $1`,
          [row.doc_id],
        )
      ).rows[0];
      if (!doc) return send(reply, 404, publishedMissingHtml());
      if (
        await lockOr(r, reply, row, doc.title || "Untitled", `${path}/unlock`)
      )
        return reply;
      await pool.query(
        "UPDATE published_pages SET views = views + 1 WHERE id = $1",
        [row.id],
      );
      return send(
        reply,
        200,
        await renderPage(doc, row, path, null),
        row.noindex,
      );
    }
    const folder = (
      await pool.query<{ name: string; team_id: string | null }>(
        "SELECT name, team_id FROM folders WHERE id = $1",
        [row.folder_id],
      )
    ).rows[0];
    if (!folder) return send(reply, 404, publishedMissingHtml());
    if (await lockOr(r, reply, row, folder.name, `${path}/unlock`))
      return reply;
    await pool.query(
      "UPDATE published_pages SET views = views + 1 WHERE id = $1",
      [row.id],
    );
    const pages = await folderPages(row.folder_id!, folder.team_id);
    const visitor = visitorView(
      await publicPaths(pages.flatMap((p) => linkedIds(p.content))),
    );
    return send(
      reply,
      200,
      publishedFolderHtml({
        name: folder.name,
        description: row.description,
        url: `${origin()}${path}`,
        noindex: row.noindex,
        pages: pages.map((p) => ({
          title: p.title,
          href: `${path}/${p.id}`,
          description:
            p.web_description ||
            cardDescription(docPlainText(visitor.value(p.content)), 120),
        })),
      }),
      row.noindex,
    );
  });

  app.get("/p/:slug/:doc", async (r, reply) => {
    const params = r.params as { slug: string; doc: string };
    const row = await rowAt(String(params.slug).toLowerCase());
    const docId = z.uuid().safeParse(params.doc);
    if (!row || !row.folder_id || !docId.success)
      return send(reply, 404, publishedMissingHtml());
    const folder = (
      await pool.query<{ name: string; team_id: string | null }>(
        "SELECT name, team_id FROM folders WHERE id = $1",
        [row.folder_id],
      )
    ).rows[0];
    const doc = (
      await pool.query<PublicDoc>(
        `SELECT ${DOC_COLUMNS} FROM docs d
          WHERE d.id = $1 AND d.folder_id = $2 AND d.deleted_at IS NULL
            AND d.kind <> 'agenda' AND d.team_id IS NOT DISTINCT FROM $3`,
        [docId.data, row.folder_id, folder?.team_id ?? null],
      )
    ).rows[0];
    if (!folder || !doc) return send(reply, 404, publishedMissingHtml());
    const base = `/p/${row.slug}`;
    if (await lockOr(r, reply, row, folder.name, `${base}/unlock`))
      return reply;
    await pool.query(
      "UPDATE published_pages SET views = views + 1 WHERE id = $1",
      [row.id],
    );
    const pages = await folderPages(row.folder_id, folder.team_id);
    return send(
      reply,
      200,
      await renderPage(doc, row, `${base}/${doc.id}`, {
        name: folder.name,
        href: base,
        pages: pages.map((p) => ({ id: p.id, title: p.title })),
      }),
      row.noindex,
    );
  });

  // The password form. Right: a cookie for this page and back to it.
  app.post("/p/:slug/unlock", strictRateLimit, async (r, reply) => {
    const slug = String((r.params as { slug: string }).slug).toLowerCase();
    const row = await rowAt(slug);
    if (!row) return send(reply, 404, publishedMissingHtml());
    const path = `/p/${row.slug}`;
    const password = String(
      (r.body as { password?: unknown } | null)?.password ?? "",
    );
    const ok =
      !row.password_hash ||
      (password.length > 0 &&
        password.length <= 200 &&
        (await argon2.verify(row.password_hash, password).catch(() => false)));
    if (!ok) {
      const title = row.doc_id
        ? ((
            await pool.query<{ title: string }>(
              "SELECT title FROM docs WHERE id = $1",
              [row.doc_id],
            )
          ).rows[0]?.title ?? "")
        : ((
            await pool.query<{ name: string }>(
              "SELECT name FROM folders WHERE id = $1",
              [row.folder_id],
            )
          ).rows[0]?.name ?? "");
      return send(
        reply,
        401,
        publishedLockHtml({
          title: title || "Untitled",
          action: `${path}/unlock`,
          wrong: true,
        }),
      );
    }
    const secure = /^https:/i.test(env.APP_URL) ? "; Secure" : "";
    return reply
      .code(303)
      .headers({
        "cache-control": "no-store",
        "set-cookie": `${cookieName(row)}=${unlockValue(row)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
        location: path,
      })
      .send();
  });
}
