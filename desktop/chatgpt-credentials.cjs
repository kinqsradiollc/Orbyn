const { refreshChatgptTokens } = require("./chatgpt-oauth.cjs");
const refreshQueues = new WeakMap();

/** Private singleton-vault credential resolver; rotating tokens never cross IPC. */
async function createChatgptCredentialResolver({
  binding: input,
  vault,
  requireLiveConnection,
  fetch,
  verifyIdentity,
  refresh = refreshChatgptTokens,
  onInvalidated,
}) {
  const { chatgptModelBinding } = await import("@orbyn/core");
  const binding = Object.freeze(chatgptModelBinding.parse(input));
  if (typeof requireLiveConnection !== "function")
    throw new Error("A live Orbyn connection is required.");
  const verifier =
    verifyIdentity ??
    (
      await import("@orbyn/api-client/openai-identity")
    ).createOpenAiRefreshIdentityVerifier();
  let closed = false;
  const lifetime = new AbortController();
  const live = async () => {
    if (closed) throw new Error("The ChatGPT credential runtime was stopped.");
    await requireLiveConnection({ ...binding });
    if (closed) throw new Error("The ChatGPT credential runtime was stopped.");
  };
  let queues = refreshQueues.get(vault);
  if (!queues) {
    queues = new Map();
    refreshQueues.set(vault, queues);
  }
  const key = JSON.stringify(binding);
  const current = async (signal) => {
    const combined = AbortSignal.any([
      lifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    const work = async () => {
      combined.throwIfAborted();
      await live();
      let saved = await vault.read(binding);
      await live();
      let credentials = saved.credentials;
      if (!credentials || credentials.clientId !== binding.client_id)
        throw new Error("Reconnect this ChatGPT account.");
      if (credentials.expiresAt <= Date.now() + 60_000) {
        if (!credentials.refreshToken)
          throw new Error(
            "Reconnect this ChatGPT account before its next request.",
          );
        let replacement;
        try {
          replacement = await refresh(credentials, { fetch, signal: combined });
        } catch (error) {
          if (error?.code === "AUTH_REFRESH_EXPIRED") {
            combined.throwIfAborted();
            await live();
            // Conditional erasure must never revoke credentials from a later sign-in.
            await vault.revokeObserved(binding, saved.revision, {
              signal: combined,
            });
            onInvalidated?.();
            throw new Error("Reconnect this ChatGPT account.");
          }
          throw error;
        }
        // Rotation consumed the observed token. Retire it before cancellable
        // post-refresh verification; preserve a concurrently newer registration.
        const retiredRevision = await vault.revokeObserved(
          binding,
          saved.revision,
        );
        try {
          combined.throwIfAborted();
          await live();
          if (replacement.clientId !== binding.client_id)
            throw new Error("The refreshed ChatGPT registration changed.");
          if (replacement.idToken !== credentials.idToken) {
            const identity = await verifier(replacement.idToken, {
              clientId: binding.client_id,
              subject: binding.subject,
            });
            if (
              identity.issuer !== binding.issuer ||
              identity.subject !== binding.subject ||
              identity.clientId !== binding.client_id
            )
              throw new Error("The refreshed ChatGPT account changed.");
          }
          combined.throwIfAborted();
          await live();
          await vault.write(binding, replacement, retiredRevision);
        } catch (error) {
          // The consumed grant is retired; surface reconnect without restoring it.
          onInvalidated?.();
          throw error;
        }
        combined.throwIfAborted();
        await live();
        saved = await vault.read(binding);
        await live();
        credentials = saved.credentials;
      }
      combined.throwIfAborted();
      if (
        !credentials ||
        !credentials.sharingGranted ||
        credentials.expiresAt <= Date.now()
      )
        throw new Error("Enable ChatGPT plan usage or reconnect this account.");
      return { ...credentials, scopes: [...credentials.scopes] };
    };
    const result = (queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    const tail = result.catch(() => {});
    queues.set(key, tail);
    void tail.finally(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return result;
  };
  return {
    current,
    close() {
      closed = true;
      lifetime.abort();
    },
  };
}
module.exports = { createChatgptCredentialResolver };
