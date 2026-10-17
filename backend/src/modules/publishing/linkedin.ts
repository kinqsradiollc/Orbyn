import { z } from "zod";
import {
  fail,
  type PublishingConnection,
  type PublishingContent,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, type Db } from "../../db/pool.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";

export const connectionLock = 786269;
export const organization = () =>
  `urn:li:organization:${env.LINKEDIN_ORGANIZATION_ID}`;
export const redirectUri = () =>
  env.LINKEDIN_REDIRECT_URI ||
  new URL("/api/admin/publishing/linkedin/callback", env.APP_URL).href;
export function configured() {
  return !!(
    env.LINKEDIN_CLIENT_ID &&
    env.LINKEDIN_CLIENT_SECRET &&
    env.LINKEDIN_ORGANIZATION_ID &&
    env.DB_POOL_MAX >= 2
  );
}
export const tokenResult = z.object({
  access_token: z.string().min(1),
  expires_in: z
    .number()
    .positive()
    .max(366 * 86400),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z
    .number()
    .positive()
    .max(730 * 86400)
    .optional(),
});
export async function exchangeToken(
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  const response = await fetch(
    "https://www.linkedin.com/oauth/v2/accessToken",
    {
      method: "POST",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    },
  );
  if (!response.ok)
    fail(502, "LinkedIn sign-in expired or was refused. Connect again.");
  return tokenResult.parse(await response.json());
}
export function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Linkedin-Version": env.LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}
export async function linkedin(
  token: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch(`https://api.linkedin.com/rest/${path}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
    headers: headers(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    fail(
      502,
      `LinkedIn refused the request (${response.status}). Check Page access or reconnect.`,
    );
  return response;
}
/** Pagination never follows provider-supplied arbitrary URLs. */
export async function assertPageAdmin(token: string, signal?: AbortSignal) {
  for (let start = 0; start < 1000; start += 100) {
    const data = z
      .object({
        elements: z.array(
          z.object({
            organization: z.string().optional(),
            organizationTarget: z.string().optional(),
            role: z.string(),
            state: z.string(),
          }),
        ),
      })
      .parse(
        await (
          await linkedin(
            token,
            `organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100&start=${start}`,
            undefined,
            signal,
          )
        ).json(),
      );
    if (
      data.elements.some(
        (e) =>
          (e.organization ?? e.organizationTarget) === organization() &&
          e.role === "ADMINISTRATOR" &&
          e.state === "APPROVED",
      )
    )
      return;
    if (data.elements.length < 100) break;
  }
  fail(403, "Sign in with an administrator of the Orbyn company Page.");
}
export async function connectionView(): Promise<PublishingConnection> {
  const row = (
    await pool.query<{
      expires_at: string;
      renewable: boolean;
      organization: string;
      allowed: boolean;
    }>(
      `SELECT c.expires_at, c.organization, (c.refresh_encrypted IS NOT NULL AND c.refresh_expires_at>now()) AS renewable,
     (u.role='admin' AND NOT u.disabled) AS allowed FROM publishing_linkedin c JOIN users u ON u.id=c.owner_id`,
    )
  ).rows[0];
  return {
    configured: configured(),
    connected:
      configured() &&
      !!row?.allowed &&
      row.organization === organization() &&
      (new Date(row.expires_at).getTime() > Date.now() || row.renewable),
    expires_at: row?.expires_at ?? null,
    renewable: row?.renewable ?? false,
    organization: env.LINKEDIN_ORGANIZATION_ID ? organization() : null,
  };
}
/** Caller holds connectionLock through refresh and the outbound publication. */
export async function connectionToken(
  db: Db,
  signal?: AbortSignal,
): Promise<string> {
  const row = (
    await db.query<{
      token_encrypted: string;
      refresh_encrypted: string | null;
      expires_at: string;
      refresh_expires_at: string | null;
      organization: string;
      role: string;
      disabled: boolean;
    }>(
      "SELECT c.*,u.role,u.disabled FROM publishing_linkedin c JOIN users u ON u.id=c.owner_id ",
    )
  ).rows[0];
  if (
    !row ||
    row.disabled ||
    row.role !== "admin" ||
    row.organization !== organization()
  )
    fail(409, "Connect the Orbyn company Page first.");
  if (new Date(row.expires_at).getTime() > Date.now() + 120_000)
    return decryptSecret(row.token_encrypted);
  if (
    !row.refresh_encrypted ||
    !row.refresh_expires_at ||
    new Date(row.refresh_expires_at).getTime() <= Date.now()
  )
    fail(409, "LinkedIn permission expired. Connect again.");
  const tokens = await exchangeToken(
    {
      grant_type: "refresh_token",
      refresh_token: await decryptSecret(row.refresh_encrypted),
    },
    signal,
  );
  // Connection advisory lock is held by the caller; commit refresh independently of post delivery.
  await pool.query(
    `UPDATE publishing_linkedin SET token_encrypted=$1, expires_at=now()+make_interval(secs=>$2),
    refresh_encrypted=COALESCE($3,refresh_encrypted), refresh_expires_at=COALESCE(now()+make_interval(secs=>$4),refresh_expires_at)`,
    [
      await encryptSecret(tokens.access_token),
      tokens.expires_in,
      tokens.refresh_token ? await encryptSecret(tokens.refresh_token) : null,
      tokens.refresh_token_expires_in ?? null,
    ],
  );
  return tokens.access_token;
}
export async function uploadImage(
  token: string,
  content: PublishingContent,
  signal?: AbortSignal,
) {
  if (!content.image) return null;
  const initialized = z
    .object({
      value: z.object({
        uploadUrl: z.url(),
        image: z.string().regex(/^urn:li:image:[\w-]+$/),
      }),
    })
    .parse(
      await (
        await linkedin(
          token,
          "images?action=initializeUpload",
          {
            initializeUploadRequest: { owner: organization() },
          },
          signal,
        )
      ).json(),
    ).value;
  const url = new URL(initialized.uploadUrl);
  // Upload credentials must never follow redirects or leave LinkedIn's upload host.
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.linkedin.com" ||
    !url.pathname.startsWith("/dms-uploads/") ||
    url.port ||
    url.username ||
    url.password
  )
    fail(502, "LinkedIn returned an unsupported upload address.");
  const result = await fetch(url, {
    method: "PUT",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
    body: Buffer.from(content.image.split(",")[1], "base64"),
  });
  if (!result.ok) fail(502, "LinkedIn could not upload the image.");
  for (let attempt = 0; attempt < 8; attempt++) {
    const image = z
      .object({ status: z.string() })
      .parse(
        await (
          await linkedin(
            token,
            `images/${encodeURIComponent(initialized.image)}`,
            undefined,
            signal,
          )
        ).json(),
      );
    if (image.status === "AVAILABLE") return initialized.image;
    if (image.status === "PROCESSING_FAILED") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(
    502,
    "LinkedIn has not finished processing the image. Try publishing again later.",
  );
}
