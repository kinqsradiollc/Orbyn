import {
  chatgptModelBinding,
  chatgptExecutorEnrolled,
  chatgptExecutorLease,
  chatgptExecutorCatalog,
  chatgptCatalogReceipt,
  type ChatgptModelBinding,
  type ChatgptModel,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
import type { ChatgptExecutorSigner } from "./chatgpt-executor-signer.js";

/** Credential-free lifecycle; an inference adapter must separately establish and advertise capability. */
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
  models: (signal: AbortSignal) => Promise<ChatgptModel[]>;
  requireLiveConnection: () => Promise<void>;
}) {
  const binding = Object.freeze(chatgptModelBinding.parse(options.binding));
  let enrollment: ReturnType<typeof chatgptExecutorEnrolled.parse> | null =
    null;
  let lease: ReturnType<typeof chatgptExecutorLease.parse> | null = null;
  let closed = false,
    heartbeatSequence = 0,
    catalogSequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const lifetime = new AbortController();
  const same = (value: unknown) =>
    JSON.stringify(value) === JSON.stringify(binding);
  const live = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (closed) throw new Error("The ChatGPT executor was stopped.");
    await options.requireLiveConnection();
    signal.throwIfAborted();
    if (closed) throw new Error("The ChatGPT executor was stopped.");
  };
  const ordered = <T>(
    work: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
  ): Promise<T> => {
    const execute = async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      lifetime.signal.addEventListener("abort", abort, { once: true });
      external?.addEventListener("abort", abort, { once: true });
      if (lifetime.signal.aborted || external?.aborted) abort();
      const timer = setTimeout(abort, 30000);
      try {
        await live(controller.signal);
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
  return {
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
      return ordered(async (signal) => {
        const captured = currentLease();
        const signed = await options.signer.signHeartbeat({
          executor_id: captured.executor_id,
          lease_epoch: captured.lease_epoch,
          sequence: ++heartbeatSequence,
        });
        await live(signal);
        currentLease();
        const renewed = validateLease(
          await options.client.renewChatgptExecutorLease(signed, signal),
        );
        await live(signal);
        currentLease();
        if (renewed.lease_epoch !== captured.lease_epoch)
          throw new Error("The ChatGPT executor lease generation changed.");
        lease = renewed;
        return { ...renewed, binding: { ...renewed.binding } };
      }, signal);
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
