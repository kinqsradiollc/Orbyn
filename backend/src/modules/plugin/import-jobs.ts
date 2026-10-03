import { z } from "zod";
import type { ImportJob } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { policy, type Principal } from "../../capabilities/policy.js";
import { startImportCapability } from "../../capabilities/files.js";
import { CapabilityError } from "../../capabilities/registry.js";
import { refs } from "../../capabilities/refs.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleProjects,
} from "../../lib/visibility.js";
import { pluginJobCursor } from "./job-cursor.js";

const id = z.uuid();
const status = z.enum([
  "waiting",
  "queued",
  "reading",
  "ocr",
  "ready",
  "failed",
  "cancelled",
]);
export const pluginImportJobSchema = z
  .object({
    id,
    status,
    expires_at: z.iso.datetime(),
  })
  .strict();
export const pluginImportEventsSchema = z
  .object({
    id,
    status,
    events: z
      .array(
        z
          .object({
            sequence: z
              .string()
              .regex(/^[1-9]\d{0,15}$/)
              .refine((value) => Number.isSafeInteger(Number(value))),
            status,
            created_at: z.iso.datetime(),
          })
          .strict(),
      )
      .max(100),
    cursor: z.string().min(1).max(512),
    has_more: z.boolean(),
    result: z
      .object({ id: z.string().regex(/^doc:[0-9a-f-]{36}$/i), url: z.url() })
      .strict()
      .optional(),
  })
  .strict();
const missing = () =>
  new CapabilityError("NOT_FOUND", "This plugin job is unavailable.");
const permitted = (p: Principal) => {
  if (
    p.via !== "plugin" ||
    !p.grant_id ||
    !p.client.id ||
    !policy.allows(p, startImportCapability)
  )
    throw new CapabilityError(
      "FORBIDDEN",
      "Import jobs are not available to this connection.",
    );
};

type Source = {
  id: string;
  project_id: string | null;
  doc_id: string | null;
  status: ImportJob["status"];
};
type Job = {
  id: string;
  import_id: string;
  source_project_id: string | null;
  expires_at: Date;
};

/** Lock producer first (converter order), then its document/projects and check current visibility. */
async function source(
  db: Queryable,
  p: Principal,
  importId: string,
  originalProject?: string | null,
): Promise<Source> {
  const row = (
    await db.query<Source>(
      "SELECT id,project_id,doc_id,status FROM imports WHERE id=$1 AND user_id=$2 FOR SHARE",
      [importId, p.user.id],
    )
  ).rows[0];
  if (!row) throw missing();
  if (originalProject === null && !p.personal) throw missing();
  const doc = row.doc_id
    ? (
        await db.query<{ project_id: string | null }>(
          "SELECT project_id FROM docs WHERE id=$1 FOR SHARE",
          [row.doc_id],
        )
      ).rows[0]
    : undefined;
  if (row.doc_id && !doc) throw missing();
  if (row.status === "ready" && !row.doc_id) throw missing();
  const projects = [
    ...new Set(
      [row.project_id, originalProject, doc?.project_id].filter(
        (value): value is string => !!value,
      ),
    ),
  ].sort();
  if (projects.length) {
    const locked = await db.query(
      "SELECT id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
      [projects],
    );
    if (locked.rowCount !== projects.length) throw missing();
  }
  const params = new Params();
  const scope = scopeFor(policy.spaces(p), params);
  const conditions = projects.map(
    (project) =>
      `EXISTS (SELECT 1 FROM projects p WHERE p.id=${params.add(project)} AND ${visibleProjects("p", scope)})`,
  );
  // Preserve the original personal boundary even if a result is moved later.
  if (!row.project_id && !originalProject && !p.personal) throw missing();
  if (row.doc_id)
    conditions.push(
      `EXISTS (SELECT 1 FROM docs d WHERE d.id=${params.add(row.doc_id)} AND ${visibleDocs("d", scope)})`,
    );
  if (
    conditions.length &&
    !(
      await db.query(
        `SELECT 1 WHERE ${conditions.join(" AND ")}`,
        params.values,
      )
    ).rowCount
  )
    throw missing();
  return row;
}

