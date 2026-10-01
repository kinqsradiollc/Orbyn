/** Private main-process controller. Its adapter and signer never cross IPC. */
async function createChatgptExecutorRuntime({
  binding: input,
  client,
  signer,
  models,
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
    close() {
      closed = true;
      lifetime.abort();
      lease = null;
      enrollment = null;
    },
  };
}
module.exports = { createChatgptExecutorRuntime };
