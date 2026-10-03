import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Principal } from "../../capabilities/policy.js";
import { CapabilityError } from "../../capabilities/registry.js";
import { derivedKey } from "../../lib/secrets.js";

const MAX_AGE_MS = 3_600_000;
const MAX_CURSOR_LENGTH = 512;
let keyLoad: Promise<Buffer> | null = null;

/** Load outside read-only transactions; the shared key may need database initialization. */
export function pluginJobCursorKey(): Promise<Buffer> {
  keyLoad ??= derivedKey("plugin-job-cursor-v1").catch((error) => {
    keyLoad = null;
    throw error;
  });
  return keyLoad;
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};

const invalid = () =>
  new CapabilityError(
    "INVALID",
    "This job cursor is unavailable. Start again without a cursor.",
  );

/**
 * Reconnect position for one plugin job under its current authority. This verifies
 * position/integrity only: callers must resolve live OAuth and recheck the job and
 * all source visibility before returning events or stored results.
 */
export function pluginJobCursor(
  principal: Principal,
  binding: { resource: string; jobId: string; sourceRevision: string },
  key: Buffer,
  now: () => number = Date.now,
) {
  if (
    principal.via !== "plugin" ||
    !principal.grant_id ||
    !principal.client.id ||
    key.length !== 32 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      binding.jobId,
    ) ||
    !binding.sourceRevision ||
    binding.sourceRevision.length > 128 ||
    binding.resource.length > 2048
  )
    throw invalid();
  let resource: URL;
  try {
    resource = new URL(binding.resource);
    if (
      !/^https?:$/.test(resource.protocol) ||
      resource.username ||
      resource.password ||
      resource.hash ||
      resource.search
    )
      throw invalid();
  } catch {
    throw invalid();
  }
  const authority = {
    resource: resource.href,
    job: binding.jobId.toLowerCase(),
    sources: binding.sourceRevision,
    owner: principal.user.id,
    client: principal.client.id,
    grant: principal.grant_id,
    access: principal.access,
    personal: principal.personal,
    teamIds:
      principal.team_ids === null ? null : [...principal.team_ids].sort(),
    teams: principal.teams
      .map(({ id, role, agent_access }) => ({ id, role, agent_access }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    toolsets: [...principal.toolsets].sort(),
    flags: principal.flags,
    trust: {
      ...principal.trust,
      acts_alone: [...principal.trust.acts_alone].sort(),
    },
  };
  const context = createHash("sha256")
    .update(JSON.stringify(canonical(authority)))
    .digest("base64url");
  const sign = (payload: string) =>
    createHmac("sha256", key)
      .update(`pj1.${context}.${payload}`)
      .digest("base64url");
  return {
    seal(sequence: number, expiresAt: number) {
      const time = now();
      if (
        !Number.isSafeInteger(sequence) ||
        sequence < 0 ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= time ||
        expiresAt > time + MAX_AGE_MS
      )
        throw invalid();
      const payload = Buffer.from(
        JSON.stringify({ sequence, expiresAt }),
      ).toString("base64url");
      return `pj1.${payload}.${sign(payload)}`;
    },
    open(cursor: string) {
      if (typeof cursor !== "string" || cursor.length > MAX_CURSOR_LENGTH)
        throw invalid();
      const match = /^pj1\.([A-Za-z0-9_-]{1,256})\.([A-Za-z0-9_-]{43})$/.exec(
        cursor,
      );
      if (!match) throw invalid();
      const expected = Buffer.from(sign(match[1]));
      const actual = Buffer.from(match[2]);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw invalid();
      let value: { sequence: number; expiresAt: number };
      try {
        value = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
      } catch {
        throw invalid();
      }
      if (
        !value ||
        Object.keys(value).length !== 2 ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence < 0 ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= now() ||
        value.expiresAt > now() + MAX_AGE_MS
      )
        throw invalid();
      return value.sequence;
    },
  };
}
