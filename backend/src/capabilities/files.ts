import { z } from "zod";
import { IMPORT_LIMITS } from "@orbyn/core";
import {
  cancelImport,
  importCapabilities,
  jobs,
  startImport,
} from "../modules/imports/service.js";
import { importData } from "../modules/organize/portability.js";
import { READ } from "./common.js";
import { cleanTitle } from "./format.js";
import { appUrl, refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { actionChange, seeProject } from "./shared.js";
import { itemEntry } from "./write-tasks.js";
import {
  ADDS,
  EDITS,
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
  destination,
  finishWrite,
  refuseSecrets,
  writeOutput,
} from "./write.js";

/**
 * The files toolset: imports into Docs (PDF, Word and photos, read by
 * Orbyn's own converter on its own file store, with CPU OCR) and bulk task
 * import. Imports are the person's own: the upload link is single-use, lasts
 * ten minutes and is only ever for this import. Imported pages are labelled
 * as imported content wherever agents read them.
 */

const personal = (ctx: CapabilityContext) => {
  if (!ctx.principal.personal)
    throw new CapabilityError(
      "FORBIDDEN",
      "Imports are the person's own, so this connection needs their Personal space.",
    );
};

/**
 * The person's imports this connection reaches: all of them with Personal;
 * without it, only those into a project of a team it reaches.
 */
async function reachableJobs(ctx: CapabilityContext, id?: string) {
  const list = await jobs(ctx.db, ctx.principal.user.id, id);
  if (ctx.principal.personal || !list.length) return list;
  const inTeams = new Set(
    (
      await ctx.db.query<{ id: string }>(
        `SELECT id FROM imports WHERE id = ANY ($1::uuid[])
            AND project_team_id = ANY ($2::uuid[])`,
        [list.map((j) => j.id), ctx.principal.teams.map((t) => t.id)],
      )
    ).rows.map((r) => r.id),
  );
  return list.filter((j) => inTeams.has(j.id));
}

const job = z.object({
  id: z.string(),
  file: z.string(),
  status: z.string(),
  pages: z.number().nullable(),
  page: z
    .string()
    .nullable()
    .describe("The page it became (doc:<id>), once ready."),
  error: z.string().nullable(),
  estimate_seconds: z.number().nullable(),
});

const jobOut = (j: Awaited<ReturnType<typeof jobs>>[number]) => ({
  id: `import:${j.id}`,
  file: cleanTitle(j.file_name),
  status: j.status,
  pages: j.pages,
  page: j.doc_id ? refs({ type: "doc", id: j.doc_id }).id : null,
  error: j.error,
  estimate_seconds: j.estimate_seconds,
});

// --- list_imports -----------------------------------------------------------

export const listImports = defineCapability({
  name: "list_imports",
  title: "Imports",
  description:
    "The person's imports into Docs (still going, and the last week's), each with its status, pages, queue wait and the page it became, plus what this server can read (PDF, Word, scans, photos, equations) and its limits.",
  input: z.object({ import: z.string().trim().max(300).optional() }).strict(),
  output: z.object({
    imports: z.array(job),
    can_read: z.object({
      enabled: z.boolean(),
      scans: z.string(),
      photos: z.boolean(),
      formulas: z.boolean(),
      max_bytes: z.number(),
      max_pages: z.number(),
    }),
  }),
  annotations: READ,
  access: "read",
  toolset: "files",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const id = a.import?.replace(/^import:/, "");
    const list = await reachableJobs(ctx, id);
    if (id && !list.length)
      throw new CapabilityError(
        "NOT_FOUND",
        "No import with that id is yours.",
      );
    const caps = await importCapabilities(ctx.db);
    const structured = {
      imports: list.map(jobOut),
      can_read: {
        enabled: caps.enabled,
        scans: caps.scans,
        photos: caps.photos,
        formulas: caps.formulas,
        max_bytes: caps.limits.maxBytes,
        max_pages: caps.limits.maxPages,
      },
    };
    return {
      structured,
      markdown: [
        caps.enabled
          ? "Imports are on."
          : "Importing files isn't set up on this server.",
        ...structured.imports.map(
          (j) =>
            `- ${j.file}: ${j.status}${j.page ? ` → ${j.page}` : ""}${j.error ? ` (${j.error})` : ""} · ${j.id}`,
        ),
      ].join("\n"),
    };
  },
});

