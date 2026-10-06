import { requireOptionalNativeModule } from "expo-modules-core";

type OrbynChatgptModule = {
  keyMetadata(
    account: string,
  ): Promise<{ public_key: string; public_key_fingerprint: string }>;
  signProof(
    account: string,
    fingerprint: string,
    message: string,
  ): Promise<string>;
  removeKey(account: string): Promise<void>;
  start(id: string, state: string, timeoutMs: number): Promise<string>;
  wait(id: string): Promise<string>;
  cancel(id: string): Promise<void>;
};
const native = requireOptionalNativeModule<OrbynChatgptModule>("OrbynChatgpt");

/** Native builds own their callback; web/Expo Go must not silently delegate to a laptop. */
export const nativeChatgptCallbackAvailable = () => native !== null;

/** Older installed callback-only builds cannot advertise native executor support. */
export const nativeChatgptSigningAvailable = () =>
  typeof native?.keyMetadata === "function" &&
  typeof native?.signProof === "function" &&
  typeof native?.removeKey === "function";

/** Start before opening authorization. The returned callback is ephemeral and device-local. */
export async function startNativeChatgptCallback(
  id: string,
  state: string,
  timeoutMs = 600_000,
) {
  if (!native)
    throw new Error(
      "This build does not include native ChatGPT authorization.",
    );
  return native.start(id, state, timeoutMs);
}

/** Return one callback to the initiating runtime; it must validate code/client/state before exchange. */
export async function waitNativeChatgptCallback(id: string) {
  if (!native)
    throw new Error(
      "This build does not include native ChatGPT authorization.",
    );
  return native.wait(id);
}

/** Attempt IDs prevent stale cleanup from cancelling a later authorization. */
export async function cancelNativeChatgptCallback(id: string) {
  await native?.cancel(id);
}

/** Public metadata only. Account aliases are derived by the owned runtime, never user-entered. */
export async function nativeChatgptKeyMetadata(account: string) {
  if (!native)
    throw new Error("Native ChatGPT executor signing is unavailable.");
  return native.keyMetadata(account);
}
/** The runtime validates domain, binding, lease and expiry before requesting a signature. */
export async function signNativeChatgptProof(
  account: string,
  fingerprint: string,
  message: string,
) {
  if (!native)
    throw new Error("Native ChatGPT executor signing is unavailable.");
  return native.signProof(account, fingerprint, message);
}
/** Erase the exact account key; never create a replacement as part of cleanup. */
export async function removeNativeChatgptKey(account: string) {
  if (!native)
    throw new Error("Native ChatGPT executor signing is unavailable.");
  return native.removeKey(account);
}
