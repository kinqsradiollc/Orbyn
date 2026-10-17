import {
  fail,
  HttpError,
  publishingContent,
  type PublishingDraft,
} from "@orbyn/core";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { audit } from "../../lib/audit.js";
import {
  connectionLock,
  connectionToken,
  assertPageAdmin,
  uploadImage,
  headers,
  organization,
} from "./linkedin.js";

export const draftColumns =
  "id,version,content,state,scheduled_at,post_urn,error,release,updated_at";
export async function draft(
  id: string,
  db: Queryable = pool,
): Promise<PublishingDraft> {
  const row = (
    await db.query<PublishingDraft>(
      `SELECT ${draftColumns} FROM publishing_drafts WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Draft not found.");
  return row;
}
export function validateImage(image: string | null) {
  if (!image) return;
  const bytes = Buffer.from(image.split(",")[1], "base64");
  if (
    bytes.length > 2_000_000 ||
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.subarray(12, 16).toString() !== "IHDR"
  )
    fail(422, "Use a PNG image smaller than 2 MB.");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16_000_000
  )
    fail(422, "Use an image up to 4096 pixels per side.");
}
/** One durable, explicitly approved delivery. Unknown outcomes are never automatically retried. */
export async function deliverPublishingOne() {
  if (env.DB_POOL_MAX < 2) {
    await pool.query(
      "UPDATE publishing_drafts SET state='failed',error='Publishing requires DB_POOL_MAX of at least 2.',version=version+1 WHERE state='scheduled' AND scheduled_at<=now()",
    );
    return false;
  }
  let claim: { id: string; approved_by: string | null } | null = null;
  let sent = false;
  try {
    return await transaction(async (db) => {
      // Transaction-scoped locks work through PgBouncer's transaction pooling.
      const acquired = (
        await db.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock($1) AS locked",
          [connectionLock],
        )
      ).rows[0].locked;
      if (!acquired) return false;
      await pool.query(`UPDATE publishing_drafts SET state='unknown',error='Delivery was interrupted. Check the company Page before trying again.',version=version+1
        WHERE state='sending' AND sending_at<now()-interval '5 minutes'`);
      // The durable claim commits independently before any external side effect.
      claim = await transaction(async (claimDb) => {
        const row = (
          await claimDb.query<{ id: string; approved_by: string | null }>(
            `SELECT id,approved_by FROM publishing_drafts WHERE state='scheduled' AND scheduled_at<=now() ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1`,
          )
        ).rows[0];
        if (!row) return null;
        await claimDb.query(
          "UPDATE publishing_drafts SET state='sending',sending_at=now(),version=version+1 WHERE id=$1",
          [row.id],
        );
        return row;
      });
      if (!claim) return false;
      const signal = AbortSignal.timeout(120_000);
      const user = (
        await db.query<{ role: string; disabled: boolean }>(
          "SELECT role,disabled FROM users WHERE id=$1",
          [claim.approved_by],
        )
      ).rows[0];
      if (user?.role !== "admin" || user.disabled)
        fail(403, "The approving admin no longer has publishing access.");
      const row = await draft(claim.id, db);
      const content = publishingContent.parse(row.content);
      const token = await connectionToken(db, signal);
      await assertPageAdmin(token, signal);
      const image = await uploadImage(token, content, signal);
      signal.throwIfAborted();
      sent = true;
      const response = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
        headers: headers(token),
        body: JSON.stringify({
          author: organization(),
          commentary: content.commentary,
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
          ...(image
            ? { content: { media: { id: image, altText: content.alt_text } } }
            : {}),
        }),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) sent = false;
        fail(502, `LinkedIn refused publication (${response.status}).`);
      }
      const urn = response.headers.get("x-restli-id");
      if (!urn || !/^urn:li:(share|ugcPost):\d+$/.test(urn))
        fail(502, "LinkedIn did not return a publication receipt.");
      await db.query(
        "UPDATE publishing_drafts SET state='published',post_urn=$2,error=NULL,version=version+1,updated_at=now() WHERE id=$1 AND state='sending'",
        [claim.id, urn],
      );
      await audit(
        {
          actorId: claim.approved_by,
          action: "publishing.linkedin_published",
          targetType: "system",
          targetId: claim.id,
          details: { post_urn: urn },
        },
        db,
      );
      return true;
    });
  } catch (error) {
    // Assignment inside the transaction closure is deliberately visible on rollback.
    const failed = claim as { id: string } | null;
    if (!failed) return false;
    await pool.query(
      "UPDATE publishing_drafts SET state=$2,error=$3,version=version+1,updated_at=now() WHERE id=$1 AND state='sending'",
      [
        failed.id,
        sent ? "unknown" : "failed",
        sent
          ? "No confirmed receipt. Check the company Page before trying again."
          : error instanceof HttpError
            ? error.message
            : "Could not publish. Check LinkedIn permission and image, then try again.",
      ],
    );
    return true;
  }
}
