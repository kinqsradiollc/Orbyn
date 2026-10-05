import { createHash, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import type { Principal } from "../../capabilities/policy.js";
import { CapabilityError } from "../../capabilities/registry.js";
import {
  GRANT_SELECT,
  type GrantRow,
} from "../../capabilities/connector-principal.js";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { settings, type LiveSettings } from "../../lib/settings.js";
import { digest } from "../../lib/auth.js";
import type { ConnectorResources } from "../oauth/resources.js";
import { pluginPrincipalFromGrant, PluginAuthError } from "./auth.js";
import { PluginCallError } from "./dispatch.js";
import {
  pluginManagedPermission,
  pluginInferenceInput,
  assertNewPluginOperation,
  type PluginManagedPermission,
} from "./provider-policy.js";
import type { ProviderRow } from "../ai/providers/resolve.js";
import { pluginJobCursor } from "./job-cursor.js";

export const pluginAiState = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "unknown",
]);
export type PluginAiRun = {
  id: string;
  grant_id: string;
  operation_id: string;
  permission_version: number;
  provider_id: string;
  provider_revision: string;
  model: string;
  max_output_tokens: number;
  prompt: string;
  prompt_digest: string;
  token_hash: string;
  authority_digest: string;
  state: z.output<typeof pluginAiState>;
  claim_token: string | null;
  lease_until: Date | null;
  result: string | null;
  created_at: Date;
  expires_at: Date;
};
const unavailable = () =>
  new CapabilityError("NOT_FOUND", "This plugin AI request is unavailable.");
const stale = () =>
  new CapabilityError(
    "STALE",
    "Plugin AI permission or provider changed. Review the current configuration.",
  );
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
/** Stable authority identity includes live scopes, team policy and trust, without credentials. */
export function pluginAuthorityDigest(p: Principal) {
  return sha(
    JSON.stringify(
      canonical({
        ...p,
        team_ids: p.team_ids && [...p.team_ids].sort(),
        toolsets: [...p.toolsets].sort(),
        teams: [...p.teams].sort((a, b) => a.id.localeCompare(b.id)),
        trust: { ...p.trust, acts_alone: [...p.trust.acts_alone].sort() },
      }),
    ),
  );
}
export const pluginAiReceipt = z
  .object({
    id: z.uuid(),
    operation_id: z.uuid(),
    state: pluginAiState,
    provider_id: z.uuid(),
    model: z.string().min(1).max(256),
    created_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
  })
  .strict();
export function receipt(run: PluginAiRun) {
  return pluginAiReceipt.parse({
    id: run.id,
    operation_id: run.operation_id,
    state: run.state,
    provider_id: run.provider_id,
    model: run.model,
    created_at: run.created_at.toISOString(),
    expires_at: run.expires_at.toISOString(),
  });
}

/** Current consent and fixed managed configuration, under the caller's grant lock. */
export async function pluginAiSnapshot(db: Queryable, p: Principal) {
  if (p.via !== "plugin" || !p.grant_id || !p.client.id) throw unavailable();
  const permission = (
    await db.query<any>(
      `SELECT a.*,g.user_id,g.client_id FROM plugin_ai_permissions a JOIN agent_grants g ON g.id=a.grant_id WHERE a.grant_id=$1 FOR SHARE OF a`,
      [p.grant_id],
    )
  ).rows[0];
  if (
    !permission?.enabled ||
    permission.user_id !== p.user.id ||
    permission.client_id !== p.client.id
  )
    throw new CapabilityError(
      "FORBIDDEN",
      "The owner has not permitted workspace AI for this plugin.",
    );
  const captured = pluginManagedPermission.parse({
    user_id: permission.user_id,
    grant_id: p.grant_id,
    client_id: p.client.id,
    enabled: true,
    version: permission.version,
    provider_id: permission.provider_id,
    provider_revision: permission.provider_revision,
    model: permission.model,
    max_output_tokens: permission.max_output_tokens,
    daily_call_limit: permission.daily_call_limit,
  });
  const provider = (
    await db.query<ProviderRow>(
      `SELECT p.*,extract(epoch from p.updated_at)::text AS provider_revision FROM ai_settings s JOIN ai_providers p ON p.id=s.provider_id WHERE s.id AND p.enabled AND p.id=$1 AND s.model=$2 AND extract(epoch from p.updated_at)::text=$3 FOR SHARE OF p,s`,
      [captured.provider_id, captured.model, captured.provider_revision],
    )
  ).rows[0];
  if (!provider) throw stale();
  return { permission: captured, provider };
}

