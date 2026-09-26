import { Readable } from "node:stream";
import { pageFile, safeFileName, type DocBlock } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { zipStream, type ZipEntry } from "../docs/zip.js";
import { exportData } from "./portability.js";

/**
 * Everything a person can take with them, in one .zip (DATA-09).
 *
 * Every page they own is a Markdown file in a folder named like its folder
 * in Orbyn, with front matter saying what it was (a page, a note, an
 * agenda), when it was written, its project and its tags. Beside them sit
 * the planner file ("Export my data" gives the same one, and Orbyn can
 * bring it back in), their projects and folders, what was imported and
 * where it went, and every consent decision they made.
 *
 * Only what is the person's own is here — their personal pages, projects
 * and folders. A team's pages belong to the team and stay with it.
 *
 * The archive is written as it is downloaded: pages are read a batch at a
 * time and each file is deflated off the main thread, so a large account
 * neither sits in the API's memory whole nor holds up anyone else's
 * requests while it is packed.
 */

/** Pages read at a time. */
const BATCH = 200;

type PageRow = {
  title: string;
  kind: string;
  content: DocBlock[] | null;
  created_at: Date;
  updated_at: Date;
  agenda_date: string | null;
  folder: string | null;
  project: string | null;
  tags: string[];
  imported_from: {
    file_name: string;
    file_type: string;
    pages: number;
    ocr_pages: number;
    imported_at: string;
  } | null;
  deleted_at: Date | null;
  id: string;
  /** Where the next batch starts: the exact time, as Postgres wrote it. */
  at_key: string;
};

/** A path no other file in the archive has, by numbering a repeat. */
function claim(taken: Set<string>, dir: string, name: string, ext: string) {
  let path = `${dir}/${name}${ext}`;
  for (let n = 2; taken.has(path.toLowerCase()); n++)
    path = `${dir}/${name} (${n})${ext}`;
  taken.add(path.toLowerCase());
  return path;
}

const README = (
  date: string,
  counts: Record<string, number>,
) => `# Your Orbyn export

Made on ${date}. Everything here is yours to keep, open in any editor, or
bring somewhere else.

- \`pages/\`: your ${counts.pages} page${counts.pages === 1 ? "" : "s"} as Markdown, each in a folder named like its folder in
  Orbyn. Pages in no folder sit at the top; daily agendas are in
  \`pages/Agendas\`, named by their day; pages in Trash are in \`pages/Trash\`.
  Each file starts with a few lines saying what it is, when it was written,
  and its project and tags.
- \`planner.json\`: your tasks, events, lists, tags and habits. Orbyn can
  bring this file back in (Settings, Import & export).
- \`projects.json\`: your ${counts.projects} project${counts.projects === 1 ? "" : "s"}, with their stages and deadlines.
- \`folders.json\`: your ${counts.folders} folder${counts.folders === 1 ? "" : "s"}.
- \`views.json\`: your ${counts.views} saved view${counts.views === 1 ? "" : "s"}, and your own fields on your pages and
  projects with what you filled in.
- \`attachments.json\`: the files you imported and the page each one became.
  Orbyn doesn't keep the files themselves: each is deleted as soon as it
  becomes a page, and always within a day.
- \`consent.json\`: each time you agreed to the terms, or turned usage
  analytics on or off.

Team pages and projects belong to their team, so they aren't in here.
`;

/**
 * The archive for one person, as a stream to send. Everything but the pages
 * is read before the first byte goes out, so a failure there is an ordinary
 * error; the pages follow in batches.
 */
