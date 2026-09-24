import type { FastifyInstance } from "fastify";
import {
  blankDate,
  fail,
  fillTemplate,
  PAGE_TEMPLATE_STARTERS,
  pageTemplateFromDoc,
  pageTemplateInput,
  pageTemplateUpdate,
  pageTemplateUse,
  templateFromPage,
  type Doc,
  type DocBlock,
  type DocTag,
  type PageTemplate,
  type TeamRole,
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
import { loadPrefs } from "../planner/calendar.js";
import {
  COLUMNS as DOC_COLUMNS,
  JOINS as DOC_JOINS,
  makeLineTasks,
  pageTags,
} from "../docs/routes.js";

/**
 * Page templates (DAY-02): the starters everyone has, your own, and your
 * teams'. They work the way project templates do — starters served from
 * code, saved ones personal or a team's, only their maker (or a team's
 * owners and admins) may change them — except that any member who can
 * write a team's pages can save one for the team, since a page template
 * starts a page, not a project.
 */

type Row = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  description: string;
  title: string;
  content: DocBlock[];
  folder_id: string | null;
  folder_name: string | null;
  tags: DocTag[];
  created_at: Date;
  my_role: TeamRole | null;
};

const COLUMNS = `t.id, t.user_id, t.team_id, tm.name AS team_name, t.name,
  t.description, t.title, t.content, t.folder_id, f.name AS folder_name,
  t.created_at,
  (SELECT m.role FROM team_members m
    WHERE m.team_id = t.team_id AND m.user_id = $1) AS my_role,
  coalesce((SELECT json_agg(json_build_object('id', g.id, 'name', g.name,
                                              'color', g.color)
                         ORDER BY lower(g.name), g.name)
              FROM page_template_tags pt JOIN tags g ON g.id = pt.tag_id
             WHERE pt.template_id = t.id), '[]'::json) AS tags`;

const JOINS = `LEFT JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN folders f ON f.id = t.folder_id`;

/** Templates `$1` can see: their own, and their teams'. */
const VISIBLE = `((t.team_id IS NULL AND t.user_id = $1)
  OR t.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

function toTemplate(u: UserRow, r: Row): PageTemplate {
  return {
    id: r.id,
    source: r.team_id ? "team" : "personal",
    name: r.name,
    description: r.description,
    team_id: r.team_id,
    team_name: r.team_name,
    title: r.title,
    content: r.content,
    folder_id: r.folder_id,
    folder_name: r.folder_name,
    tags: r.tags,
    // Your own; or a team's, for its owners and admins, and for the member
    // who made it while they can still write there.
    can_edit: r.team_id
      ? r.my_role === "owner" ||
        r.my_role === "admin" ||
        (r.my_role === "member" && r.user_id === u.id)
      : r.user_id === u.id,
    created_at: r.created_at.toISOString(),
  };
}

const starter = (s: (typeof PAGE_TEMPLATE_STARTERS)[number]): PageTemplate => ({
  ...s,
  source: "starter",
  team_id: null,
  team_name: null,
  folder_id: null,
  folder_name: null,
  tags: [],
  can_edit: false,
  created_at: null,
});

async function loadTemplate(db: Queryable, u: UserRow, id: string) {
  const row = (
    await db.query<Row>(
      `SELECT ${COLUMNS} FROM page_templates t ${JOINS}
        WHERE t.id = $2 AND ${VISIBLE}`,
      [u.id, id],
    )
  ).rows[0];
  if (!row) fail(404, "Template not found");
  return row;
}

/**
 * A folder and tags belong with a template, or a page, only in its own
 * space: yours on your own, the team's on a team's. Anything else is "not
 * found", the same as an id that doesn't exist.
 */
async function checkSpace(
  db: Queryable,
  u: UserRow,
  teamId: string | null,
  links: { folder_id?: string | null; tags?: string[] },
) {
  if (links.folder_id) {
    const found = (
      await db.query(
        `SELECT 1 FROM folders f WHERE f.id = $3
           AND f.team_id IS NOT DISTINCT FROM $2::uuid
           AND (f.team_id IS NOT NULL OR f.user_id = $1)`,
        [u.id, teamId, links.folder_id],
      )
    ).rowCount;
    if (!found) fail(404, "Folder not found");
  }
  const tags = [...new Set(links.tags ?? [])];
  if (tags.length) {
    const found = (
      await db.query(
        `SELECT 1 FROM tags g WHERE g.id = ANY($3::uuid[])
           AND g.team_id IS NOT DISTINCT FROM $2::uuid
           AND (g.team_id IS NOT NULL OR g.user_id = $1)`,
        [u.id, teamId, tags],
      )
    ).rowCount;
    if (found !== tags.length) fail(404, "Tag not found");
  }
}

async function setTemplateTags(db: Queryable, id: string, tags: string[]) {
  await db.query("DELETE FROM page_template_tags WHERE template_id = $1", [id]);
  if (tags.length)
    await db.query(
      `INSERT INTO page_template_tags (template_id, tag_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [id, [...new Set(tags)]],
    );
}