/** Atomic receipt and allowance reservation. Requires fresh pluginWrite authority. */
export async function enqueuePluginAi(
  db: Queryable,
  p: Principal,
  bearer: string,
  value: unknown,
) {
  const input = pluginInferenceInput.parse(value);
  const { permission } = await pluginAiSnapshot(db, p);
  // The surrounding transaction holds the grant exclusively; serialize all
  // versions of its daily reservation rather than resetting allowance on CAS.
  await db.query(
    "SELECT grant_id FROM plugin_ai_permissions WHERE grant_id=$1 FOR UPDATE",
    [p.grant_id],
  );
  const previous = (
    await db.query<PluginAiRun>(
      "SELECT * FROM plugin_ai_runs WHERE grant_id=$1 AND operation_id=$2 AND expires_at>clock_timestamp()",
      [p.grant_id, input.operation_id],
    )
  ).rows[0];
  if (previous) {
    if (previous.prompt_digest !== sha(input.prompt))
      throw new CapabilityError(
        "STALE",
        "This operation ID was used for different text.",
      );
    await assertRunSnapshot(db, p, previous);
    return receipt(previous);
  }
  assertNewPluginOperation(input.operation_id);
  const count = Number(
    (
      await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM plugin_ai_runs WHERE grant_id=$1 AND reserved_day=(clock_timestamp() AT TIME ZONE 'UTC')::date AND (state<>'failed' OR claim_token IS NOT NULL)`,
        [p.grant_id],
      )
    ).rows[0].n,
  );
  if (count >= permission.daily_call_limit)
    throw new PluginCallError(429, {
      error: "LIMITED",
      message: "This plugin's daily workspace AI allowance is used.",
    });
  const token = bearer.match(/^Bearer (oat_\S+)$/)?.[1];
  if (!token) throw unavailable();
  const run = (
    await db.query<PluginAiRun>(
      `INSERT INTO plugin_ai_runs(grant_id,operation_id,permission_version,provider_id,provider_revision,model,max_output_tokens,prompt,prompt_digest,token_hash,authority_digest,reserved_day)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,(clock_timestamp() AT TIME ZONE 'UTC')::date) RETURNING *`,
      [
        p.grant_id,
        input.operation_id,
        permission.version,
        permission.provider_id,
        permission.provider_revision,
        permission.model,
        permission.max_output_tokens,
        input.prompt,
        sha(input.prompt),
        digest(token),
        pluginAuthorityDigest(p),
      ],
    )
  ).rows[0];
  return receipt(run);
}

/** Never expose a result under changed connector, consent, model or provider authority. */
export async function assertRunSnapshot(
  db: Queryable,
  p: Principal,
  run: PluginAiRun,
) {
  if (
    run.grant_id !== p.grant_id ||
    run.expires_at.getTime() <= Date.now() ||
    run.authority_digest !== pluginAuthorityDigest(p)
  )
    throw unavailable();
  const snapshot = await pluginAiSnapshot(db, p);
  const permission = snapshot.permission;
  if (
    permission.version !== run.permission_version ||
    permission.provider_id !== run.provider_id ||
    permission.provider_revision !== run.provider_revision ||
    permission.model !== run.model ||
    permission.max_output_tokens !== run.max_output_tokens
  )
    throw stale();
  return snapshot;
}

/** Resolve the retained token hash with the same live recipient checks; never store the bearer. */
export async function loadRunAuthority(
  db: Queryable,
  run: PluginAiRun,
  resources: ConnectorResources,
  live: LiveSettings,
) {
  if (!resources.plugin || live.maintenance.enabled) throw unavailable();
  await db.query("SELECT id FROM agent_grants WHERE id=$1 FOR SHARE", [
    run.grant_id,
  ]);
  await db.query(
    "SELECT token_hash FROM agent_tokens WHERE token_hash=$1 AND grant_id=$2 FOR SHARE",
    [run.token_hash, run.grant_id],
  );
  const row = (
    await db.query<GrantRow>(
      `${GRANT_SELECT} WHERE t.token_hash=$1 AND t.kind='access' AND g.id=$2`,
      [run.token_hash, run.grant_id],
    )
  ).rows[0];
  if (!row) throw unavailable();
  await db.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [row.user_id]);
  await db.query("SELECT id FROM oauth_clients WHERE id=$1 FOR SHARE", [
    row.client_id,
  ]);
  await db.query(
    "SELECT m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.user_id=$1 FOR SHARE OF m,t",
    [row.user_id],
  );
  const freshRow = (
    await db.query<GrantRow>(
      `${GRANT_SELECT} WHERE t.token_hash=$1 AND t.kind='access' AND g.id=$2`,
      [run.token_hash, run.grant_id],
    )
  ).rows[0];
  const principal = (
    await pluginPrincipalFromGrant(freshRow, live, resources.plugin, db)
  ).principal;
  return { principal, ...(await assertRunSnapshot(db, principal, run)) };
}

/** Serialized cross-process admission. A persisted running call is never reclaimed. */
export async function claimPluginAi(resources: ConnectorResources) {
  const live = await settings();
  if (
    !resources.plugin ||
    live.maintenance.enabled ||
    !live.agents.agents_enabled
  )
    return null;
  // Recover expired receipts in a separate statement: never retain a job lock
  // while acquiring its grant, since owner revocation locks grant before jobs.
  await pool.query(
    "UPDATE plugin_ai_runs SET state='unknown',failure='The prior call outcome is unknown.',updated_at=clock_timestamp() WHERE state='running' AND lease_until<=clock_timestamp()",
  );
  return transaction(async (db) => {
    const admitted = (
      await db.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_xact_lock(786242) AS ok",
      )
    ).rows[0].ok;
    if (!admitted) return null;
    const n = Number(
      (
        await db.query<{ n: string }>(
          "SELECT count(*) AS n FROM plugin_ai_runs WHERE state='running' AND lease_until>clock_timestamp()",
        )
      ).rows[0].n,
    );
    if (n >= 2) return null;
    const candidate = (
      await db.query<PluginAiRun>(
        "SELECT * FROM plugin_ai_runs WHERE state='queued' AND expires_at>clock_timestamp() ORDER BY created_at,id LIMIT 1",
      )
    ).rows[0];
    if (!candidate) return null;
    const grant = await db.query(
      "SELECT id FROM agent_grants WHERE id=$1 FOR UPDATE SKIP LOCKED",
      [candidate.grant_id],
    );
    if (!grant.rowCount) return null;
    const run = (
      await db.query<PluginAiRun>(
        "SELECT * FROM plugin_ai_runs WHERE id=$1 AND state='queued' FOR UPDATE",
        [candidate.id],
      )
    ).rows[0];
    if (!run) return null;
    try {
      const fresh = await loadRunAuthority(db, run, resources, live);
      assertNewPluginOperation(run.operation_id);
      const claimed = (
        await db.query<PluginAiRun>(
          "UPDATE plugin_ai_runs SET state='running',claim_token=$2,lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp() WHERE id=$1 AND state='queued' RETURNING *",
          [run.id, randomUUID()],
        )
      ).rows[0];
      return { run: claimed, ...fresh };
    } catch (error) {
      // SQL/transport faults abort the transaction; only domain refusals are
      // safely known to have happened before any provider dispatch.
      if (
        !(error instanceof CapabilityError) &&
        !(error instanceof PluginAuthError) &&
        !(error instanceof ZodError)
      )
        throw error;
      await db.query(
        "UPDATE plugin_ai_runs SET state='failed',failure='Permission or provider unavailable before dispatch.',updated_at=clock_timestamp() WHERE id=$1 AND state='queued'",
        [run.id],
      );
      return null;
    }
  });
}

/** Current private events/result for reconnecting plugin clients. */
export async function readPluginAiEvents(
  db: Queryable,
  p: Principal,
  id: string,
  resource: string,
  key: Buffer,
  value?: string,
) {
  const run = (
    await db.query<PluginAiRun>(
      "SELECT * FROM plugin_ai_runs WHERE id=$1 AND grant_id=$2 AND expires_at>clock_timestamp() FOR SHARE",
      [id, p.grant_id],
    )
  ).rows[0];
  if (!run) throw unavailable();
  await assertRunSnapshot(db, p, run);
  const cursor = pluginJobCursor(
    p,
    {
      resource,
      jobId: id,
      sourceRevision: sha(
        `${run.permission_version}:${run.provider_revision}:${run.model}:${run.authority_digest}`,
      ),
    },
    key,
  );
  const after = value ? cursor.open(value) : 0;
  const events = (
    await db.query<{ sequence: string; state: string; created_at: Date }>(
      "SELECT sequence,state,created_at FROM plugin_ai_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101",
      [id, after],
    )
  ).rows;
  const page = events.slice(0, 100);
  const sequence = page.length ? Number(page.at(-1)!.sequence) : after;
  return {
    ...receipt(run),
    events: page.map((event) => ({
      sequence: event.sequence,
      state: pluginAiState.parse(event.state),
      created_at: event.created_at.toISOString(),
    })),
    cursor: cursor.seal(
      sequence,
      Math.min(Date.now() + 3600000, run.expires_at.getTime()),
    ),
    has_more: events.length > 100,
    ...(run.state === "done" ? { text: run.result } : {}),
  };
}

/** Accepted completion is atomic with live authority and an unexpired claim. */
export async function finishPluginAi(
  run: PluginAiRun,
  resources: ConnectorResources,
  result: string,
) {
  const live = await settings();
  return transaction(async (db) => {
    await loadRunAuthority(db, run, resources, live);
    const accepted = await db.query(
      "UPDATE plugin_ai_runs SET state='done',result=$3,updated_at=clock_timestamp() WHERE id=$1 AND claim_token=$2 AND state='running' AND lease_until>clock_timestamp()",
      [run.id, run.claim_token, result],
    );
    if (!accepted.rowCount) throw stale();
  });
}
export async function markPluginAiUnknown(run: PluginAiRun) {
  await pool.query(
    "UPDATE plugin_ai_runs SET state='unknown',failure='The call did not produce an accepted result; its outcome is unknown.',updated_at=clock_timestamp() WHERE id=$1 AND claim_token=$2 AND state='running'",
    [run.id, run.claim_token],
  );
}
