import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  cleanImportName,
  fail,
  linkImportedPage,
  PAGE_IMPORT_LIMITS,
  pageImportInput,
  parseDoc,
  planPagesImport,
  type ImportFile,
  type PagesImportSummary,
} from "@orbyn/core";
import { transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { unzip, ZipError } from "../docs/zip.js";

const TEXT = /\.(md|markdown|txt|csv)$/i;

/** The files in what was sent: a zip's text files, or the one file. */
function filesOf(name: string, bytes: Buffer): ImportFile[] {
  if (/\.zip$/i.test(name)) {
    try {
      return unzip(bytes, {
        maxFiles: PAGE_IMPORT_LIMITS.maxFiles,
        maxBytes: PAGE_IMPORT_LIMITS.maxBytes * 5,
        keep: (n) => !n.startsWith("__MACOSX/"),
      }).map((f) => ({
        path: f.name,
        // Pictures and other files are only counted, never read.
        text: TEXT.test(f.name) ? f.body.toString("utf8") : "",
      }));
    } catch (e) {
      fail(
        422,
        e instanceof ZipError ? e.message : "The zip file couldn't be read.",
      );
    }
  }
  if (!TEXT.test(name)) fail(422, "Choose a .zip, or a Markdown (.md) file.");
  return [{ path: name, text: bytes.toString("utf8") }];
}

/**
 * Markdown and Notion exports into pages (DATA-08). A dry run (the default)
 * reads the export and says what would come in; the same request with
 * `dry_run: false` makes the folders, pages, projects and tasks in one
 * transaction, with links between the imported pages made into Orbyn links.
 */
export async function pageImportRoutes(app: FastifyInstance) {
  app.post(
    "/imports/pages",
    {
      bodyLimit: Math.ceil((PAGE_IMPORT_LIMITS.maxBytes * 4) / 3) + 4096,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (r): Promise<PagesImportSummary> => {
      const u = await authenticate(r);
      const d = pageImportInput.parse(r.body ?? {});
      const teamId = d.team_id ?? null;
      if (teamId) await requireTeam(teamId, u, "items:write");
      const bytes = Buffer.from(d.data, "base64");
      if (bytes.length > PAGE_IMPORT_LIMITS.maxBytes)
        fail(413, "That file is over 20 MB. Split the export and try again.");
      const files = filesOf(d.file_name, bytes);
      const plan = planPagesImport(files, d.format, d.file_name);
      const taskCount = plan.projects.reduce((n, p) => n + p.tasks.length, 0);
      const errors: string[] = [];
      if (!plan.pages.length && !plan.projects.length)
        errors.push(
          d.format === "notion"
            ? "No pages or databases were found. Export from Notion as Markdown & CSV, then choose the .zip."
            : "No Markdown files were found.",
        );

      // Ids first, so links between the pages can be written in one go.
      const ids = new Map(plan.pages.map((p) => [p.path, randomUUID()]));
      const byPath = new Map(
        plan.pages.map((p) => [p.path.toLowerCase(), ids.get(p.path)!]),
      );
      const byTitle = new Map<string, string>();
      for (const p of plan.pages) {
        const key = cleanImportName(p.title).toLowerCase();
        if (!byTitle.has(key)) byTitle.set(key, ids.get(p.path)!);
      }
      const linked = plan.pages.map((p) => ({
        page: p,
        ...linkImportedPage(p, byPath, byTitle),
      }));
      const summary: PagesImportSummary = {
        pages: plan.pages.length,
        folders: plan.folders.length,
        projects: plan.projects.length,
        tasks: taskCount,
        links: linked.reduce((n, l) => n + l.links, 0),
        sample: [
          ...plan.pages.slice(0, 5).map((p) => p.title),
          ...plan.projects
            .slice(0, 2)
            .map((p) => `${p.name} (${p.tasks.length} tasks)`),
        ].slice(0, 6),
        left_out: plan.left_out,
        errors,
        folder_id: null,
      };
      if (d.dry_run || errors.length) return summary;

      return transaction(async (db) => {
        await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
        const folderIds = new Map<string, string>();
        for (const name of plan.folders) {
          folderIds.set(
            name,
            (
              await db.query<{ id: string }>(
                `INSERT INTO folders (user_id, team_id, name, position)
                   VALUES ($1, $2, $3,
                     (SELECT coalesce(max(position), -1) + 1 FROM folders
                       WHERE user_id = $1 AND team_id IS NOT DISTINCT FROM $2))
                 RETURNING id`,
                [u.id, teamId, name.slice(0, 120)],
              )
            ).rows[0].id,
          );
        }
        for (const l of linked)
          await db.query(
            `INSERT INTO docs (id, user_id, team_id, title, kind, content, folder_id)
               VALUES ($1, $2, $3, $4, 'doc', $5::jsonb, $6)`,
            [
              ids.get(l.page.path),
              u.id,
              teamId,
              l.page.title,
              JSON.stringify(parseDoc(l.markdown)),
              folderIds.get(l.page.folder) ?? null,
            ],
          );
        for (const project of plan.projects) {
          const projectId = (
            await db.query<{ id: string }>(
              `INSERT INTO projects (user_id, team_id, name, summary)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
              [u.id, teamId, project.name, "Imported from Notion."],
            )
          ).rows[0].id;
          for (const [position, name] of ["To do", "Doing", "Done"].entries())
            await db.query(
              "INSERT INTO project_stages (project_id, name, position) VALUES ($1, $2, $3)",
              [projectId, name, position],
            );
          for (const t of project.tasks.slice(0, 2000))
            await db.query(
              `INSERT INTO items (user_id, team_id, title, notes, kind, status,
                 priority, due_at, project_id, progress)
                 VALUES ($1, $2, $3, $4, 'task', $5, $6, $7, $8, $9)`,
              [
                u.id,
                teamId,
                t.title,
                t.notes.slice(0, 20_000),
                t.status,
                t.priority,
                t.due_at,
                projectId,
                t.status === "done" ? 100 : 0,
              ],
            );
        }
        return {
          ...summary,
          folder_id: folderIds.get(plan.folders[0]) ?? null,
        };
      });
    },
  );
}
