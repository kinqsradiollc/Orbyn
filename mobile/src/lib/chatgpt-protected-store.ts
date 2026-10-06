import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";

const queues = new Map<string, Promise<unknown>>();
const protectedOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const unavailable = () =>
  new Error("Protected ChatGPT storage is unavailable. Try again.");
const changed = () => new Error("The Orbyn session changed. Try again.");
function bounded(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
    if (bytes > 262144) return false;
  }
  return true;
}

/** Private device-only adapter. Values can contain tokens and must never reach UI, logs or IPC. */
export async function createNativeChatgptProtectedStore(options: {
  owner: { apiBaseUrl: string; userId: string };
  /** Capture the exact verified Orbyn session; never adopt a replacement session. */
  checkOwner: () => void | Promise<void>;
  secureStore?: Pick<
    typeof SecureStore,
    "getItemAsync" | "setItemAsync" | "deleteItemAsync"
  >;
}) {
  let owner: { apiBaseUrl: string; userId: string };
  try {
    owner = z
      .object({ apiBaseUrl: z.string().min(1).max(4096), userId: z.uuid() })
      .strict()
      .parse(options.owner);
    const url = new URL(owner.apiBaseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
  const check = options.checkOwner;
  const guard = async () => {
    try {
      await check();
    } catch {
      throw changed();
    }
  };
  const native = options.secureStore ?? SecureStore;
  await guard();
  let digest: string;
  try {
    digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(owner),
    );
  } catch {
    throw unavailable();
  }
  await guard();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw unavailable();
  const directoryKey = `orbyn.chatgpt.directory.${digest}`;
  const slotPrefix = `orbyn.chatgpt.slot.${digest}.`;
  const validateKey = (key: string) => {
    if (
      key !== directoryKey &&
      !(
        key.startsWith(slotPrefix) &&
        z.uuid().safeParse(key.slice(slotPrefix.length)).success
      )
    )
      throw unavailable();
  };
  const ordered = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    validateKey(key);
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
  const readRaw = async (key: string) => {
    let value: string | null;
    try {
      value = await native.getItemAsync(key, protectedOptions);
    } catch {
      throw unavailable();
    }
    if (value !== null && !bounded(value)) throw unavailable();
    return value;
  };
  return {
    directoryKey,
    slotKey(connectionId: string) {
      return slotPrefix + z.uuid().parse(connectionId);
    },
    /** Serialize reads with writes across all adapters for this physical protected key. */
    read(key: string) {
      return ordered(key, async () => {
        await guard();
        const value = await readRaw(key);
        await guard();
        return value;
      });
    },
    /** Compare/install or erase in one owner queue. A late owner change rolls back only this exact write. */
    compareAndSwap(
      key: string,
      expected: string | null,
      replacement: string | null,
    ) {
      if (
        (expected !== null && !bounded(expected)) ||
        (replacement !== null && !bounded(replacement))
      )
        throw unavailable();
      return ordered(key, async () => {
        await guard();
        if ((await readRaw(key)) !== expected) {
          await guard();
          return false;
        }
        await guard();
        const restore = async () => {
          // Hold the queue through rollback; never overwrite an external/newer value.
          if ((await readRaw(key)) === replacement) {
            if (expected === null)
              await native.deleteItemAsync(key, protectedOptions);
            else await native.setItemAsync(key, expected, protectedOptions);
          }
        };
        try {
          if (replacement === null)
            await native.deleteItemAsync(key, protectedOptions);
          else await native.setItemAsync(key, replacement, protectedOptions);
        } catch {
          // Native bridges may commit a write before reporting failure.
          try {
            await restore();
          } catch {
            /* Report uncertain storage; never claim success. */
          }
          throw unavailable();
        }
        try {
          await guard();
        } catch {
          try {
            await restore();
          } catch {
            throw unavailable();
          }
          throw changed();
        }
        return true;
      });
    },
  };
}
