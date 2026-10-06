import {
  chatgptModelBinding,
  chatgptExecutorChallenge,
  chatgptExecutorStart,
  chatgptExecutorFinish,
  chatgptLeaseChallenge,
  chatgptLeaseHeartbeat,
  chatgptLeaseHeartbeatMessage,
  chatgptExecutorCatalog,
  chatgptCatalogSigningInput,
  CHATGPT_CATALOG_SIGNATURE_DOMAIN,
  chatgptInferenceReceipt,
  chatgptInferenceSigningInput,
  CHATGPT_INFERENCE_SIGNATURE_DOMAIN,
  type ChatgptModelBinding,
} from "@orbyn/core";

export type ChatgptExecutorKeyAdapter = {
  metadata(): Promise<{ public_key: string; public_key_fingerprint: string }>;
  sign(fingerprint: string, message: string): Promise<string>;
  remove(): Promise<void>;
};

/** Runtime-owned signer: native private keys and arbitrary challenge bytes never reach views. */
export function createChatgptExecutorSigner(options: {
  binding: ChatgptModelBinding;
  hostId: string;
  keys: ChatgptExecutorKeyAdapter;
  digest: (message: string) => Promise<string>;
  requireLiveConnection: () => Promise<void>;
}) {
  const binding = Object.freeze(chatgptModelBinding.parse(options.binding));
  const hostId = chatgptModelBinding.shape.connection_id.parse(options.hostId);
  let closed = false;
  const same = (value: unknown) =>
    JSON.stringify(value) === JSON.stringify(binding);
  const live = async () => {
    if (closed) throw new Error("The executor signing key was disconnected.");
    await options.requireLiveConnection();
    if (closed) throw new Error("The executor signing key was disconnected.");
  };
  const metadata = async () => {
    await live();
    const key = await options.keys.metadata();
    await live();
    chatgptExecutorStart.parse({
      connection_id: binding.connection_id,
      host_id: hostId,
      public_key: key.public_key,
    });
    if (!/^[A-Za-z0-9_-]{43}$/.test(key.public_key_fingerprint))
      throw new Error("The executor signing key is unavailable.");
    return { ...key, host_id: hostId };
  };
  const proof = async (message: string, expiresAt?: string) => {
    if (expiresAt && Date.parse(expiresAt) <= Date.now())
      throw new Error("The executor proof expired.");
    const key = await metadata();
    const signature = await options.keys.sign(
      key.public_key_fingerprint,
      message,
    );
    await live();
    if (expiresAt && Date.parse(expiresAt) <= Date.now())
      throw new Error("The executor proof expired.");
    return chatgptExecutorFinish.shape.signature.parse(signature);
  };
  return {
    metadata,
    async proveEnrollment(value: unknown) {
      const challenge = chatgptExecutorChallenge.parse(value);
      const key = await metadata();
      if (
        !same(challenge.binding) ||
        challenge.host_id !== hostId ||
        challenge.public_key_fingerprint !== key.public_key_fingerprint ||
        Date.parse(challenge.expires_at) <= Date.now()
      )
        throw new Error("The executor enrollment challenge changed.");
      let message: unknown;
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
        message[5] !== key.public_key_fingerprint ||
        !Number.isSafeInteger(message[6]) ||
        message[6] < 0 ||
        typeof message[8] !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(message[8])
      )
        throw new Error("The executor enrollment proof is invalid.");
      chatgptModelBinding.shape.connection_id.parse(message[2]);
      if (message[7] !== null)
        chatgptModelBinding.shape.connection_id.parse(message[7]);
      // The signature must use the same key whose challenge fingerprint was checked.
      const signature = await options.keys.sign(
        key.public_key_fingerprint,
        challenge.proof_message,
      );
      await live();
      if (Date.parse(challenge.expires_at) <= Date.now())
        throw new Error("The executor proof expired.");
      return chatgptExecutorFinish.parse({
        challenge_id: challenge.id,
        signature,
      });
    },
    async proveLease(value: unknown) {
      const challenge = chatgptLeaseChallenge.parse(value);
      if (
        !same(challenge.binding) ||
        Date.parse(challenge.expires_at) <= Date.now()
      )
        throw new Error("The executor lease challenge changed.");
      let message: unknown;
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
      return {
        challenge_id: challenge.id,
        signature: await proof(challenge.proof_message, challenge.expires_at),
      };
    },
    async signHeartbeat(value: unknown) {
      const heartbeat = chatgptLeaseHeartbeat.parse(value);
      return {
        heartbeat,
        signature: await proof(chatgptLeaseHeartbeatMessage(heartbeat)),
      };
    },
    async signCatalog(value: unknown) {
      const catalog = chatgptExecutorCatalog.parse(value);
      if (!same(catalog.binding))
        throw new Error("The executor catalog account changed.");
      const digest = await options.digest(chatgptCatalogSigningInput(catalog));
      if (!/^[A-Za-z0-9_-]{43}$/.test(digest))
        throw new Error("The executor catalog digest is invalid.");
      return {
        catalog,
        signature: await proof(
          `${CHATGPT_CATALOG_SIGNATURE_DOMAIN}\n${digest}`,
        ),
      };
    },
    async signInference(value: unknown) {
      const receipt = chatgptInferenceReceipt.parse(value);
      if (!same(receipt.binding))
        throw new Error("The inference account changed.");
      const digest = await options.digest(
        chatgptInferenceSigningInput(receipt),
      );
      if (!/^[A-Za-z0-9_-]{43}$/.test(digest))
        throw new Error("The inference receipt digest is invalid.");
      return {
        receipt,
        proof_format: "sha256_v2" as const,
        signature: await proof(
          `${CHATGPT_INFERENCE_SIGNATURE_DOMAIN}\n${digest}`,
        ),
      };
    },
    close() {
      closed = true;
    },
    async revoke() {
      closed = true;
      await options.keys.remove();
    },
  };
}
export type ChatgptExecutorSigner = ReturnType<
  typeof createChatgptExecutorSigner
>;