/** Call inside pluginWrite after the domain import has returned its durable handle. */
export async function trackPluginImport(
  db: Queryable,
  p: Principal,
  importId: string,
) {
  permitted(p);
  if (!id.safeParse(importId).success) throw missing();
  const producer = await source(db, p, importId);
  const inserted = (
    await db.query<Job>(
      `INSERT INTO plugin_import_jobs(user_id,grant_id,import_id,source_project_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT(grant_id,import_id) DO NOTHING
     RETURNING id,import_id,source_project_id,expires_at`,
      [p.user.id, p.grant_id, producer.id, producer.project_id],
    )
  ).rows[0];
  const job =
    inserted ??
    (
      await db.query<Job>(
        `SELECT id,import_id,source_project_id,expires_at FROM plugin_import_jobs
     WHERE user_id=$1 AND grant_id=$2 AND import_id=$3 AND expires_at > now()`,
        [p.user.id, p.grant_id, producer.id],
      )
    ).rows[0];
  if (!job) throw missing();
  if (inserted)
    await db.query(
      "INSERT INTO plugin_import_events(job_id,status) VALUES ($1,$2)",
      [job.id, producer.status],
    );
  return pluginImportJobSchema.parse({
    id: job.id,
    status: producer.status,
    expires_at: job.expires_at.toISOString(),
  });
}

/** Call inside pluginRead: its live grant/member locks plus source locks protect every replay. */
export async function readPluginImportEvents(
  db: Queryable,
  p: Principal,
  jobId: string,
  resource: string,
  key: Buffer,
  cursor?: string,
) {
  permitted(p);
  if (!id.safeParse(jobId).success) throw missing();
  const job = (
    await db.query<Job>(
      `SELECT id,import_id,source_project_id,expires_at FROM plugin_import_jobs
     WHERE id=$1 AND user_id=$2 AND grant_id=$3 AND expires_at > now()`,
      [jobId, p.user.id, p.grant_id],
    )
  ).rows[0];
  if (!job) throw missing();
  const producer = await source(db, p, job.import_id, job.source_project_id);
  // Lock jobs only after imports, matching the converter transition trigger.
  const retained = (
    await db.query<Job>(
      `SELECT id,import_id,source_project_id,expires_at FROM plugin_import_jobs
     WHERE id=$1 AND user_id=$2 AND grant_id=$3 AND expires_at > now() FOR SHARE`,
      [jobId, p.user.id, p.grant_id],
    )
  ).rows[0];
  if (!retained) throw missing();
  const codec = pluginJobCursor(
    p,
    { resource, jobId, sourceRevision: `import:${job.import_id}` },
    key,
  );
  const after = cursor ? codec.open(cursor) : 0;
  const rows = (
    await db.query<{
      sequence: string;
      status: ImportJob["status"];
      created_at: Date;
    }>(
      `SELECT sequence,status,created_at FROM plugin_import_events
     WHERE job_id=$1 AND sequence > $2 ORDER BY sequence LIMIT 101`,
      [jobId, after],
    )
  ).rows;
  const page = rows.slice(0, 100);
  const sequence = page.length ? Number(page[page.length - 1].sequence) : after;
  const expiry = Math.min(
    retained.expires_at.getTime(),
    Date.now() + 3_600_000,
  );
  return pluginImportEventsSchema.parse({
    id: retained.id,
    status: producer.status,
    events: page.map((event) => ({
      sequence: event.sequence,
      status: event.status,
      created_at: event.created_at.toISOString(),
    })),
    cursor: codec.seal(sequence, expiry),
    has_more: rows.length > 100,
    ...(producer.status === "ready" && producer.doc_id
      ? {
          result: {
            id: `doc:${producer.doc_id}`,
            url: refs({ type: "doc", id: producer.doc_id }).url,
          },
        }
      : {}),
  });
}
