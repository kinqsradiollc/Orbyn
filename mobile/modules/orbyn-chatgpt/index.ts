import { requireOptionalNativeModule } from "expo-modules-core";

type OrbynChatgptModule = {
  start(id: string, state: string, timeoutMs: number): Promise<string>;
  wait(id: string): Promise<string>;
  cancel(id: string): Promise<void>;
};
const native = requireOptionalNativeModule<OrbynChatgptModule>("OrbynChatgpt");

/** Native builds own their callback; web/Expo Go must not silently delegate to a laptop. */
export const nativeChatgptCallbackAvailable = () => native !== null;

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
