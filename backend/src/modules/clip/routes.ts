import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  articleBlocks,
  CLIP_KEY_PREFIX,
  clipInput,
  clipKeyInput,
  clipSourceLine,
  clozeLine,
  dueWords,
  fail,
  htmlTitle,
  isTimeZone,
  itemData,
  paperLines,
  paperMeta,
  quoteLines,
  readImportDate,
  readingMinutes,
  withClozeLines,
  wordCount,
  type ClipDestinations,
  type ClipInput,
  type ClipKey,
  type ClipResult,
  type DocBlock,
} from "@orbyn/core";
import { pool, transaction, type Db } from "../../db/pool.js";
import {
  authenticate,
  DISABLED_MESSAGE,
  digest,
  type UserRow,
} from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { visibleFolders, visibleProjects } from "../../lib/visibility.js";
import { mutate } from "../items/service.js";
import { announceDocChange } from "../docs/live.js";
import { checkLinks, requireDoc, snapshot } from "../docs/service.js";
import { actAs } from "../../lib/actor.js";

/**
 * The Orbyn Clipper's side of the API (CAP-02, CAP-03, CAP-04).
 *
 * The extension signs in with a Clipper key (ocl_…), made in Settings by a
 * signed-in person and shown once. A Clipper key can do exactly two things:
 * list where a clip may go, and save a clip. Everywhere else it is refused
 * (see authenticate), so a key taken from a browser can't read pages, see
 * tasks or change the account. A signed-in session may clip too (the web
 * app's own "Clip a link").
 *
 * The page's HTML is cleaned here, not in the browser: only its readable
 * part is kept, as plain lines with web links, and anything that would link
 * to something inside Orbyn is written harmlessly.
 */

/** Keys one person may have. */
const KEY_LIMIT = 10;

const CLIP_LIMIT = {
  config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
};

