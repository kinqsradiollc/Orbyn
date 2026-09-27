import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AGENT_FILE_LIMITS,
  agentFileType,
  fileSize,
  isPageImage,
  newBlockId,
  type DocBlock,
} from "@orbyn/core";
import { env } from "../config/env.js";
import { Params, scopeFor, visibleDocs } from "../lib/visibility.js";
import { createDoc, saveDoc } from "../modules/docs/service.js";
import { importsEnabled, serviceKey } from "../modules/imports/tokens.js";
import { pageFileLimits, usedBytes } from "../modules/page-files/service.js";
import { docId } from "./common.js";
import { cleanTitle } from "./format.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { seeProject } from "./shared.js";
import { linksFor } from "./refs.js";
import { afterSave } from "./write-docs.js";
import {
  actorOf,
  cantWait,
  clientRefInput,
  dbOf,
  destination,
  refuseSecrets,
} from "./write.js";

/**
 * Files an agent sends (H2, optional originals): the bytes come in the
 * call (base64), at most 25 MB a file and 500 MB a person a day, and go to
 * Orbyn's own file store, encrypted: as a picture or file line on a page
 * (counted in the person's space for pictures and files), or kept beside a
 * page as its original (counted in their space for originals). What a file
 * is comes from its bytes: PDF, Word, PowerPoint, pictures and text only.
 * Nothing reads it (no OCR, no AI).
 */

/** base64 of the largest file, with room for padding and line breaks. */
const MAX_BASE64 = Math.ceil((AGENT_FILE_LIMITS.maxBytes * 4) / 3) + 1024;

/** The short type a kept original is listed with. */
const KEPT_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

const limited = (
  message: string,
  fix: string,
  data?: { retry_after: number },
) => new CapabilityError("LIMITED", message, fix, data);

/** Seconds until the next day (UTC), when the daily 500 MB starts again. */
const untilTomorrow = (now: Date) =>
  Math.max(
    1,
    Math.ceil(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) -
        now.getTime()) /
        1000,
    ),
  );

/** The bytes in `content`: base64, or a data: URL's. */
function decode(content: string): Buffer {
  const body = content.startsWith("data:")
    ? content.slice(content.indexOf(",") + 1)
    : content;
  if (!/^[A-Za-z0-9+/=_\s-]*$/.test(body))
    throw new CapabilityError(
      "INVALID",
      "content must be the file's bytes in base64.",
    );
  const bytes = Buffer.from(body, "base64");
  if (!bytes.length)
    throw new CapabilityError("INVALID", "That file is empty.");
  if (bytes.length > AGENT_FILE_LIMITS.maxBytes)
    throw new CapabilityError(
      "INVALID",
      `That file is ${fileSize(bytes.length)}; one file may be at most 25 MB.`,
      "Send a smaller file, or split it.",
    );
  return bytes;
}

