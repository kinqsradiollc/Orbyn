const {
  prepareChatgptAuthorization,
  exchangeChatgptCode,
} = require("./chatgpt-oauth.cjs");
const activeSignIns = new WeakMap();

/** One attempt per account/vault: a cancelled loser must never erase a winner. */
async function signInChatgpt(options) {
  const { vault, userId } = options;
  let users = activeSignIns.get(vault);
  if (!users) {
    users = new Set();
    activeSignIns.set(vault, users);
  }
  if (users.has(userId)) {
    const error = new Error(
      "Finish or cancel the current ChatGPT sign-in first.",
    );
    error.code = "AUTH_BUSY";
    throw error;
  }
  users.add(userId);
  try {
    return await runSignIn(options);
  } finally {
    users.delete(userId);
    if (!users.size) activeSignIns.delete(vault);
  }
}

/** Private main-process sequence. Dependencies must be trusted adapters, never IPC inputs. */
async function runSignIn({
  userId,
  registrationStore,
  vault,
  beginConnection,
  finishConnection,
  verifyIdentity,
  openAuthorization,
  signal,
  expectedSubject,
  reconnectBinding,
  prepare = prepareChatgptAuthorization,
  exchange = exchangeChatgptCode,
}) {
  const { chatgptModelBinding, chatgptConnectionChallenge, chatgptConnection } =
    await import("@orbyn/core");
  const identityVerifier =
    verifyIdentity ??
    (
      await import("@orbyn/api-client/openai-identity")
    ).createOpenAiIdentityVerifier();
  chatgptModelBinding.shape.user_id.parse(userId);
  let attempt;
  let installation;
  let installedRevision;
  let previous;
  const reconnect = reconnectBinding
    ? chatgptModelBinding.parse(reconnectBinding)
    : null;
  if (reconnect && reconnect.user_id !== userId)
    throw new Error("The returning ChatGPT account changed.");
  const cancelled = () => {
    if (signal?.aborted) {
      const error = new Error("ChatGPT sign-in was cancelled.");
      error.code = "AUTH_ABORTED";
      throw error;
    }
  };
  // Revoke only the slot this attempt began installing. No unrelated connection
  // is touched when cancellation happens during browser/provider verification.
  const abort = () => {
    attempt?.cancel();
    if (installation && !reconnect)
      void vault.revoke(installation).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    cancelled();
    const registration = await registrationStore.read();
    cancelled();
    if (reconnect) {
      if (
        registration.clientId !== reconnect.client_id ||
        JSON.stringify(await registrationStore.connection()) !==
          JSON.stringify(reconnect)
      )
        throw new Error("The returning ChatGPT registration changed.");
      previous = await vault.read(reconnect);
      cancelled();
    }
    const challenge = chatgptConnectionChallenge.parse(
      await beginConnection(
        registration.clientId === null
          ? {}
          : { client_id: registration.clientId },
      ),
    );
    cancelled();
    if (Date.parse(challenge.expires_at) <= Date.now())
      throw new Error("ChatGPT sign-in expired.");
    attempt = await prepare({
      hostId: `urn:uuid:${chatgptModelBinding.shape.connection_id.parse(registration.hostId)}`,
      clientId: registration.clientId ?? undefined,
      nonce: challenge.nonce,
      idTokenHint: previous?.credentials?.idToken,
      signal,
    });
    cancelled();
    await openAuthorization(attempt.authorizationUrl);
    cancelled();
    const callback = await attempt.result;
    cancelled();
    // This must survive invalid_grant and process restart.
    const retainedRegistration = await registrationStore.retain(
      callback.clientId,
      registration.revision,
    );
    cancelled();
    const credentials = await exchange(callback, { signal });
    cancelled();
    const identity = await identityVerifier(credentials.idToken, {
      clientId: callback.clientId,
      nonce: challenge.nonce,
    });
    cancelled();
    if (
      identity.issuer !== "https://auth.openai.com" ||
      identity.clientId !== callback.clientId ||
      (reconnect && identity.subject !== reconnect.subject) ||
      (expectedSubject !== undefined && identity.subject !== expectedSubject)
    )
      throw new Error("ChatGPT account changed. Start again.");
    const connection = chatgptConnection.parse(
      await finishConnection({
        challenge_id: challenge.id,
        client_id: callback.clientId,
        id_token: credentials.idToken,
      }),
    );
    cancelled();
    if (
      connection.issuer !== identity.issuer ||
      connection.subject !== identity.subject ||
      connection.client_id !== identity.clientId
    )
      throw new Error("ChatGPT identity did not match this connection.");
    const binding = chatgptModelBinding.parse({
      user_id: userId,
      connection_id: connection.id,
      issuer: connection.issuer,
      subject: connection.subject,
      client_id: connection.client_id,
    });
    if (reconnect && JSON.stringify(binding) !== JSON.stringify(reconnect))
      throw new Error("The returning ChatGPT connection changed.");
    await registrationStore.linkVerifiedConnection(
      binding,
      retainedRegistration.revision,
    );
    cancelled();
    const current = await vault.read(binding);
    cancelled();
    // Reauthentication of an installed slot needs its own reviewed replacement
    // protocol; cancelling this new connection must not erase older credentials.
    if (current.credentials !== null && !reconnect)
      throw new Error(
        "Disconnect this ChatGPT connection before reconnecting.",
      );
    if (reconnect && current.revision !== previous.revision)
      throw new Error("The ChatGPT credentials changed. Start again.");
    installation = binding;
    installedRevision = await vault.write(
      binding,
      credentials,
      current.revision,
    );
    cancelled();
    // Metadata only: OAuth proof and plan credentials stay in the main process.
    return {
      binding,
      revision: installedRevision,
      sharingGranted: credentials.sharingGranted,
    };
  } catch (error) {
    if (installation && signal?.aborted) {
      if (reconnect && previous?.credentials && installedRevision) {
        // Restore only our own replacement. CAS protects a later writer/revocation.
        await vault
          .write(installation, previous.credentials, installedRevision)
          .catch(() => {});
      } else if (!reconnect || (installedRevision && !previous?.credentials)) {
        await vault.revoke(installation).catch(() => {});
      }
    }
    throw error;
  } finally {
    attempt?.cancel();
    signal?.removeEventListener("abort", abort);
  }
}

module.exports = { signInChatgpt };