export async function exportArchive(
  db: Queryable,
  userId: string,
  now = new Date(),
): Promise<{ name: string; body: Readable }> {
  const date = now.toISOString().slice(0, 10);
  const root = `orbyn-export-${date}`;
  const planner = await exportData(db, userId);

  const folders = (
    await db.query<{
      name: string;
      position: number;
      created_at: Date;
      pages: number;
    }>(
      `SELECT f.name, f.position, f.created_at,
              (SELECT count(*)::int FROM docs d
                WHERE d.folder_id = f.id AND d.user_id = $1
                  AND d.team_id IS NULL AND d.deleted_at IS NULL) AS pages
         FROM folders f
        WHERE f.user_id = $1 AND f.team_id IS NULL
        ORDER BY f.position, lower(f.name)`,
      [userId],
    )
  ).rows;

  // Your own saved views, and your own fields with their values on your
  // own pages and projects (a team's belong to the team).
  const views = (
    await db.query<{
      name: string;
      source: string;
      definition: unknown;
      created_at: Date;
    }>(
      `SELECT name, source, definition, created_at FROM saved_views
        WHERE user_id = $1 AND team_id IS NULL ORDER BY lower(name), id`,
      [userId],
    )
  ).rows;
  const fields = (
    await db.query<{
      name: string;
      type: string;
      applies_to: string;
      options: string[];
      on_calendar: boolean;
      values: { on: string; value: unknown }[];
    }>(
      `SELECT f.name, f.type, f.applies_to, f.options, f.on_calendar,
              coalesce((SELECT json_agg(json_build_object(
                         'on', coalesce(d.title, p.name), 'value', v.value)
                         ORDER BY coalesce(d.title, p.name))
                          FROM custom_field_values v
                          LEFT JOIN docs d ON d.id = v.doc_id AND d.team_id IS NULL
                          LEFT JOIN projects p ON p.id = v.project_id AND p.team_id IS NULL
                         WHERE v.field_id = f.id
                           AND (d.id IS NOT NULL OR p.id IS NOT NULL)), '[]'::json) AS values
         FROM custom_fields f
        WHERE f.user_id = $1 AND f.team_id IS NULL
        ORDER BY f.applies_to, f.position, lower(f.name)`,
      [userId],
    )
  ).rows;

  const projects = (
    await db.query<{
      name: string;
      summary: string;
      status: string;
      deadline: Date | null;
      created_at: Date;
      updated_at: Date;
      brief: string | null;
      stages: string[];
      tasks: number;
      done: number;
    }>(
      `SELECT p.name, p.summary, p.status, p.deadline, p.created_at, p.updated_at,
              (SELECT b.title FROM docs b
                WHERE b.id = p.doc_id AND b.deleted_at IS NULL) AS brief,
              coalesce((SELECT array_agg(s.name ORDER BY s.position)
                          FROM project_stages s WHERE s.project_id = p.id),
                       '{}') AS stages,
              (SELECT count(*)::int FROM items i WHERE i.project_id = p.id) AS tasks,
              (SELECT count(*)::int FROM items i
                WHERE i.project_id = p.id AND i.status = 'done') AS done
         FROM projects p
        WHERE p.user_id = $1 AND p.team_id IS NULL
        ORDER BY p.created_at`,
      [userId],
    )
  ).rows;

  const pageCount = (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM docs d
        WHERE d.user_id = $1 AND d.team_id IS NULL`,
      [userId],
    )
  ).rows[0].n;

  const imports = (
    await db.query<{
      file_name: string;
      file_type: string;
      bytes: string;
      status: string;
      pages: number | null;
      created_at: Date;
      finished_at: Date | null;
      doc_id: string | null;
    }>(
      `SELECT file_name, file_type, bytes, status, pages, created_at,
              finished_at, doc_id
         FROM imports WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    )
  ).rows;

  const consent = (
    await db.query<{
      kind: string;
      version: string | null;
      granted: boolean;
      user_agent: string;
      at: Date;
    }>(
      `SELECT kind, version, granted, user_agent, at FROM consent_log
        WHERE user_id = $1 ORDER BY at, id`,
      [userId],
    )
  ).rows;
  const person = (
    await db.query<{
      terms_version: string | null;
      terms_accepted_at: Date | null;
      analytics_opt_out: boolean;
    }>(
      `SELECT terms_version, terms_accepted_at, analytics_opt_out
         FROM users WHERE id = $1`,
      [userId],
    )
  ).rows[0];

  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const counts = {
    pages: pageCount,
    projects: projects.length,
    folders: folders.length,
    views: views.length,
  };

  // The page an import became is named in attachments.json, which is
  // written after the pages, once their files have their names.
  const wanted = new Set(imports.flatMap((i) => (i.doc_id ? [i.doc_id] : [])));
  const pathOf = new Map<string, string>();
  const imported: {
    page: string;
    file_name: string;
    file_type: string;
    pages: number;
    imported_at: string;
  }[] = [];

  /** Every page, a batch at a time, in the order they were written. */
  async function* pages(): AsyncGenerator<ZipEntry> {
    const taken = new Set<string>();
    let after: { at: string; id: string } | null = null;
    for (;;) {
      const batch: PageRow[] = (
        await db.query<PageRow>(
          `SELECT d.id, d.title, d.kind, d.content, d.created_at,
                  d.created_at::text AS at_key, d.updated_at,
                  to_char(d.agenda_date, 'YYYY-MM-DD') AS agenda_date,
                  f.name AS folder, p.name AS project, d.imported_from,
                  d.deleted_at,
                  coalesce((SELECT array_agg(g.name ORDER BY g.name)
                              FROM doc_tags dt JOIN tags g ON g.id = dt.tag_id
                             WHERE dt.doc_id = d.id), '{}') AS tags
             FROM docs d
             LEFT JOIN folders f ON f.id = d.folder_id
             LEFT JOIN projects p ON p.id = d.project_id
            WHERE d.user_id = $1 AND d.team_id IS NULL
              AND ($2::timestamptz IS NULL
                   OR (d.created_at, d.id) > ($2::timestamptz, $3::uuid))
            ORDER BY d.created_at, d.id
            LIMIT ${BATCH}`,
          [userId, after?.at ?? null, after?.id ?? null],
        )
      ).rows;
      for (const page of batch) {
        const title = page.title.trim() || "Untitled";
        const dir = page.deleted_at
          ? "pages/Trash"
          : page.folder
            ? `pages/${safeFileName(page.folder, "Folder")}`
            : page.kind === "agenda"
              ? "pages/Agendas"
              : "pages";
        const name =
          page.kind === "agenda" && page.agenda_date
            ? page.agenda_date
            : safeFileName(title);
        const path = claim(taken, dir, name, ".md");
        if (wanted.has(page.id)) pathOf.set(page.id, path);
        if (page.imported_from)
          imported.push({
            page: path,
            file_name: page.imported_from.file_name,
            file_type: page.imported_from.file_type,
            pages: page.imported_from.pages,
            imported_at: page.imported_from.imported_at,
          });
        yield {
          name: `${root}/${path}`,
          body: pageFile(
            {
              title,
              kind: page.kind,
              created_at: page.created_at.toISOString(),
              updated_at: page.updated_at.toISOString(),
              agenda_date: page.agenda_date,
              folder: page.folder,
              project: page.project,
              tags: page.tags,
              imported_from: page.imported_from,
              in_trash: !!page.deleted_at,
            },
            page.content ?? [],
          ),
        };
      }
      if (batch.length < BATCH) return;
      const last = batch[batch.length - 1];
      after = { at: last.at_key, id: last.id };
    }
  }

  async function* everything(): AsyncGenerator<ZipEntry> {
    yield { name: `${root}/README.md`, body: README(date, counts) };
    yield { name: `${root}/planner.json`, body: json(planner) };
    yield {
      name: `${root}/projects.json`,
      body: json(
        projects.map((p) => ({
          name: p.name,
          summary: p.summary,
          status: p.status,
          deadline: iso(p.deadline),
          stages: p.stages,
          tasks: p.tasks,
          done: p.done,
          brief: p.brief,
          created_at: iso(p.created_at),
          updated_at: iso(p.updated_at),
        })),
      ),
    };
    yield {
      name: `${root}/folders.json`,
      body: json(
        folders.map((f) => ({
          name: f.name,
          position: f.position,
          created_at: iso(f.created_at),
          pages: f.pages,
        })),
      ),
    };
    yield {
      name: `${root}/views.json`,
      body: json({
        views: views.map((v) => ({
          name: v.name,
          shows: v.source,
          definition: v.definition,
          created_at: iso(v.created_at),
        })),
        fields: fields.map((f) => ({
          name: f.name,
          type: f.type,
          on: f.applies_to === "page" ? "pages" : "projects",
          choices: f.options,
          on_calendar: f.on_calendar,
          values: f.values,
        })),
      }),
    };
    yield {
      name: `${root}/consent.json`,
      body: json({
        terms_version: person?.terms_version ?? null,
        terms_accepted_at: iso(person?.terms_accepted_at ?? null),
        analytics: person?.analytics_opt_out ? "off" : "on",
        history: consent.map((c) => ({
          kind: c.kind,
          version: c.version,
          granted: c.granted,
          at: iso(c.at),
          device: c.user_agent,
        })),
      }),
    };
    yield* pages();
    yield {
      name: `${root}/attachments.json`,
      body: json({
        note: "Orbyn doesn't keep the files you import. Each one is deleted as soon as it becomes a page, and always within a day. This is what was imported and where it went.",
        imports: imports.map((i) => ({
          file_name: i.file_name,
          file_type: i.file_type,
          bytes: Number(i.bytes),
          status: i.status,
          pages: i.pages,
          imported_at: iso(i.created_at),
          finished_at: iso(i.finished_at),
          page: (i.doc_id && pathOf.get(i.doc_id)) || null,
        })),
        pages: imported,
      }),
    };
  }

  return {
    name: `${root}.zip`,
    body: Readable.from(zipStream(everything(), now), { objectMode: false }),
  };
}
