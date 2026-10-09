import { throwIfAborted } from "./abort.js";
import {
  chatgptModelBinding,
  chatgptExecutorEnrolled,
  chatgptExecutorLease,
  chatgptExecutorCatalog,
  chatgptCatalogReceipt,
  chatgptInferenceAssignment,
  chatgptInferenceResult,
  type ChatgptInferenceAssignment,
  type ChatgptModelBinding,
  type ChatgptModel,
  type ChatgptExecutorDevice,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
import type { ChatgptExecutorSigner } from "./chatgpt-executor-signer.js";

/** Credential-free executor lifecycle; optional inference is owned by the local provider adapter. */
export function createChatgptExecutorLifecycle(options: {
  binding: ChatgptModelBinding;
  client: Pick<
    OrbynClient,
    | "beginChatgptExecutor"
    | "finishChatgptExecutor"
    | "beginChatgptExecutorLease"
    | "finishChatgptExecutorLease"
    | "renewChatgptExecutorLease"
    | "publishChatgptModels"
  >;
  signer: ChatgptExecutorSigner;
  device?: ChatgptExecutorDevice;
  models: (signal: AbortSignal) => Promise<ChatgptModel[]>;
  requireLiveConnection: () => Promise<void>;
  /** Only lease renewal may accept a locally verified refresh in progress. */
  requireHeartbeatConnection?: () => Promise<void>;
  /** Supplied only by a local credential-owning runtime with a working provider adapter. */
  inference?: {
    client: Pick<
      OrbynClient,
      "claimChatgptInference" | "finishChatgptInference"
    >;
    digest: (message: string) => Promise<string>;
    complete: (
      assignment: ChatgptInferenceAssignment,
      signal: AbortSignal,
    ) => Promise<unknown>;
  };
}) {
  const binding = Object.freeze(chatgptModelBinding.parse(options.binding));
  let enrollment: ReturnType<typeof chatgptExecutorEnrolled.parse> | null =
    null;
  let lease: ReturnType<typeof chatgptExecutorLease.parse> | null = null;
  let executing = false;
  let closed = false,
    heartbeatSequence = 0,
    catalogSequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const lifetime = new AbortController();
  const same = (value: unknown) =>
    JSON.stringify(value) === JSON.stringify(binding);
  const live = async (signal: AbortSignal, heartbeat = false) => {
    throwIfAborted(signal);
    if (closed) throw new Error("The ChatGPT executor was stopped.");
    await (heartbeat && options.requireHeartbeatConnection
      ? options.requireHeartbeatConnection()
      : options.requireLiveConnection());
    throwIfAborted(signal);
    if (closed) throw new Error("The ChatGPT executor was stopped.");
  };
  const ordered = <T>(
    work: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
    heartbeat = false,
  ): Promise<T> => {
    const execute = async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      lifetime.signal.addEventListener("abort", abort, { once: true });
      external?.addEventListener("abort", abort, { once: true });
      if (lifetime.signal.aborted || external?.aborted) abort();
      const timer = setTimeout(abort, 30000);
      try {
        await live(controller.signal, heartbeat);
        return await work(controller.signal);
      } finally {
        clearTimeout(timer);
        lifetime.signal.removeEventListener("abort", abort);
        external?.removeEventListener("abort", abort);
      }
    };
    const result = tail.catch(() => {}).then(execute);
    tail = result.catch(() => {});
    return result;
  };
  const currentLease = () => {
    if (!lease || !enrollment || Date.parse(lease.expires_at) <= Date.now())
      throw new Error("The ChatGPT executor lease expired. Reconnect it.");
    return lease;
  };
  const validateLease = (value: unknown) => {
    const next = chatgptExecutorLease.parse(value);
    if (
      !enrollment ||
      next.executor_id !== enrollment.id ||
      !same(next.binding) ||
      next.enrollment_epoch !== enrollment.enrollment_epoch ||
      Date.parse(next.expires_at) <= Date.now()
    )
      throw new Error("The ChatGPT executor lease changed.");
    return next;
  };
  const publish = async (signal: AbortSignal) => {
    await live(signal);
    const captured = currentLease();
    const models = await options.models(signal);
    await live(signal);
    currentLease();
    const catalog = chatgptExecutorCatalog.parse({
      executor_id: captured.executor_id,
      binding,
      lease_epoch: captured.lease_epoch,
      sequence: ++catalogSequence,
      models,
      ...(options.inference ? { capabilities: ["plan_inference_v1"] } : {}),
    });
    const signed = await options.signer.signCatalog(catalog);
    await live(signal);
    currentLease();
    const receipt = chatgptCatalogReceipt.parse(
      await options.client.publishChatgptModels(signed, signal),
    );
    await live(signal);
    currentLease();
    if (
      receipt.executor_id !== catalog.executor_id ||
      receipt.lease_epoch !== catalog.lease_epoch ||
      receipt.sequence !== catalog.sequence
    )
      throw new Error("The ChatGPT catalog receipt changed.");
    return receipt;
  };
  const bounded = async <T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeout: number,
    external?: AbortSignal,
  ): Promise<T> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    lifetime.signal.addEventListener("abort", abort, { once: true });
    external?.addEventListener("abort", abort, { once: true });
    if (lifetime.signal.aborted || external?.aborted) abort();
    const timer = setTimeout(abort, timeout);
    let rejectAbort: (() => void) | undefined;
    try {
      throwIfAborted(controller.signal);
      const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = () =>
          reject(new Error("The inference operation was interrupted."));
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
      });
      return await Promise.race([work(controller.signal), cancelled]);
    } finally {
      clearTimeout(timer);
      lifetime.signal.removeEventListener("abort", abort);
      external?.removeEventListener("abort", abort);
      if (rejectAbort)
        controller.signal.removeEventListener("abort", rejectAbort);
    }
  };
  const assignedLease = (assignment: ChatgptInferenceAssignment) => {
    const current = currentLease();
    if (
      !same(assignment.binding) ||
      assignment.executor_id !== current.executor_id ||
      assignment.enrollment_epoch !== current.enrollment_epoch ||
      assignment.lease_epoch !== current.lease_epoch ||
      Date.parse(assignment.expires_at) <= Date.now()
    )
      throw new Error("The inference assignment changed.");
  };
  return {
    /** One server-owned assignment at a time; lease renewal remains independent of inference. */
    async executeNext(signal?: AbortSignal) {
      if (executing) return { processed: false };
      if (!options.inference)
        throw new Error("The inference runtime is unavailable.");
      const adapter = options.inference;
      executing = true;
      try {
        const assignment = await bounded(
          async (signal) => {
            await live(signal);
            const captured = currentLease();
            const value = await adapter.client.claimChatgptInference(
              captured.executor_id,
              signal,
            );
            await live(signal);
            if (value === null) return null;
            const parsed = chatgptInferenceAssignment.parse(value);
            assignedLease(parsed);
            const hash = await adapter.digest(
              JSON.stringify({
                binding: parsed.binding,
                model: parsed.model,
                payload: parsed.payload,
                job_id: parsed.job_id,
              }),
            );
            await live(signal);
            assignedLease(parsed);
            if (!/^[a-f0-9]{64}$/.test(hash) || hash !== parsed.request_hash)
              throw new Error("The inference input changed.");
            return parsed;
          },
          30000,
          signal,
        );
        if (!assignment) return { processed: false };
        const result = await bounded(
          async (signal) => {
            await live(signal);
            assignedLease(assignment);
            const value = chatgptInferenceResult.parse(
              await adapter.complete(assignment, signal),
            );
            await live(signal);
            assignedLease(assignment);
            return value;
          },
          Math.max(
            1,
            Math.min(120000, Date.parse(assignment.expires_at) - Date.now()),
          ),
          signal,
        );
        await bounded(
          async (signal) => {
            await live(signal);
            assignedLease(assignment);
            const publication = await options.signer.signInference({
              request_id: assignment.id,
              executor_id: assignment.executor_id,
              binding: assignment.binding,
              enrollment_epoch: assignment.enrollment_epoch,
              lease_epoch: assignment.lease_epoch,
              model: assignment.model,
              nonce: assignment.nonce,
              request_hash: assignment.request_hash,
              result,
            });
            await live(signal);
            assignedLease(assignment);
            await adapter.client.finishChatgptInference(publication, signal);
            await live(signal);
          },
          30000,
          signal,
        );
        return { processed: true };
      } finally {
        executing = false;
      }
    },
    start(signal?: AbortSignal) {
      return ordered(async (signal) => {
        enrollment = null;
        lease = null;
        const metadata = await options.signer.metadata();
        await live(signal);
        const challenge = await options.client.beginChatgptExecutor(
          {
            connection_id: binding.connection_id,
            host_id: metadata.host_id,
            public_key: metadata.public_key,
            ...(options.device ? { device: options.device } : {}),
          },
          signal,
        );
        await live(signal);
        const proof = await options.signer.proveEnrollment(challenge);
        await live(signal);
        const next = chatgptExecutorEnrolled.parse(
          await options.client.finishChatgptExecutor(proof, signal),
        );
        await live(signal);
        if (
          !same(next.binding) ||
          next.host_id !== metadata.host_id ||
          next.public_key_fingerprint !== metadata.public_key_fingerprint
        )
          throw new Error("The ChatGPT executor registration changed.");
        enrollment = next;
        const leaseChallenge = await options.client.beginChatgptExecutorLease(
          { executor_id: next.id },
          signal,
        );
        await live(signal);
        if (
          leaseChallenge.executor_id !== next.id ||
          leaseChallenge.enrollment_epoch !== next.enrollment_epoch
        )
          throw new Error("The ChatGPT executor lease challenge changed.");
        const signedLease = await options.signer.proveLease(leaseChallenge);
        await live(signal);
        const claimed = validateLease(
          await options.client.finishChatgptExecutorLease(signedLease, signal),
        );
        if (claimed.lease_epoch !== leaseChallenge.expected_lease_epoch + 1)
          throw new Error("The ChatGPT executor lease generation changed.");
        await live(signal);
        lease = claimed;
        heartbeatSequence = 0;
        catalogSequence = 0;
        try {
          await publish(signal);
        } catch (error) {
          lease = null;
          throw error;
        }
        return {
          selection: {
            connection_id: binding.connection_id,
            executor_id: next.id,
          },
          lease: { ...claimed, binding: { ...claimed.binding } },
        };
      }, signal);
    },
    heartbeat(signal?: AbortSignal) {
      return ordered(
        async (signal) => {
          const captured = currentLease();
          const signed = await options.signer.signHeartbeat({
            executor_id: captured.executor_id,
            lease_epoch: captured.lease_epoch,
            sequence: ++heartbeatSequence,
          });
          await live(signal, true);
          currentLease();
          const renewed = validateLease(
            await options.client.renewChatgptExecutorLease(signed, signal),
          );
          await live(signal, true);
          currentLease();
          if (renewed.lease_epoch !== captured.lease_epoch)
            throw new Error("The ChatGPT executor lease generation changed.");
          lease = renewed;
          return { ...renewed, binding: { ...renewed.binding } };
        },
        signal,
        true,
      );
    },
    refreshCatalog(signal?: AbortSignal) {
      return ordered(publish, signal);
    },
    close() {
      closed = true;
      lifetime.abort();
      lease = null;
      enrollment = null;
      options.signer.close();
    },
  };
}
export type ChatgptExecutorLifecycle = ReturnType<
  typeof createChatgptExecutorLifecycle
>;
