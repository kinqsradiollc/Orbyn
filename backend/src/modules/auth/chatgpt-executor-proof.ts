import {
  createPublicKey,
  createHash,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  chatgptCatalogSigningInput,
  CHATGPT_CATALOG_SIGNATURE_DOMAIN,
} from "@orbyn/core";

const invalid = () => new Error("The executor proof could not be verified.");

/** Derive the catalog message from validated metadata, never client-supplied message bytes. */
export function chatgptCatalogProofMessage(value: unknown): string {
  return `${CHATGPT_CATALOG_SIGNATURE_DOMAIN}\n${createHash("sha256").update(chatgptCatalogSigningInput(value), "utf8").digest("base64url")}`;
}

/** Verify all catalog metadata, including registration, lease and publication sequence. */
export function verifyChatgptCatalogProof(
  publicKey: unknown,
  value: unknown,
  signature: unknown,
): string {
  try {
    return verifyChatgptExecutorProof(
      publicKey,
      chatgptCatalogProofMessage(value),
      signature,
    );
  } catch {
    throw invalid();
  }
}

/** Validate canonical Ed25519 or uncompressed P-256 SPKI; reject private keys and other curves. */
export function parseChatgptExecutorKey(value: unknown): {
  key: KeyObject;
  fingerprint: string;
} {
  try {
    if (
      typeof value !== "string" ||
      !/^(?:[A-Za-z0-9_-]{59}|[A-Za-z0-9_-]{122})$/.test(value)
    )
      throw invalid();
    const bytes = Buffer.from(value, "base64url");
    if (
      ![44, 91].includes(bytes.length) ||
      bytes.toString("base64url") !== value
    )
      throw invalid();
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    const ed25519 = key.asymmetricKeyType === "ed25519" && bytes.length === 44;
    const p256 =
      key.asymmetricKeyType === "ec" &&
      bytes.length === 91 &&
      key.asymmetricKeyDetails?.namedCurve === "prime256v1";
    if (
      (!ed25519 && !p256) ||
      !key.export({ type: "spki", format: "der" }).equals(bytes)
    )
      throw invalid();
    return {
      key,
      fingerprint: createHash("sha256").update(bytes).digest("base64url"),
    };
  } catch {
    throw invalid();
  }
}

/** Call with the saved server challenge bytes, never a message supplied by completion input. */
export function verifyChatgptExecutorProof(
  publicKey: unknown,
  savedMessage: unknown,
  signature: unknown,
): string {
  try {
    const { key, fingerprint } = parseChatgptExecutorKey(publicKey);
    if (
      typeof savedMessage !== "string" ||
      savedMessage.length < 32 ||
      savedMessage.length > 2048 ||
      typeof signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(signature)
    )
      throw invalid();
    const bytes = Buffer.from(signature, "base64url");
    if (
      bytes.length !== 64 ||
      bytes.toString("base64url") !== signature ||
      !verify(
        key.asymmetricKeyType === "ed25519" ? null : "sha256",
        Buffer.from(savedMessage, "utf8"),
        key.asymmetricKeyType === "ed25519"
          ? key
          : { key, dsaEncoding: "ieee-p1363" },
        bytes,
      )
    )
      throw invalid();
    return fingerprint;
  } catch {
    throw invalid();
  }
}