// --- start_import -----------------------------------------------------------

export const startImportCapability = defineCapability({
  name: "start_import",
  title: "Start an import",
  description:
    "Starts importing a PDF, Word (.docx), PNG or JPEG file into Docs, optionally into a project. Returns a single-use upload URL (valid 10 minutes): PUT the file's bytes to it, then poll list_imports with the import id until its page is ready.",
  input: z
    .object({
      file_name: z.string().trim().min(1).max(200),
      bytes: z.number().int().min(1).max(IMPORT_LIMITS.maxBytes),
      mime: z.string().max(200).optional(),
      project: z.string().trim().max(300).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput.extend({
    upload_url: z.string().nullable(),
    upload_expires_at: z.string().nullable(),
  }),
  annotations: ADDS,
  access: "write",
  toolset: "files",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    const project = a.project ? await seeProject(ctx, a.project) : null;
    // Into a team's project, the team's space is enough; anything else is
    // the person's own.
    if (!project?.team_id) personal(ctx);
    if (
      destination(
        ctx,
        project?.team_id ?? null,
        project?.team_id ? "W2" : "W1",
      ) === "review"
    )
      throw cantWait(ctx, project?.team_id ?? null);
    const started = await startImport(dbOf(ctx), actorOf(ctx.principal), {
      file_name: a.file_name,
      bytes: a.bytes,
      ...(a.mime ? { mime: a.mime } : {}),
      ...(project
        ? { project_id: project.id, project_team_id: project.team_id }
        : {}),
    });
    const answer = await finishWrite(ctx, "Importing", {
      done: [
        {
          id: `import:${started.import.id}`,
          title: cleanTitle(started.import.file_name),
          url: `${appUrl()}/app`,
          version: null,
          change: "Waiting for the file",
        },
      ],
      undo: [],
    });
    const url = `${appUrl()}/api${started.upload_path}`;
    return {
      ...answer,
      structured: {
        ...answer.structured,
        upload_url: url,
        upload_expires_at: started.expires_at,
      },
      markdown: `${answer.markdown}\nUpload: PUT the file's bytes to ${url} before ${started.expires_at}, then check list_imports for import:${started.import.id}.`,
    };
  },
});

// --- cancel_import ------------------------------------------------------------

export const cancelImportCapability = defineCapability({
  name: "cancel_import",
  title: "Cancel an import",
  description:
    "Cancels an import still going, or clears a finished one that kept no file from the list. The page an import made stays.",
  input: z
    .object({
      import: z.string().trim().min(1).max(300),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "files",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const id = a.import.replace(/^import:/, "");
    const before = (await reachableJobs(ctx, id))[0];
    const team = before
      ? ((
          await dbOf(ctx).query<{ project_team_id: string | null }>(
            "SELECT project_team_id FROM imports WHERE id = $1",
            [id],
          )
        ).rows[0]?.project_team_id ?? null)
      : null;
    if (destination(ctx, team, "W2") === "review") throw cantWait(ctx, team);
    if (!before)
      throw new CapabilityError(
        "NOT_FOUND",
        "No import with that id is yours.",
      );
    await cancelImport(dbOf(ctx), ctx.principal.user.id, id);
    return finishWrite(ctx, "Imports", {
      done: [
        {
          id: `import:${id}`,
          title: cleanTitle(before.file_name),
          url: `${appUrl()}/app`,
          version: null,
          change: ["waiting", "queued", "reading", "ocr"].includes(
            before.status,
          )
            ? "Cancelled"
            : "Cleared",
        },
      ],
    });
  },
});

// --- import_tasks -------------------------------------------------------------

export const importTasks = defineCapability({
  name: "import_tasks",
  title: "Import tasks",
  description:
    "Imports tasks from an Orbyn export (JSON) or CSV (title, notes, due, priority, list, tags, …) into Personal. A dry run (the default) counts and checks without writing. A real run is made at once at full power (each task can be undone for 30 days); more than 50 tasks, or a connection that asks first or only suggests, asks the person first.",
  input: z
    .object({
      format: z.enum(["orbyn", "csv"]),
      data: z.string().min(1).max(200_000),
      dry_run: z.boolean().default(true),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput.extend({
    preview: z.object({
      tasks: z.number(),
      skipped: z.number(),
      lists_added: z.number(),
      tags_added: z.number(),
      sample: z.array(z.string()),
      errors: z.array(z.string()),
    }),
  }),
  annotations: ADDS,
  access: "write",
  toolset: "files",
  mode: "write",
  tier: "W3",
  async run(ctx, a) {
    personal(ctx);
    refuseSecrets(a.data);
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    // A dry run never writes, whatever the file says.
    const summary = await importData(db, actor, a.format, a.data, true);
    const preview = {
      tasks: summary.created,
      skipped: summary.skipped,
      lists_added: summary.lists_added,
      tags_added: summary.tags_added,
      sample: summary.sample.map((t) => cleanTitle(t)),
      errors: summary.errors.map((e) => cleanTitle(e)),
    };
    if (a.dry_run) {
      const answer = await finishWrite(ctx, "Import check", {
        done: [],
        skipped: summary.errors.length
          ? [{ index: 0, reason: summary.errors[0] }]
          : [],
        outcome: "ok",
      });
      return {
        ...answer,
        structured: { ...answer.structured, preview },
        markdown: `Dry run: ${preview.tasks} task${preview.tasks === 1 ? "" : "s"} would be made (${preview.skipped} skipped, ${preview.lists_added} new lists, ${preview.tags_added} new tags). Nothing was written.`,
      };
    }
    if (!preview.tasks)
      throw new CapabilityError(
        "INVALID",
        preview.errors[0] ?? "There are no tasks to import.",
      );
    // At full power an import is made at once (each task can be undone),
    // unless it's more than 50 tasks, which asks first.
    if (
      destination(ctx, null, "W2", [], { count: preview.tasks }) === "direct"
    ) {
      const made = await importData(db, actor, a.format, a.data, false);
      const rows = (
        await db.query<{
          id: string;
          kind: string;
          title: string;
          version: number;
        }>(
          `SELECT id, kind, title, version FROM items
            WHERE user_id = $1 AND created_at = now() AND team_id IS NULL
            ORDER BY created_at, id`,
          [ctx.principal.user.id],
        )
      ).rows;
      const answer = await finishWrite(ctx, "Importing tasks", {
        done: rows.slice(0, 50).map((r) => itemEntry(r, "Imported")),
        undo: rows.map((r) => ({
          op: "item.delete" as const,
          id: r.id,
          version: r.version,
        })),
      });
      return {
        ...answer,
        structured: {
          ...answer.structured,
          preview: { ...preview, tasks: made.created },
        },
      };
    }
    const answer = await finishWrite(ctx, "Importing tasks", {
      done: [],
      review: [
        actionChange({
          action: "tasks.import",
          target_id: null,
          title: `${preview.tasks} tasks`,
          team_id: null,
          headline: `Import ${preview.tasks} task${preview.tasks === 1 ? "" : "s"} into Personal`,
          rows: preview.sample.map((t) => ({
            label: "Task",
            before: null,
            after: t,
          })),
          input: { format: a.format, data: a.data },
        }),
      ],
    });
    return { ...answer, structured: { ...answer.structured, preview } };
  },
});
