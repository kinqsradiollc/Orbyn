import { pageFile, safeFileName, type DocBlock } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { zip, type ZipEntry } from "../docs/zip.js";
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
 */

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
  folder_id: string | null;
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
- \`attachments.json\`: the files you imported and the page each one became.
  Orbyn doesn't keep the files themselves: each is deleted as soon as it
  becomes a page, and always within a day.
- \`consent.json\`: each time you agreed to the terms, or turned usage
  analytics on or off.

Team pages and projects belong to their team, so they aren't in here.
`;

/** Build the archive for one person. */
export async function exportArchive(
  db: Queryable,
  userId: string,
  now = new Date(),
): Promise<{ name: string; body: Buffer }> {
  const date = now.toISOString().slice(0, 10);
  const root = `orbyn-export-${date}`;
  const planner = await exportData(db, userId);

  const folders = (
    await db.query<{
      id: string;
      name: string;
      position: number;
      created_at: Date;
    }>(
      `SELECT id, name, position, created_at FROM folders
        WHERE user_id = $1 AND team_id IS NULL
        ORDER BY position, lower(name)`,
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

  const pages = (
    await db.query<PageRow>(
      `SELECT d.id, d.folder_id, d.title, d.kind, d.content, d.created_at,
              d.updated_at,
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
        ORDER BY d.created_at, d.id`,
      [userId],
    )
  ).rows;

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

  // Each page's file, in its folder.
  const taken = new Set<string>();
  const pathOf = new Map<string, string>();
  const entries: ZipEntry[] = [];
  for (const page of pages) {
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
    pathOf.set(page.id, path);
    entries.push({
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
    });
  }

  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const counts = {
    pages: pages.length,
    projects: projects.length,
    folders: folders.length,
  };
  entries.unshift(
    { name: `${root}/README.md`, body: README(date, counts) },
    { name: `${root}/planner.json`, body: json(planner) },
    {
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
    },
    {
      name: `${root}/folders.json`,
      body: json(
        folders.map((f) => ({
          name: f.name,
          position: f.position,
          created_at: iso(f.created_at),
          pages: pages.filter((p) => p.folder_id === f.id && !p.deleted_at)
            .length,
        })),
      ),
    },
    {
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
        pages: pages
          .filter((p) => p.imported_from)
          .map((p) => ({
            page: pathOf.get(p.id),
            file_name: p.imported_from!.file_name,
            file_type: p.imported_from!.file_type,
            pages: p.imported_from!.pages,
            imported_at: p.imported_from!.imported_at,
          })),
      }),
    },
    {
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
    },
  );
  return { name: `${root}.zip`, body: zip(entries, now) };
}
