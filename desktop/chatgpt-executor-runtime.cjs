/** Private main-process controller. Its adapter and signer never cross IPC. */
async function createChatgptExecutorRuntime({
  binding: input,
  client,
  signer,
  models,
  complete,
  completeAssigned,
  requireLiveConnection,
}) {
  const {
    chatgptModelBinding,
    chatgptExecutorEnrolled,
    chatgptExecutorLease,
    chatgptExecutorCatalog,
    chatgptCatalogReceipt,
  } = await import("@orbyn/core");
  const binding = Object.freeze(chatgptModelBinding.parse(input));
  if (
    typeof models !== "function" ||
    typeof requireLiveConnection !== "function"
  )
    throw new Error("A credential-owning model runtime is required.");
  let closed = false,
    enrollment = null,
    lease = null;
  let executing = false;
  let heartbeatSequence = 0,
    catalogSequence = 0;
  let tail = Promise.resolve();
  const lifetime = new AbortController();
  const same = (value) => JSON.stringify(value) === JSON.stringify(binding);
  const live = async () => {
    if (closed) throw new Error("The ChatGPT executor was stopped.");
    await requireLiveConnection({ ...binding });
    if (closed) throw new Error("The ChatGPT executor was stopped.");
  };
  const ordered = (work) => {
    const result = tail.catch(() => {}).then(work);
    tail = result.catch(() => {});
    return result;
  };
  const signals = (signal) =>
    AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(30_000),
      ...(signal ? [signal] : []),
    ]);
  const validateLease = (value) => {
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
  const publish = async (signal) => {
    await live();
    if (!lease || Date.parse(lease.expires_at) <= Date.now())
      throw new Error("The ChatGPT executor lease expired. Reconnect it.");
    const available = await models(signal);
    await live();
    const catalog = chatgptExecutorCatalog.parse({
      executor_id: enrollment.id,
      binding,
      lease_epoch: lease.lease_epoch,
      sequence: ++catalogSequence,
      models: available,
    });
    const signed = await signer.signCatalog(catalog);
    await live();
    const receipt = chatgptCatalogReceipt.parse(
      await client.publishChatgptModels(signed, signal),
    );
    await live();
    if (
      receipt.executor_id !== catalog.executor_id ||
      receipt.lease_epoch !== catalog.lease_epoch ||
      receipt.sequence !== catalog.sequence
    )
      throw new Error("The ChatGPT catalog receipt changed.");
    return receipt;
  };
  return {
    /** Explicit start enrolls the device, claims a new fenced lease and publishes its catalog. */
    start(signal) {
      return ordered(async () => {
        await live();
        const combined = signals(signal);
        const metadata = await signer.metadata();
        await live();
        const challenge = await client.beginChatgptExecutor(
          {
            connection_id: binding.connection_id,
            host_id: metadata.host_id,
            public_key: metadata.public_key,
          },
          combined,
        );
        await live();
        const proof = await signer.proveEnrollment(challenge);
        await live();
        const next = chatgptExecutorEnrolled.parse(
          await client.finishChatgptExecutor(proof, combined),
        );
        await live();
        if (
          !same(next.binding) ||
          next.host_id !== metadata.host_id ||
          next.public_key_fingerprint !== metadata.public_key_fingerprint
        )
          throw new Error("The ChatGPT executor registration changed.");
        enrollment = next;
        lease = null;
        const leaseChallenge = await client.beginChatgptExecutorLease(
          { executor_id: next.id },
          combined,
        );
        await live();
        if (
          leaseChallenge.executor_id !== next.id ||
          leaseChallenge.enrollment_epoch !== next.enrollment_epoch
        )
          throw new Error("The ChatGPT executor lease challenge changed.");
        const leaseProof = await signer.proveLease(leaseChallenge);
        await live();
        lease = validateLease(
          await client.finishChatgptExecutorLease(leaseProof, combined),
        );
        await live();
        heartbeatSequence = 0;
        catalogSequence = 0;
        await publish(combined);
        return {
          selection: {
            connection_id: binding.connection_id,
            executor_id: enrollment.id,
          },
          lease: { ...lease },
        };
      });
    },
    /** Serialize heartbeats/publication so an older completion cannot replace a newer lease. */
    heartbeat(signal) {
      return ordered(async () => {
        await live();
        if (!lease || Date.parse(lease.expires_at) <= Date.now())
          throw new Error("The ChatGPT executor lease expired. Reconnect it.");
        const combined = signals(signal);
        const epoch = lease.lease_epoch;
        const signed = await signer.signHeartbeat({
          executor_id: enrollment.id,
          lease_epoch: epoch,
          sequence: ++heartbeatSequence,
        });
        await live();
        const next = validateLease(
          await client.renewChatgptExecutorLease(signed, combined),
        );
        await live();
        if (next.lease_epoch !== epoch)
          throw new Error("The ChatGPT executor lease changed.");
        lease = next;
        return { ...next };
      });
    },
    refreshCatalog(signal) {
      return ordered(() => publish(signals(signal)));
    },
    /** Private inference stays outside the heartbeat queue and under a live lease. */
    async completeDefault(request, signal) {
      await live();
      if (typeof complete !== "function" || !lease)
        throw new Error("The ChatGPT inference executor is not ready.");
      const captured = validateLease(lease);
      const combined = AbortSignal.any([
        lifetime.signal,
        AbortSignal.timeout(120_000),
        ...(signal ? [signal] : []),
      ]);
      combined.throwIfAborted();
      const text = await complete(request, { signal: combined });
      await live();
      combined.throwIfAborted();
      const current = validateLease(lease);
      if (
        current.lease_epoch !== captured.lease_epoch ||
        current.enrollment_epoch !== captured.enrollment_epoch
      )
        throw new Error("The ChatGPT executor lease changed during inference.");
      return text;
    },
    /** Claims a server-owned task once; heartbeats remain free to renew during model work. */
    async executeNext(signal) {
      if (executing) return { processed: false };
      executing = true;
      try {
        await live();
        if (!lease || typeof completeAssigned !== "function")
          throw new Error("The inference runtime is unavailable.");
        const captured = validateLease(lease);
        const task = await client.claimChatgptInference(
          captured.executor_id,
          signals(signal),
        );
        await live();
        if (!task) return { processed: false };
        const { chatgptInferenceAssignment } = await import("@orbyn/core");
        const assigned = chatgptInferenceAssignment.parse(task);
        const current = validateLease(lease);
        const hash = require("node:crypto")
          .createHash("sha256")
          .update(
            JSON.stringify({
              binding: assigned.binding,
              model: assigned.model,
              payload: assigned.payload,
              job_id: assigned.job_id,
            }),
          )
          .digest("hex");
        if (
          !same(assigned.binding) ||
          assigned.executor_id !== current.executor_id ||
          assigned.enrollment_epoch !== current.enrollment_epoch ||
          assigned.lease_epoch !== current.lease_epoch ||
          assigned.request_hash !== hash ||
          Date.parse(assigned.expires_at) <= Date.now()
        )
          throw new Error("The inference assignment changed.");
        const deadline = AbortSignal.timeout(
          Math.max(
            1,
            Math.min(120000, Date.parse(assigned.expires_at) - Date.now()),
          ),
        );
        const combined = AbortSignal.any([
          lifetime.signal,
          deadline,
          ...(signal ? [signal] : []),
        ]);
        let result;
        try {
          const done = await completeAssigned(
            assigned.model,
            assigned.payload,
            { signal: combined },
          );
          combined.throwIfAborted();
          result = {
            status: "completed",
            text: done.text,
            usage: done.usage ?? null,
          };
        } catch (error) {
          const code =
            typeof error.providerCode === "string" &&
            /^[A-Za-z0-9_-]{1,128}$/.test(error.providerCode)
              ? error.providerCode
              : null;
          const status =
            Number.isInteger(error.status) &&
            error.status >= 100 &&
            error.status <= 599
              ? error.status
              : null;
          result = {
            status: "failed",
            reason:
              code === "subscription_sharing_user_not_eligible"
                ? "eligibility"
                : code === "subscription_sharing_usage_limit_exceeded"
                  ? "usage_limit"
                  : code === "subscription_sharing_usage_unavailable"
                    ? "unavailable"
                    : status === 401 || status === 403
                      ? "permission"
                      : combined.aborted
                        ? "interrupted"
                        : "unknown",
            phase:
              status === 200
                ? "stream"
                : status !== null
                  ? "admission"
                  : "unknown",
            http_status: status,
            provider_code: code,
          };
        }
        await live();
        const after = validateLease(lease);
        if (
          after.enrollment_epoch !== assigned.enrollment_epoch ||
          after.lease_epoch !== assigned.lease_epoch
        )
          throw new Error("The inference lease changed.");
        const publication = await signer.signInference({
          request_id: assigned.id,
          executor_id: assigned.executor_id,
          binding: assigned.binding,
          enrollment_epoch: assigned.enrollment_epoch,
          lease_epoch: assigned.lease_epoch,
          model: assigned.model,
          nonce: assigned.nonce,
          request_hash: assigned.request_hash,
          result,
        });
        await live();
        await client.finishChatgptInference(publication, signals(signal));
        return { processed: true };
      } finally {
        executing = false;
      }
    },
    close() {
      closed = true;
      lifetime.abort();
      lease = null;
      enrollment = null;
    },
  };
}
module.exports = { createChatgptExecutorRuntime };