/** The person behind a Clipper key or a session, or a 401/403. */
export async function clipUser(r: FastifyRequest): Promise<UserRow> {
  const token = r.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token?.startsWith(CLIP_KEY_PREFIX)) return authenticate(r);
  const u = (
    await pool.query<UserRow>(
      `SELECT u.* FROM users u JOIN clip_keys k ON k.user_id = u.id
        WHERE k.key_hash = $1`,
      [digest(token)],
    )
  ).rows[0];
  if (!u) fail(401, "This Clipper key isn't valid. Connect the Clipper again.");
  if (u.disabled) fail(403, DISABLED_MESSAGE);
  await pool.query(
    `UPDATE clip_keys SET last_used_at = now()
      WHERE key_hash = $1
        AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
    [digest(token)],
  );
  return u;
}

/** Where a new page or task goes: checked as if it were made in the app. */
async function place(db: Db, u: UserRow, c: ClipInput) {
  let teamId = c.team_id;
  // A folder or project decides the space when one is given.
  const owner = async (table: "folders" | "projects", id: string) =>
    (
      await db.query<{ team_id: string | null }>(
        `SELECT x.team_id FROM ${table} x WHERE x.id = $2 AND ${
          table === "folders" ? visibleFolders("x") : visibleProjects("x")
        }`,
        [u.id, id],
      )
    ).rows[0];
  if (c.folder_id) {
    const f = await owner("folders", c.folder_id);
    if (!f) fail(404, "Folder not found");
    teamId = f.team_id;
  }
  if (c.project_id) {
    const p = await owner("projects", c.project_id);
    if (!p) fail(404, "Project not found");
    if (c.folder_id && p.team_id !== teamId)
      fail(400, "The folder and the project are in different spaces.");
    teamId = p.team_id;
  }
  if (teamId) await requireTeam(teamId, u, "items:write", db);
  await checkLinks(db, u, teamId, {
    folder_id: c.folder_id,
    project_id: c.project_id,
  });
  return teamId;
}

/** A new page from a clip. */
async function newPage(
  db: Db,
  u: UserRow,
  c: ClipInput,
  title: string,
  content: DocBlock[],
): Promise<string> {
  const teamId = await place(db, u, c);
  await actAs(db, u.id);
  return (
    await db.query<{ id: string }>(
      `INSERT INTO docs (user_id, team_id, title, kind, content, folder_id, project_id)
         VALUES ($1,$2,$3,'doc',$4::jsonb,$5,$6) RETURNING id`,
      [
        u.id,
        teamId,
        title.slice(0, 200) || "Clipped page",
        JSON.stringify(content.slice(0, 2000)),
        c.folder_id,
        c.project_id,
      ],
    )
  ).rows[0].id;
}

/** Lines added to the end of a page someone can change: a new version. */
async function addToExisting(
  db: Db,
  u: UserRow,
  docId: string,
  change: (content: DocBlock[]) => DocBlock[],
): Promise<{ title: string; version: number; lines: number }> {
  await actAs(db, u.id);
  await requireDoc(db, docId, u, "items:write");
  const doc = (
    await db.query<{ title: string; content: DocBlock[] }>(
      "SELECT title, content FROM docs WHERE id = $1",
      [docId],
    )
  ).rows[0];
  const next = change(doc.content ?? []).slice(0, 2000);
  await snapshot(db, docId, u.id);
  const version = (
    await db.query<{ version: number }>(
      `UPDATE docs SET content = $2::jsonb, version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING version`,
      [docId, JSON.stringify(next)],
    )
  ).rows[0].version;
  return { title: doc.title, version, lines: next.length };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export async function clipRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------- keys ---

  app.get("/me/clip-keys", async (r): Promise<ClipKey[]> => {
    const u = await authenticate(r);
    return (
      await pool.query<ClipKey>(
        `SELECT id, name, hint, created_at, last_used_at FROM clip_keys
          WHERE user_id = $1 ORDER BY created_at DESC`,
        [u.id],
      )
    ).rows;
  });

  /** A new Clipper key, shown once. */
  app.post("/me/clip-keys", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const { name } = clipKeyInput.parse(r.body ?? {});
    const count = (
      await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM clip_keys WHERE user_id = $1",
        [u.id],
      )
    ).rows[0].n;
    if (count >= KEY_LIMIT)
      fail(409, `You can have ${KEY_LIMIT} Clipper keys. Remove one first.`);
    const key = `${CLIP_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
    const row = (
      await pool.query<ClipKey>(
        `INSERT INTO clip_keys (user_id, name, key_hash, hint)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, hint, created_at, last_used_at`,
        [u.id, name, digest(key), key.slice(-4)],
      )
    ).rows[0];
    await audit({
      actorId: u.id,
      action: "clip_key.created",
      targetType: "api_key",
      targetId: row.id,
      details: { user_id: u.id, kind: "clipper" },
    });
    reply.code(201);
    return { key, clip_key: row };
  });

  app.delete("/me/clip-keys/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const gone = (
      await pool.query("DELETE FROM clip_keys WHERE id = $1 AND user_id = $2", [
        id,
        u.id,
      ])
    ).rowCount;
    if (!gone) fail(404, "Key not found");
    await audit({
      actorId: u.id,
      action: "clip_key.deleted",
      targetType: "api_key",
      targetId: id,
      details: { user_id: u.id, kind: "clipper" },
    });
    reply.code(204);
  });

  // ------------------------------------------------------------ clips ---

  /** Where a clip may go: folders, projects, teams and pages of cards. */
  app.get(
    "/clips/destinations",
    CLIP_LIMIT,
    async (r): Promise<ClipDestinations> => {
      const u = await clipUser(r);
      const [folders, projects, teams, cards] = await Promise.all([
        pool.query<ClipDestinations["folders"][number]>(
          `SELECT f.id, f.name, f.team_id FROM folders f
            WHERE ${visibleFolders("f")} AND f.archived_at IS NULL
            ORDER BY f.team_id NULLS FIRST, f.position, lower(f.name) LIMIT 200`,
          [u.id],
        ),
        pool.query<ClipDestinations["projects"][number]>(
          `SELECT p.id, p.name, p.team_id FROM projects p
            WHERE ${visibleProjects("p")} AND p.status = 'active'
            ORDER BY p.updated_at DESC LIMIT 100`,
          [u.id],
        ),
        pool.query<ClipDestinations["teams"][number]>(
          `SELECT t.id, t.name FROM teams t
             JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
            WHERE m.role IN ('owner', 'admin', 'member')
            ORDER BY lower(t.name)`,
          [u.id],
        ),
        // Pages the person wrote with a Cards heading: where cards go.
        pool.query<ClipDestinations["card_pages"][number]>(
          `SELECT d.id, d.title FROM docs d
            WHERE d.user_id = $1 AND d.team_id IS NULL AND d.deleted_at IS NULL
              AND d.archived_at IS NULL
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(d.content) = 'array'
                         THEN d.content ELSE '[]'::jsonb END) b
                   WHERE b->>'type' = 'heading'
                     AND lower(btrim(b->>'text')) = 'cards')
            ORDER BY d.updated_at DESC LIMIT 20`,
          [u.id],
        ),
      ]);
      return {
        folders: folders.rows,
        projects: projects.rows,
        teams: teams.rows,
        card_pages: cards.rows,
      };
    },
  );

  /** Save a clip, or (dry run) say what would be saved. */
  app.post("/clips", CLIP_LIMIT, async (r, reply): Promise<ClipResult> => {
    const u = await clipUser(r);
    const c = clipInput.parse(r.body ?? {});
    const now = new Date();
    const zone = isTimeZone(c.time_zone) ? c.time_zone : "UTC";
    const html = c.html ?? "";
    const title =
      c.title ||
      (html ? htmlTitle(html) : "") ||
      hostOf(c.url) ||
      "Clipped page";
    const source = clipSourceLine(c.url, now, zone);
    const result: ClipResult = {
      type: c.type,
      made: null,
      title,
      lines: 0,
      reading_minutes: null,
      due_at: null,
      due_note: null,
      cards: 0,
      dry_run: c.dry_run,
    };

    // The readable part: the selection when there is one, else the article.
    const body = (): DocBlock[] =>
      c.selection
        ? c.selection
            .split(/\n{2,}/)
            .map((p) =>
              p
                .replace(/\s+/g, " ")
                .replace(/orbyn:\/\//gi, "orbyn: //")
                .trim(),
            )
            .filter(Boolean)
            .map((text): DocBlock => ({
              type: "paragraph",
              text: text.slice(0, 10000),
            }))
        : html
          ? articleBlocks(html, c.url)
          : [];

    if (c.type === "article" || c.type === "paper") {
      const lines = body();
      if (!lines.length)
        fail(422, "There's nothing readable on this page to clip.");
      const content = [
        source,
        ...(c.type === "paper" ? paperLines(paperMeta(html)) : []),
        ...lines,
      ];
      result.lines = content.length;
      result.reading_minutes = readingMinutes(wordCount(lines));
      if (c.dry_run) return result;
      const id = await transaction((db) => newPage(db, u, c, title, content));
      result.made = { kind: "doc", id, title };
    } else if (c.type === "highlights") {
      const asCards = c.highlights_as === "cards";
      const cards = asCards
        ? c.highlights.map(clozeLine).filter((l): l is string => !!l)
        : [];
      const quotes = asCards ? [] : quoteLines(c.highlights, c.url);
      if (asCards && !cards.length)
        fail(
          422,
          "None of the highlights has a word worth hiding. Choose one.",
        );
      result.cards = cards.length;
      result.lines = asCards ? cards.length : quotes.length;
      if (c.dry_run) return result;
      if (c.doc_id) {
        const saved = await transaction((db) =>
          addToExisting(db, u, c.doc_id!, (content) =>
            asCards
              ? withClozeLines(content, cards)
              : [...content, source, ...quotes],
          ),
        );
        await announceDocChange(pool, c.doc_id, saved.version, "clipper").catch(
          () => {},
        );
        result.made = { kind: "doc", id: c.doc_id, title: saved.title };
        result.lines = saved.lines;
      } else {
        const pageTitle = `${asCards ? "Cards" : "Highlights"}: ${title}`.slice(
          0,
          200,
        );
        const content = asCards
          ? withClozeLines([source], cards)
          : [source, ...quotes];
        const id = await transaction((db) =>
          newPage(db, u, c, pageTitle, content),
        );
        result.made = { kind: "doc", id, title: pageTitle };
      }
    } else {
      // A task: an assignment, or something to read later.
      const words = wordCount(body());
      result.reading_minutes = words ? readingMinutes(words) : null;
      if (c.type === "assignment") {
        if (c.due_at !== undefined) result.due_at = c.due_at;
        else {
          const said = dueWords(
            `${c.selection ?? ""}\n${body()
              .map((b) => ("text" in b ? b.text : ""))
              .join("\n")}`,
          );
          const read = said ? readImportDate(said, zone, { now }) : null;
          result.due_at = read?.due_at ?? null;
          result.due_note = said
            ? read?.due_at
              ? null
              : `The page says "${said.slice(0, 60)}", which isn't a full date. Set the deadline yourself.`
            : "The page doesn't say when it's due. Set the deadline yourself.";
        }
      }
      if (c.dry_run) return result;
      const taskTitle = (
        c.type === "read_later" ? `Read: ${title}` : title
      ).slice(0, 200);
      const notes = [
        `${c.type === "read_later" ? "To read" : "Assignment"}: ${c.url}`,
        result.reading_minutes
          ? `About ${result.reading_minutes} min to read.`
          : "",
        c.selection ? `\n${c.selection.slice(0, 4000)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const item = await transaction(async (db) => {
        const teamId = await place(db, u, { ...c, folder_id: null });
        const made = await mutate(db, u, {
          operation: "create",
          data: itemData.parse({
            title: taskTitle,
            notes,
            due_at: result.due_at,
            team_id: teamId,
            ...(c.type === "read_later" && result.reading_minutes
              ? { estimate_minutes: result.reading_minutes }
              : {}),
          }),
        });
        if (made && c.project_id) {
          const stage = (
            await db.query<{ id: string }>(
              `SELECT id FROM project_stages WHERE project_id = $1
                ORDER BY position LIMIT 1`,
              [c.project_id],
            )
          ).rows[0]?.id;
          await db.query(
            "UPDATE items SET project_id = $2, stage_id = $3 WHERE id = $1",
            [made.id, c.project_id, stage ?? null],
          );
        }
        return made;
      });
      if (item) result.made = { kind: "task", id: item.id, title: taskTitle };
    }
    reply.code(201);
    return result;
  });
}
