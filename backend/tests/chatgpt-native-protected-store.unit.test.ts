import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

const output: any = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL(
        "../../mobile/src/lib/chatgpt-protected-store.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    exports: output,
    URL,
    Promise,
    Map,
    require: (name: string) => {
      if (name === "zod") return { z };
      if (name === "expo-secure-store")
        return { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only" };
      if (name === "expo-crypto")
        return {
          CryptoDigestAlgorithm: { SHA256: "sha256" },
          digestStringAsync: async (_: string, value: string) =>
            createHash("sha256").update(value).digest("hex"),
        };
      throw new Error("Unexpected dependency");
    },
  },
);
function fixture() {
  const values = new Map<string, string>();
  let active = true;
  const options = {
    owner: {
      apiBaseUrl: "https://fixture.orbyn.invalid/api",
      userId: randomUUID(),
    },
    checkOwner: () => {
      if (!active) throw new Error("secret session");
    },
    secureStore: {
      getItemAsync: async (key: string, opts: any) => {
        assert.equal(opts.keychainAccessible, "device-only");
        return values.get(key) ?? null;
      },
      setItemAsync: async (key: string, value: string, opts: any) => {
        assert.equal(opts.keychainAccessible, "device-only");
        values.set(key, value);
      },
      deleteItemAsync: async (key: string, opts: any) => {
        assert.equal(opts.keychainAccessible, "device-only");
        values.delete(key);
      },
    },
  };
  return {
    values,
    options,
    create: () => output.createNativeChatgptProtectedStore(options),
    stop: () => {
      active = false;
    },
  };
}
test("protected slots isolate owners and registrations and enforce device-only options", async () => {
  const f = fixture(),
    a = await f.create(),
    id = randomUUID(),
    key = a.slotKey(id);
  assert.equal(await a.compareAndSwap(key, null, "private"), true);
  assert.equal(await a.read(key), "private");
  const other = fixture(),
    b = await other.create();
  assert.notEqual(a.directoryKey, b.directoryKey);
  assert.throws(() => b.read(key), /storage is unavailable/);
  assert.throws(
    () => a.read(a.directoryKey + ".extra"),
    /storage is unavailable/,
  );
  assert.equal(await a.read(a.slotKey(randomUUID())), null);
});
test("separate adapter instances serialize compare-and-swap on physical key", async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.create(),
    key = a.directoryKey;
  const results = await Promise.all([
    a.compareAndSwap(key, null, "first"),
    b.compareAndSwap(key, null, "second"),
  ]);
  assert.deepEqual(results, [true, false]);
  assert.equal(await b.read(key), "first");
  assert.equal(await a.compareAndSwap(key, "stale", null), false);
});
test("owner change during install restores exact previous value", async () => {
  for (const old of [null, "previous"]) {
    const f = fixture(),
      a = await f.create(),
      key = a.directoryKey;
    if (old !== null) f.values.set(key, old);
    const original = f.options.secureStore.setItemAsync;
    f.options.secureStore.setItemAsync = async (...args) => {
      await original(...args);
      f.stop();
    };
    await assert.rejects(
      a.compareAndSwap(key, old, "new-secret"),
      /session changed/,
    );
    assert.equal(f.values.get(key) ?? null, old);
  }
});
test("owner change during erase restores previous value", async () => {
  const f = fixture(),
    a = await f.create(),
    key = a.directoryKey;
  f.values.set(key, "previous");
  const original = f.options.secureStore.deleteItemAsync;
  f.options.secureStore.deleteItemAsync = async (...args) => {
    await original(...args);
    f.stop();
  };
  await assert.rejects(
    a.compareAndSwap(key, "previous", null),
    /session changed/,
  );
  assert.equal(f.values.get(key), "previous");
});
test("late owner rollback preserves external replacement", async () => {
  const f = fixture(),
    a = await f.create(),
    key = a.directoryKey;
  f.options.secureStore.setItemAsync = async () => {
    f.values.set(key, "external");
    f.stop();
  };
  await assert.rejects(
    a.compareAndSwap(key, null, "new-secret"),
    /session changed/,
  );
  assert.equal(f.values.get(key), "external");
});
test("native committed-then-rejected write is rolled back and sanitized", async () => {
  const f = fixture(),
    a = await f.create(),
    key = a.directoryKey;
  f.values.set(key, "previous");
  f.options.secureStore.setItemAsync = async (k, v) => {
    f.values.set(k, v);
    if (v === "new-secret") throw new Error("credential body");
  };
  await assert.rejects(
    a.compareAndSwap(key, "previous", "new-secret"),
    /Protected ChatGPT storage is unavailable\. Try again\./,
  );
  assert.equal(f.values.get(key), "previous");
  assert.equal(await a.read(key), "previous");
});
test("rollback failure reports storage uncertainty instead of success", async () => {
  const f = fixture(),
    a = await f.create(),
    key = a.directoryKey;
  f.values.set(key, "previous");
  f.options.secureStore.setItemAsync = async (k, v) => {
    if (v === "previous") throw new Error("secret");
    f.values.set(k, v);
    f.stop();
  };
  await assert.rejects(
    a.compareAndSwap(key, "previous", "new"),
    /storage is unavailable/,
  );
});
test("UTF8 byte limits reject oversized persisted and proposed secrets", async () => {
  const f = fixture(),
    a = await f.create(),
    key = a.directoryKey;
  assert.throws(
    () => a.compareAndSwap(key, null, "😀".repeat(65537)),
    /storage is unavailable/,
  );
  assert.equal(await a.compareAndSwap(key, null, "😀".repeat(65536)), true);
  f.values.set(key, "é".repeat(131073));
  await assert.rejects(a.read(key), /storage is unavailable/);
});
test("failed reads do not poison key queue and never reveal native errors", async () => {
  const f = fixture(),
    a = await f.create(),
    key = a.directoryKey,
    original = f.options.secureStore.getItemAsync;
  f.options.secureStore.getItemAsync = async () => {
    throw new Error("secret token");
  };
  await assert.rejects(
    a.read(key),
    /^Error: Protected ChatGPT storage is unavailable\. Try again\.$/,
  );
  f.options.secureStore.getItemAsync = original;
  assert.equal(await a.compareAndSwap(key, null, "ok"), true);
});
test("changed owner blocks new operations before reading or writing", async () => {
  const f = fixture(),
    a = await f.create();
  f.stop();
  await assert.rejects(a.read(a.directoryKey), /session changed/);
  await assert.rejects(
    a.compareAndSwap(a.directoryKey, null, "secret"),
    /session changed/,
  );
  assert.equal(f.values.size, 0);
});
test("invalid owner inputs produce sanitized errors", async () => {
  for (const url of [
    "ftp://fixture.invalid",
    "https://user:secret@fixture.invalid",
    "https://fixture.invalid?secret=1",
    "invalid-secret",
  ]) {
    const f = fixture();
    f.options.owner.apiBaseUrl = url;
    await assert.rejects(
      f.create(),
      /^Error: Protected ChatGPT storage is unavailable\. Try again\.$/,
    );
  }
});
test("queued work checks captured owner after waiting for earlier adapter", async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.create(),
    key = a.directoryKey;
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.options.secureStore.getItemAsync;
  let reads = 0;
  f.options.secureStore.getItemAsync = async (...args) => {
    reads++;
    started();
    await wait;
    return original(...args);
  };
  const first = a.read(key);
  await entered;
  const second = b.compareAndSwap(key, null, "secret");
  f.stop();
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(
    results.every((result) => result.status === "rejected"),
    true,
  );
  assert.equal(reads, 1);
  assert.equal(f.values.size, 0);
});
test("owner changes during native reads never return credentials", async () => {
  const f = fixture(),
    a = await f.create(),
    key = a.directoryKey;
  f.values.set(key, "private-token");
  f.options.secureStore.getItemAsync = async () => {
    f.stop();
    return "private-token";
  };
  await assert.rejects(
    a.read(key),
    /^Error: The Orbyn session changed\. Try again\.$/,
  );
});