/** A folder, only if it sits in `teamId`'s space (else null). */
async function folderIn(
  db: Queryable,
  u: UserRow,
  teamId: string | null,
  folderId: string | null,
) {
  if (!folderId) return null;
  const found = (
    await db.query(
      `SELECT 1 FROM folders f WHERE f.id = $3
         AND f.team_id IS NOT DISTINCT FROM $2::uuid
         AND (f.team_id IS NOT NULL OR f.user_id = $1)`,
      [u.id, teamId, folderId],
    )
  ).rowCount;
  return found ? folderId : null;
}

/** The tags among `tags` that sit in `teamId`'s space. */
async function tagsIn(
  db: Queryable,
  u: UserRow,
  teamId: string | null,
  tags: string[],
) {
  if (!tags.length) return [];
  return (
    await db.query<{ id: string }>(
      `SELECT g.id FROM tags g WHERE g.id = ANY($3::uuid[])
         AND g.team_id IS NOT DISTINCT FROM $2::uuid
         AND (g.team_id IS NOT NULL OR g.user_id = $1)`,
      [u.id, teamId, tags],
    )
  ).rows.map((r) => r.id);
}

/**
 * Make a page from a template: blanks filled in, filed and tagged as the
 * template says (or as asked), and, when asked, its to-do lines turned into
 * tasks in the chosen project. Written in one transaction, so a page never
 * appears without the tasks it promised.
 */
