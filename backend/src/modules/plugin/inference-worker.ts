import { transaction } from "../../db/pool.js";
import { settings } from "../../lib/settings.js";
import { CapabilityError } from "../../capabilities/registry.js";
import type { ConnectorResources } from "../oauth/resources.js";
import { connection } from "../ai/providers/resolve.js";
import type { complete } from "../ai/providers/adapters.js";
import { callPluginManagedProvider } from "./provider-policy.js";
import {
  claimPluginAi,
  finishPluginAi,
  loadRunAuthority,
  markPluginAiUnknown,
} from "./inference-broker.js";

/** One durably claimed operation; no first-party provider resolver or retry path. */
export async function processPluginAi(
  resources: ConnectorResources,
  options: { signal?: AbortSignal; send?: typeof complete } = {},
) {
  const claim = await claimPluginAi(resources);
  if (!claim) return false;
  const { run, principal, permission, provider } = claim;
  try {
    const ai = await connection(provider, run.model);
    const assertFresh = async () => {
      const live = await settings();
      await transaction(async (db) => {
        await loadRunAuthority(db, run, resources, live);
        const current = await db.query(
          "SELECT id FROM plugin_ai_runs WHERE id=$1 AND state='running' AND claim_token=$2 AND lease_until>clock_timestamp() FOR SHARE",
          [run.id, run.claim_token],
        );
        if (!current.rowCount)
          throw new CapabilityError(
            "STALE",
            "The inference claim expired or changed.",
          );
      });
    };
    const result = await callPluginManagedProvider(
      principal,
      permission,
      ai,
      { operation_id: run.operation_id, prompt: run.prompt },
      assertFresh,
      options,
    );
    await finishPluginAi(run, resources, result.text);
  } catch {
    // Admission is already durable. Even a failure before a response cannot
    // prove the upstream did not charge; preserve the reservation and receipt.
    await markPluginAiUnknown(run);
  }
  return true;
}

/** Dedicated plugin process only. Persisted leases recover as unknown, never replay. */
export function startPluginAiWorker(
  resources: ConnectorResources,
  report: (error: unknown) => void,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pulse = async () => {
    try {
      if (!controller.signal.aborted)
        await processPluginAi(resources, { signal: controller.signal });
    } catch (error) {
      report(error);
    }
    if (!controller.signal.aborted) {
      timer = setTimeout(pulse, 2000);
      timer.unref();
    }
  };
  if (resources.plugin) {
    timer = setTimeout(pulse, 0);
    timer.unref();
  }
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
