const {
  generateKeyPairSync,
  createPrivateKey,
  createHash,
  sign,
} = require("node:crypto");
const { createChatgptVault } = require("./chatgpt-vault.cjs");

/** Main-process singleton only; expose proof/metadata methods, never private key reads. */
async function createChatgptExecutorSigner({
  binding: input,
  hostId,
  requireLiveConnection,
  keyVault,
  ...storage
}) {
  const {
    chatgptModelBinding,
    chatgptExecutorChallenge,
    chatgptExecutorCatalog,
    chatgptLeaseChallenge,
    chatgptLeaseHeartbeat,
    chatgptLeaseHeartbeatMessage,
    chatgptCatalogSigningInput,
    CHATGPT_CATALOG_SIGNATURE_DOMAIN,
  } = await import("@orbyn/core");
  const binding = Object.freeze(chatgptModelBinding.parse(input));
  chatgptModelBinding.shape.connection_id.parse(hostId);
  if (typeof requireLiveConnection !== "function")
    throw new Error("A live Orbyn connection is required.");
  const vault =
    keyVault ??
    (await createChatgptVault({
      ...storage,
      purpose: "executor-key",
    }));
  let closed = false;
  const live = async () => {
    if (closed) throw new Error("The executor signing key was disconnected.");
    await requireLiveConnection({ ...binding });
    if (closed) throw new Error("The executor signing key was disconnected.");
  };
  const same = (value) => JSON.stringify(value) === JSON.stringify(binding);
  const key = async () => {
    await live();
    let saved = await vault.read(binding);
    if (!saved.credentials) {
      const keys = generateKeyPairSync("ed25519");
      const record = {
        privateKey: keys.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64url"),
        publicKey: keys.publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64url"),
        createdAt: Date.now(),
      };
      try {
        await vault.write(binding, record, saved.revision);
      } catch (error) {
        if (error.code !== "STORAGE_CONFLICT") throw error;
      }
      saved = await vault.read(binding);
    }
    await live();
    if (!saved.credentials)
      throw new Error("The executor signing key is unavailable.");
    return saved.credentials;
  };
  const fingerprint = (record) =>
    createHash("sha256")
      .update(Buffer.from(record.publicKey, "base64url"))
      .digest("base64url");
  const proof = async (record, message, expiresAt) => {
    await live();
    if (expiresAt && Date.parse(expiresAt) <= Date.now())
      throw new Error("The executor proof expired. Start again.");
    const privateKey = createPrivateKey({
      key: Buffer.from(record.privateKey, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    return sign(null, Buffer.from(message, "utf8"), privateKey).toString(
      "base64url",
    );
  };
  return {
    async metadata() {
      const record = await key();
      return {
        host_id: hostId,
        public_key: record.publicKey,
        public_key_fingerprint: fingerprint(record),
      };
    },
    async proveEnrollment(value) {
      const challenge = chatgptExecutorChallenge.parse(value);
      if (
        !same(challenge.binding) ||
        challenge.host_id !== hostId ||
        Date.parse(challenge.expires_at) <= Date.now()
      )
        throw new Error("The executor enrollment challenge changed.");
      const record = await key();
      if (challenge.public_key_fingerprint !== fingerprint(record))
        throw new Error("The executor enrollment key changed.");
      let message;
      try {
        message = JSON.parse(challenge.proof_message);
      } catch {}
      if (
        !Array.isArray(message) ||
        message.length !== 9 ||
        message[0] !== "orbyn:executor:enroll:v1" ||
        message[1] !== challenge.id ||
        !same(message[3]) ||
        message[4] !== hostId ||
        message[5] !== fingerprint(record) ||
        !Number.isSafeInteger(message[6]) ||
        message[6] < 0 ||
        typeof message[8] !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(message[8])
      )
        throw new Error("The executor enrollment proof is invalid.");
      chatgptModelBinding.shape.connection_id.parse(message[2]);
      if (message[7] !== null)
        chatgptModelBinding.shape.connection_id.parse(message[7]);
      return {
        challenge_id: challenge.id,
        signature: await proof(
          record,
          challenge.proof_message,
          challenge.expires_at,
        ),
      };
    },
    async proveLease(value) {
      const challenge = chatgptLeaseChallenge.parse(value);
      if (
        !same(challenge.binding) ||
        Date.parse(challenge.expires_at) <= Date.now()
      )
        throw new Error("The executor lease challenge changed.");
      let message;
      try {
        message = JSON.parse(challenge.proof_message);
      } catch {}
      if (
        !Array.isArray(message) ||
        message.length !== 8 ||
        message[0] !== "orbyn:executor:lease-claim:v1" ||
        message[1] !== challenge.id ||
        !same(message[3]) ||
        message[4] !== challenge.executor_id ||
        message[5] !== challenge.enrollment_epoch ||
        message[6] !== challenge.expected_lease_epoch ||
        typeof message[7] !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(message[7])
      )
        throw new Error("The executor lease proof is invalid.");
      chatgptModelBinding.shape.connection_id.parse(message[2]);
      const record = await key();
      return {
        challenge_id: challenge.id,
        signature: await proof(
          record,
          challenge.proof_message,
          challenge.expires_at,
        ),
      };
    },
    async signHeartbeat(value) {
      const heartbeat = chatgptLeaseHeartbeat.parse(value);
      const record = await key();
      return {
        heartbeat,
        signature: await proof(record, chatgptLeaseHeartbeatMessage(heartbeat)),
      };
    },
    async signCatalog(value) {
      const catalog = chatgptExecutorCatalog.parse(value);
      if (!same(catalog.binding))
        throw new Error("The executor catalog account changed.");
      const record = await key();
      const message = `${CHATGPT_CATALOG_SIGNATURE_DOMAIN}\n${createHash("sha256").update(chatgptCatalogSigningInput(catalog), "utf8").digest("base64url")}`;
      return { catalog, signature: await proof(record, message) };
    },
    async signInference(value) {
      const { chatgptInferenceReceipt, chatgptInferenceReceiptMessage } =
        await import("@orbyn/core");
      const receipt = chatgptInferenceReceipt.parse(value);
      if (!same(receipt.binding))
        throw new Error("The inference account changed.");
      const record = await key();
      return {
        receipt,
        signature: await proof(record, chatgptInferenceReceiptMessage(receipt)),
      };
    },
    async revoke() {
      closed = true;
      await vault.revoke(binding);
    },
    close() {
      closed = true;
    },
  };
}
module.exports = { createChatgptExecutorSigner };
