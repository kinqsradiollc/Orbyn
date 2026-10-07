import { managedAiAuthority, type ManagedAiAuthority } from "@orbyn/core";
import type { Queryable } from "../../../db/pool.js";
import { ProviderError } from "./adapters.js";
import type { ProviderRow } from "./resolve.js";

/** Configuration identity only. Provider secrets never enter queued authority. */
export const managedAiSnapshot = managedAiAuthority;
export type ManagedAiSnapshot = ManagedAiAuthority;

/** A stale or unprovable managed selection never adopts the current default. */
export function changedManagedAuthority(): never {
  throw new ProviderError(
    "provider_changed",
    "The captured workspace provider or model changed. Start a fresh request.",
  );
}

/** Settings then provider locks match enqueue order and prevent mixed identities. */
export async function readManagedSelection(db: Queryable): Promise<{
  snapshot: ManagedAiSnapshot;
  provider: ProviderRow | null;
}> {
  const selection = (
    await db.query<{
      provider_id: string | null;
      model: string;
      revision: string;
    }>(
      "SELECT provider_id,model,generation_revision::text AS revision FROM ai_settings WHERE id FOR SHARE",
    )
  ).rows[0];
  const snapshot: ManagedAiSnapshot = {
    version: 1,
    selection_revision: selection?.revision ?? "0",
    provider: null,
  };
  if (!selection?.provider_id || !selection.model)
    return { snapshot, provider: null };
  const row = (
    await db.query<ProviderRow & { generation_revision: string }>(
      "SELECT *,extract(epoch from updated_at)::text AS provider_revision FROM ai_providers WHERE id=$1 FOR SHARE",
      [selection.provider_id],
    )
  ).rows[0];
  if (!row?.enabled) return { snapshot, provider: null };
  snapshot.provider = {
    id: row.id,
    revision: String(row.generation_revision),
    model: selection.model,
  };
  return { snapshot: managedAiSnapshot.parse(snapshot), provider: row };
}

/** Compare the entire immutable generation, including selection round trips. */
export function assertManagedSelection(
  captured: ManagedAiSnapshot,
  live: ManagedAiSnapshot,
): void {
  const before = managedAiSnapshot.safeParse(captured);
  const current = managedAiSnapshot.safeParse(live);
  if (
    !before.success ||
    !current.success ||
    JSON.stringify(before.data) !== JSON.stringify(current.data)
  )
    changedManagedAuthority();
}

/** An older job has no proof of its original managed provider/model. */
export async function readJobManagedSnapshot(
  db: Queryable,
  owner: string,
  jobId: string,
): Promise<ManagedAiSnapshot> {
  const row = (
    await db.query<{ managed_provider_snapshot: unknown }>(
      "SELECT managed_provider_snapshot FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR SHARE",
      [jobId, owner],
    )
  ).rows[0];
  const parsed = managedAiSnapshot.safeParse(row?.managed_provider_snapshot);
  if (!parsed.success)
    throw new ProviderError(
      "managed_authority_unverified",
      "This run has no verified enqueue-time workspace provider or model. Start a fresh request.",
    );
  return parsed.data;
}
