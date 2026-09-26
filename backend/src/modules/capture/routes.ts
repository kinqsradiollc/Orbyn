import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import {
  addToAgendaNotes,
  captureBlocks,
  captureInput,
  capturePageTitle,
  captureTask,
  fail,
  itemData,
  linkPreviewInput,
  type Capture,
  type CaptureResult,
  type Item,
} from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { mutate } from "../items/service.js";
import { addToPage } from "../docs/routes.js";
import { todaysAgenda } from "../docs/agenda.js";
import { adoptDeviceZone } from "../planner/timezone.js";
import { linkPreview } from "./preview.js";
import { cachedSettings } from "../../lib/settings.js";
import { visibleFolders } from "../../lib/visibility.js";

/**
 * Sharing into Orbyn (the phone's share sheet): a link or some text, sent
 * where the person chose — an Inbox task "Read: <title>" with the link,
 * the end of today's agenda's Notes, the end of a page, a new page in a
 * folder, or a task in a project. Each lands in the person's own space or a
 * team's they may write in, by the same rules as making it by hand.
 */

/** A project the person may add a task to, locked; 404 or 403 otherwise. */
async function writableProject(db: Db, id: string, u: UserRow) {
  const row = (
    await db.query<{
      id: string;
      user_id: string;
      team_id: string | null;
      name: string;
    }>(
      "SELECT id, user_id, team_id, name FROM projects WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Project not found");
  if (row.team_id) await requireTeam(row.team_id, u, "items:write", db);
  else if (row.user_id !== u.id) fail(404, "Project not found");
  return row;
}

/** A folder the person can see, with the team it belongs to. */
async function visibleFolder(db: Db, id: string, u: UserRow) {
  const row = (
    await db.query<{ id: string; team_id: string | null; name: string }>(
      `SELECT f.id, f.team_id, f.name FROM folders f
        WHERE f.id = $2
          AND ${visibleFolders("f")}`,
      [u.id, id],
    )
  ).rows[0];
  if (!row) fail(404, "Folder not found");
  if (row.team_id) await requireTeam(row.team_id, u, "items:write", db);
  return row;
}

/** Make the task a share becomes: on its own, or in a project's first stage. */
async function shareTask(
  db: Db,
  u: UserRow,
  c: Capture,
  project: { id: string; team_id: string | null } | null,
): Promise<Item> {
  const fields = captureTask(c);
  // A project's task starts in its first stage, made there in one go so
  // its webhook, sync and version all say where it is.
  const stage = project
    ? ((
        await db.query<{ id: string }>(
          `SELECT id FROM project_stages WHERE project_id = $1
            ORDER BY position LIMIT 1`,
          [project.id],
        )
      ).rows[0]?.id ?? null)
    : null;
  const item = await mutate(
    db,
    u,
    {
      operation: "create",
      data: itemData.parse({
        title: fields.title,
        notes: fields.notes.slice(0, 10000),
        kind: "task",
        team_id: project?.team_id ?? null,
        ...(fields.links.length ? { links: fields.links } : {}),
      }),
    },
    undefined,
    project ? { place: { project_id: project.id, stage_id: stage } } : {},
  );
  if (!item) fail(500, "The task couldn't be made.");
  return item;
}

export async function captureRoutes(app: FastifyInstance) {
  /**
   * A link's title and site, looked up for the share sheet. Never fails on
   * the link itself (a site that doesn't answer has no title); it has its
   * own limit, since each call reaches out to the web.
   */
  app.post(
    "/capture/preview",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (r) => {
      await authenticate(r);
      const { url } = linkPreviewInput.parse(r.body ?? {});
      return linkPreview(url);
    },
  );

  /** Put something shared where the person chose. */
  // No more than the preview's limit (nor the site-wide one): a link sent
  // without its title is looked up here, which reaches out to the web the
  // same way.
  app.post(
    "/capture",
    {
      config: {
        rateLimit: {
          max: () => {
            const site = cachedSettings().rate_limit_per_minute;
            return Math.min(30, site > 0 ? site : 30);
          },
          timeWindow: "1 minute",
        },
      },
    },
    async (r, reply) => {
      const u = await authenticate(r);
      const body = captureInput.parse(r.body ?? {});
      const result = await capture(u, body);
      reply.code(201);
      return result;
    },
  );
}

/** Put a share where it was sent, and say where it went. */
async function capture(
  u: UserRow,
  body: z.output<typeof captureInput>,
): Promise<CaptureResult> {
  const url = body.url ?? null;
  // The title the app already fetched, or one looked up now.
  const title =
    body.title?.trim() || (url ? (await linkPreview(url)).title : null);
  const c: Capture = { url, title, text: body.text.trim() };
  const to = body.to;

  if (to.kind === "inbox" || to.kind === "project") {
    const made = await transaction(async (db) => {
      const project =
        to.kind === "project"
          ? await writableProject(db, to.project_id, u)
          : null;
      return { item: await shareTask(db, u, c, project), project };
    });
    return {
      to: to.kind,
      item: made.item,
      note: made.project
        ? `Added “${made.item.title}” to ${made.project.name}.`
        : `Added “${made.item.title}” to your tasks.`,
    };
  }

  if (to.kind === "agenda") {
    if (body.timezone) await adoptDeviceZone(u.id, body.timezone);
    const agenda = await todaysAgenda(u.id);
    const saved = await addToPage(u, agenda.id, (content) =>
      addToAgendaNotes(content, captureBlocks(c, true)),
    );
    return {
      to: "agenda",
      doc: { id: saved.id, title: saved.title },
      note: "Added to today’s agenda.",
    };
  }

  if (to.kind === "page") {
    const saved = await addToPage(u, to.doc_id, (content) => {
      // A page that is one empty line takes the share in its place.
      const blank =
        content.length === 1 &&
        content[0].type === "paragraph" &&
        !content[0].text.trim();
      return [...(blank ? [] : content), ...captureBlocks(c)];
    });
    return {
      to: "page",
      doc: { id: saved.id, title: saved.title },
      note: `Added to “${saved.title || "Untitled"}”.`,
    };
  }

  // A new page, in the folder's space (a team folder makes a team page).
  const made = await transaction(async (db) => {
    await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
    const folder = to.folder_id
      ? await visibleFolder(db, to.folder_id, u)
      : null;
    const doc = (
      await db.query<{ id: string; title: string }>(
        `INSERT INTO docs (user_id, team_id, title, kind, content, folder_id)
           VALUES ($1, $2, $3, 'doc', $4::jsonb, $5) RETURNING id, title`,
        [
          u.id,
          folder?.team_id ?? null,
          capturePageTitle(c),
          JSON.stringify(captureBlocks(c)),
          folder?.id ?? null,
        ],
      )
    ).rows[0];
    return { doc, folder };
  });
  return {
    to: "new_page",
    doc: made.doc,
    note: made.folder
      ? `Saved “${made.doc.title}” in ${made.folder.name}.`
      : `Saved “${made.doc.title}” as a new page.`,
  };
}