async function usePageTemplate(
  db: Db,
  u: UserRow,
  template: {
    name: string;
    title: string;
    content: DocBlock[];
    team_id: string | null;
    folder_id: string | null;
    tags: DocTag[];
  },
  input: ReturnType<typeof pageTemplateUse.parse>,
) {
  await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
  const event = input.event_id
    ? ((
        await db.query<{
          id: string;
          title: string;
          due_at: Date | null;
          team_id: string | null;
        }>(
          `SELECT i.id, i.title, i.due_at, i.team_id FROM items i
            WHERE i.id = $2 AND ${VISIBLE_ITEMS}`,
          [u.id, input.event_id],
        )
      ).rows[0] ?? fail(404, "Event not found"))
    : null;
  // A team's template makes the team's pages, and an event's note belongs
  // where the event does, unless the caller says otherwise.
  const teamId =
    input.team_id !== undefined
      ? input.team_id
      : event
        ? event.team_id
        : template.team_id;
  if (teamId) await requireTeam(teamId, u, "items:write", db);
  if (event && event.team_id !== teamId) fail(404, "Event not found");
  const project = input.project_id
    ? ((
        await db.query<{ id: string; name: string }>(
          `SELECT p.id, p.name FROM projects p WHERE p.id = $3
             AND p.team_id IS NOT DISTINCT FROM $2::uuid
             AND (p.team_id IS NOT NULL OR p.user_id = $1)`,
          [u.id, teamId, input.project_id],
        )
      ).rows[0] ?? fail(404, "Project not found"))
    : null;
  let folderId: string | null;
  if (input.folder_id !== undefined) {
    await checkSpace(db, u, teamId, { folder_id: input.folder_id });
    folderId = input.folder_id;
  } else folderId = await folderIn(db, u, teamId, template.folder_id);

  const { timezone } = await loadPrefs(db, u.id);
  const tz = timezone || "UTC";
  const filled = fillTemplate(
    template,
    {
      date: blankDate(
        event
          ? input.event_at
            ? new Date(input.event_at)
            : (event.due_at ?? new Date())
          : new Date(),
        tz,
      ),
      project: project?.name ?? "",
      event: event?.title ?? "",
    },
    input.title,
  );
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO docs (user_id, team_id, title, kind, content, item_id,
         folder_id, project_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id`,
      [
        u.id,
        teamId,
        filled.title,
        event ? "meeting" : "doc",
        JSON.stringify(filled.content),
        event?.id ?? null,
        folderId,
        project?.id ?? null,
      ],
    )
  ).rows[0].id;
  const tags = await tagsIn(
    db,
    u,
    teamId,
    template.tags.map((t) => t.id),
  );
  if (tags.length)
    await db.query(
      `INSERT INTO doc_tags (doc_id, tag_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [id, tags],
    );
  const made = input.make_tasks
    ? await makeLineTasks(
        db,
        u,
        { id, team_id: teamId },
        {
          projectId: project?.id ?? null,
        },
      )
    : null;
  const doc = (
    await db.query<Doc>(
      `SELECT ${DOC_COLUMNS}, d.content FROM docs d ${DOC_JOINS} WHERE d.id = $1`,
      [id],
    )
  ).rows[0];
  return { doc, tasks_created: made?.length ?? 0 };
}

export async function pageTemplateRoutes(app: FastifyInstance) {
  app.get("/page-templates", async (r): Promise<PageTemplate[]> => {
    const u = await authenticate(r);
    const rows = (
      await reader(r.headers).query<Row>(
        `SELECT ${COLUMNS} FROM page_templates t ${JOINS}
          WHERE ${VISIBLE} ORDER BY t.team_id NULLS FIRST, lower(t.name)`,
        [u.id],
      )
    ).rows;
    return [
      ...rows.map((row) => toTemplate(u, row)),
      ...PAGE_TEMPLATE_STARTERS.map(starter),
    ];
  });

  app.post("/page-templates", async (r, reply): Promise<PageTemplate> => {
    const u = await authenticate(r);
    const d = pageTemplateInput.parse(r.body);
    const id = await transaction(async (db) => {
      if (d.team_id) await requireTeam(d.team_id, u, "items:write", db);
      await checkSpace(db, u, d.team_id, d);
      const made = (
        await db.query<{ id: string }>(
          `INSERT INTO page_templates
             (user_id, team_id, name, description, title, content, folder_id)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
          [
            u.id,
            d.team_id,
            d.name,
            d.description,
            d.title,
            JSON.stringify(templateFromPage(d.content)),
            d.folder_id,
          ],
        )
      ).rows[0].id;
      await setTemplateTags(db, made, d.tags);
      return made;
    });
    reply.code(201);
    return toTemplate(u, await loadTemplate(pool, u, id));
  });

  app.put("/page-templates/:id", async (r): Promise<PageTemplate> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = pageTemplateUpdate.parse(r.body);
    await transaction(async (db) => {
      const current = toTemplate(u, await loadTemplate(db, u, id));
      if (!current.can_edit)
        fail(
          403,
          "Only its maker, or a team's owners and admins, can change it.",
        );
      await checkSpace(db, u, current.team_id, d);
      await db.query(
        `UPDATE page_templates SET
           name = coalesce($2, name),
           description = coalesce($3, description),
           title = coalesce($4, title),
           content = coalesce($5::jsonb, content),
           folder_id = CASE WHEN $6::boolean THEN $7::uuid ELSE folder_id END,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          d.name ?? null,
          d.description ?? null,
          d.title ?? null,
          d.content ? JSON.stringify(templateFromPage(d.content)) : null,
          d.folder_id !== undefined,
          d.folder_id ?? null,
        ],
      );
      if (d.tags) await setTemplateTags(db, id, d.tags);
    });
    return toTemplate(u, await loadTemplate(pool, u, id));
  });

  app.delete("/page-templates/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const current = toTemplate(u, await loadTemplate(pool, u, id));
    if (!current.can_edit)
      fail(
        403,
        "Only its maker, or a team's owners and admins, can delete it.",
      );
    await pool.query("DELETE FROM page_templates WHERE id = $1", [id]);
    reply.code(204);
  });

  /**
   * Save a page as a template: its title and lines, with every box
   * unticked, and the folder and tags it has. A team page makes a team
   * template (for anyone who can write the team's pages); `personal` keeps
   * a copy of your own instead, which a team's viewers may do too.
   */
  app.post(
    "/page-templates/from-doc/:id",
    async (r, reply): Promise<PageTemplate> => {
      const u = await authenticate(r);
      const docId = idParam(r);
      const d = pageTemplateFromDoc.parse(r.body ?? {});
      const id = await transaction(async (db) => {
        const doc = (
          await db.query<{
            title: string;
            content: DocBlock[];
            team_id: string | null;
            folder_id: string | null;
          }>(
            `SELECT d.title, d.content, d.team_id, d.folder_id FROM docs d
              WHERE d.id = $2 AND d.deleted_at IS NULL
                AND ((d.team_id IS NULL AND d.user_id = $1)
                  OR d.team_id IN (SELECT team_id FROM team_members
                                    WHERE user_id = $1))`,
            [u.id, docId],
          )
        ).rows[0];
        if (!doc) fail(404, "Document not found");
        const teamId = d.personal ? null : doc.team_id;
        if (teamId) await requireTeam(teamId, u, "items:write", db);
        const folderId = await folderIn(db, u, teamId, doc.folder_id);
        const tags = await tagsIn(
          db,
          u,
          teamId,
          (await pageTags(db, docId)).map((t) => t.id),
        );
        const made = (
          await db.query<{ id: string }>(
            `INSERT INTO page_templates
               (user_id, team_id, name, description, title, content, folder_id)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
            [
              u.id,
              teamId,
              (d.name ?? (doc.title.trim() || "Untitled")).slice(0, 120),
              d.description ?? "",
              doc.title.slice(0, 200),
              JSON.stringify(templateFromPage(doc.content ?? [])),
              folderId,
            ],
          )
        ).rows[0].id;
        await setTemplateTags(db, made, tags);
        return made;
      });
      reply.code(201);
      return toTemplate(u, await loadTemplate(pool, u, id));
    },
  );

  /** Make a page from a template, a starter or a saved one. */
  app.post("/page-templates/:id/use", async (r, reply) => {
    const u = await authenticate(r);
    const raw = (r.params as { id: string }).id;
    const d = pageTemplateUse.parse(r.body ?? {});
    const found = PAGE_TEMPLATE_STARTERS.find((s) => s.id === raw);
    const made = await transaction(async (db) => {
      const template = found
        ? starter(found)
        : toTemplate(u, await loadTemplate(db, u, idParam(r)));
      return usePageTemplate(db, u, template, d);
    });
    reply.code(201);
    return made;
  });
}