/** Sends the bytes to the file store, which checks them again. */
async function store(
  place: "page" | "kept",
  id: string,
  mime: string,
  bytes: Buffer,
) {
  let res: Response;
  try {
    res = await fetch(`${env.FILES_URL}/internal/agent-files/${place}/${id}`, {
      method: "PUT",
      headers: {
        "x-orbyn-service": serviceKey(),
        "x-orbyn-type": mime,
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new CapabilityError(
      "UNAVAILABLE",
      "Orbyn's file store didn't answer, so the file wasn't added.",
      "Try again in a minute.",
    );
  }
  if (res.status === 507)
    throw new CapabilityError(
      "UNAVAILABLE",
      "Orbyn can't take new files right now.",
      "Try again in a few minutes.",
    );
  if (!res.ok) {
    const said = await res
      .json()
      .then((b: { message?: string }) => b.message)
      .catch(() => null);
    throw new CapabilityError(
      res.status === 415 || res.status === 413 ? "INVALID" : "UNAVAILABLE",
      said ?? "The file store didn't keep that file.",
    );
  }
}

export const addFile = defineCapability({
  name: "add_file",
  title: "Add a file",
  description:
    "Adds a file (base64, up to 25 MB; 500 MB a day) to a page as a picture or file line, or as the page's original; or to a project (a new page in it holding the file, as the app's Pages & files does). PDF, Word, PowerPoint, pictures, text; typed by its bytes; undoable.",
  input: z
    .object({
      doc: z.string().trim().min(1).max(300).optional(),
      project: z.string().trim().min(1).max(300).optional(),
      name: z.string().trim().min(1).max(200),
      content: z.string().max(MAX_BASE64),
      keep: z.enum(["line", "original"]).default("line"),
      after: z.string().max(64).optional().describe("A line's anchor."),
      caption: z.string().trim().max(300).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: z.object({
    file: z.string(),
    type: z.string(),
    bytes: z.number(),
    doc: z.string(),
    version: z.number().nullable(),
    url: z.string(),
    app_url: z.string(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: "suggest",
  toolset: "files",
  mode: "write",
  tier: "W1",
  limitGroup: "heavy",
  async run(ctx, a) {
    refuseSecrets(a.name, a.caption);
    if (!importsEnabled())
      throw new CapabilityError(
        "UNAVAILABLE",
        "Files aren't set up on this server yet.",
      );
    const bytes = decode(a.content);
    const typed = agentFileType(a.name, bytes);
    if ("error" in typed) throw new CapabilityError("INVALID", typed.error);
    const mime = typed.mime;
    if (!a.doc === !a.project)
      throw new CapabilityError("INVALID", "Name a doc or a project (one).");
    // A project's file (H6b): a new page filed in it, named for the file.
    const made = a.project ? await projectPage(ctx, a.project, a.name) : null;
    const id = made?.id ?? docId(a.doc!)!;
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const page = (
      await ctx.db.query<{
        id: string;
        title: string;
        team_id: string | null;
        user_id: string;
        version: number;
        content: DocBlock[];
      }>(
        `SELECT d.id, d.title, d.team_id, d.user_id, d.version, d.content
           FROM docs d WHERE d.id = ${p.add(id)} AND ${visibleDocs("d", scope)}
          FOR UPDATE`,
        p.values,
      )
    ).rows[0];
    if (!page)
      throw new CapabilityError(
        "NOT_FOUND",
        "Nothing with that id is reachable from this connection.",
        "Search for the page and use its id.",
      );
    // A file can't wait in the Review inbox: it is added or refused.
    if (
      destination(ctx, page.team_id, "W2", [], {
        owner: { user_id: page.user_id },
      }) === "review"
    )
      throw cantWait(ctx, page.team_id);
    const me = ctx.principal.user.id;
    const n = bytes.length;
    const original = a.keep === "original";
    // Only finding out whether to ask the person first: store nothing yet.
    if (ctx.asking?.mode === "collect" && ctx.asking.reasons.length)
      return {
        structured: {
          file: "",
          type: mime,
          bytes: n,
          doc: `doc:${page.id}`,
          version: null,
          ...linksFor({ type: "doc", id: page.id }),
        },
        markdown: `Add ${cleanTitle(a.name)} (${fileSize(n)}) to “${cleanTitle(page.title)}”${original ? " as its original" : ""}`,
      };
    const content = Array.isArray(page.content) ? page.content : [];
    let at = content.length;
    if (!original && a.after) {
      at = content.findIndex((b) => b.id === a.after!.replace(/^\^/, "")) + 1;
      if (!at)
        throw new CapabilityError(
          "INVALID",
          `There is no line ${a.after} on this page.`,
          "Fetch the page and use a line's ^b… anchor, or leave after out.",
        );
    }
    // One person's files are counted one call at a time.
    await ctx.db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${original ? "kept" : "page-files"}:${me}`,
    ]);
    const today = Number(
      (
        await ctx.db.query<{ bytes: string | null }>(
          "SELECT bytes FROM agent_file_days WHERE user_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date",
          [me],
        )
      ).rows[0]?.bytes ?? 0,
    );
    if (today + n > AGENT_FILE_LIMITS.perDayBytes)
      throw limited(
        `Agents have sent ${fileSize(today)} of files today; 500 MB a day is the most, so this ${fileSize(n)} wasn't added.`,
        "Try again tomorrow (the day turns at midnight UTC; retry_after says when), or ask the person to add it in Orbyn.",
        { retry_after: untilTomorrow(ctx.now) },
      );
    if (original) {
      if (
        (
          await ctx.db.query("SELECT 1 FROM kept_files WHERE doc_id = $1", [
            page.id,
          ])
        ).rowCount
      )
        throw new CapabilityError(
          "INVALID",
          "This page already keeps an original.",
          "Add the file as a line instead (keep: line), or ask the person to delete the original in the page's Info.",
        );
      const used = Number(
        (
          await ctx.db.query<{ n: string | null }>(
            "SELECT sum(bytes) AS n FROM kept_files WHERE user_id = $1 AND doc_id IS NOT NULL",
            [me],
          )
        ).rows[0].n ?? 0,
      );
      if (used + n > env.FILES_KEEP_QUOTA_MB * 1024 * 1024)
        throw limited(
          `The person's space for originals is full (${env.FILES_KEEP_QUOTA_MB} MB).`,
          "Ask them to delete originals they no longer need in Settings, or add the file as a line.",
        );
    } else {
      const { maxBytes, quotaBytes } = pageFileLimits();
      if (n > maxBytes)
        throw new CapabilityError(
          "INVALID",
          `Pages here take files up to ${env.PAGE_FILES_MAX_MB} MB.`,
        );
      if ((await usedBytes(ctx.db, me)) + n > quotaBytes)
        throw limited(
          `The person's space for pictures and files is full (${env.PAGE_FILES_QUOTA_MB} MB).`,
          "Ask them to delete files they no longer need from a page's Info.",
        );
    }
    const fileId = randomUUID();
    await store(original ? "kept" : "page", fileId, mime, bytes);
    await ctx.db.query(
      `INSERT INTO agent_file_days (user_id, day, bytes) VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2)
       ON CONFLICT (user_id, day) DO UPDATE SET bytes = agent_file_days.bytes + EXCLUDED.bytes`,
      [me, n],
    );
    const name = cleanTitle(a.name).slice(0, 200) || "file";
    const file = `orbyn://file/${fileId}`;
    if (original) {
      const keptLinks = linksFor({ type: "doc", id: page.id });
      await ctx.db.query(
        `INSERT INTO kept_files (id, user_id, doc_id, file_name, file_type, bytes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fileId, me, page.id, name, KEPT_TYPE[mime] ?? "file", n],
      );
      return {
        structured: {
          file,
          type: mime,
          bytes: n,
          doc: `doc:${page.id}`,
          version: null,
          ...keptLinks,
        },
        markdown: `Kept ${name} (${fileSize(n)}) as the original of “${cleanTitle(page.title)}” (doc:${page.id}), in its Info.\nOpen the page on the web: ${keptLinks.url} · in the Orbyn app: ${keptLinks.app_url}`,
        targets: [`doc:${page.id}`],
        write: {
          outcome: "ok",
          counts: { "added:file": 1 },
          undo: [
            ...(made
              ? [
                  {
                    op: "doc.trash" as const,
                    doc_id: page.id,
                    version: page.version,
                  },
                ]
              : []),
            { op: "file.delete" as const, id: fileId, kept: true },
          ],
          team_id: page.team_id,
        },
      };
    }
    const image = isPageImage(mime);
    await ctx.db.query(
      `INSERT INTO page_files (id, user_id, doc_id, name, mime, kind, bytes,
         status, source, stored_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', 'agent', now())`,
      [fileId, me, page.id, name, mime, image ? "image" : "file", n],
    );
    const line: DocBlock = image
      ? { id: newBlockId(), type: "image", file: fileId, text: a.caption ?? "" }
      : { id: newBlockId(), type: "file", file: fileId, text: name };
    const saved = await saveDoc(
      dbOf(ctx),
      actorOf(ctx.principal),
      page.id,
      {
        version: page.version,
        content: [...content.slice(0, at), line, ...content.slice(at)] as never,
      },
      { always: true },
    );
    const lineLinks = linksFor({ type: "doc", id: page.id, block: line.id });
    return {
      structured: {
        file,
        type: mime,
        bytes: n,
        doc: `doc:${page.id}#${line.id}`,
        version: saved.version,
        ...lineLinks,
      },
      markdown: `Added ${name} (${fileSize(n)}) to “${cleanTitle(page.title)}” as ${image ? "a picture" : "a file"} line ^${line.id} (version ${saved.version}).\nOpen it on the web: ${lineLinks.url} · in the Orbyn app: ${lineLinks.app_url}`,
      targets: [`doc:${page.id}`],
      write: {
        outcome: "ok",
        counts: { "added:file": 1 },
        // Last first: the line goes, then the file nothing shows.
        // Undone last first: the line goes, then the file, then (for a
        // project's file) the page made for it goes to Trash.
        undo: made
          ? [
              { op: "doc.trash", doc_id: page.id, version: saved.version },
              { op: "file.delete", id: fileId },
              {
                op: "doc.restore",
                doc_id: page.id,
                version: saved.version,
                to_version: page.version,
              },
            ]
          : [
              { op: "file.delete", id: fileId },
              {
                op: "doc.restore",
                doc_id: page.id,
                version: saved.version,
                to_version: page.version,
              },
            ],
        team_id: page.team_id,
        after: afterSave(page.id, saved.version, ctx.principal.grant_id),
      },
    };
  },
});

/**
 * A new page in a project for a file sent to it (H6b), in the project's
 * space: the app adds a project's files as pages in it too.
 */
async function projectPage(
  ctx: CapabilityContext,
  input: string,
  name: string,
) {
  const project = await seeProject(ctx, input);
  if (
    destination(ctx, project.team_id, project.team_id ? "W2" : "W1") ===
    "review"
  )
    throw cantWait(ctx, project.team_id);
  const doc = await createDoc(dbOf(ctx), actorOf(ctx.principal), {
    title: cleanTitle(name).slice(0, 200) || "File",
    kind: "doc",
    team_id: project.team_id,
    project_id: project.id,
    folder_id: null,
    item_id: null,
    content: [],
    tags: [],
  } as never);
  return doc;
}
