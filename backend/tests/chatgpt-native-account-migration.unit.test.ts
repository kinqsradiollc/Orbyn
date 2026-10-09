import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as core from "@orbyn/core";
import * as api from "@orbyn/api-client";
function load(name: string) {
  const output: any = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL(`../../mobile/src/lib/${name}.ts`, import.meta.url),
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
      Map,
      Set,
      Promise,
      require: (dep: string) => {
        if (dep === "zod") return { z };
        if (dep === "@orbyn/core") return core;
        if (dep === "@orbyn/api-client") return api;
        if (dep === "expo-secure-store")
          return { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "protected" };
        if (dep === "expo-crypto")
          return {
            CryptoDigestAlgorithm: { SHA256: "sha256" },
            digestStringAsync: async (_: string, value: string) =>
              digest(value),
          };
        throw new Error("Unexpected dependency");
      },
    },
  );
  return output;
}
const digest = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
const protectedModule = load("chatgpt-protected-store"),
  directoryModule = load("chatgpt-account-directory"),
  migrationModule = load("chatgpt-account-migration");
async function fixture(retired = false) {
  const values = new Map<string, string>();
  let active = true;
  const owner = {
    apiBaseUrl: "https://fixture.orbyn.invalid/api",
    userId: randomUUID(),
  };
  const guard = () => {
    if (!active) throw new Error("private session");
  };
  const native = {
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
  const storage = await protectedModule.createNativeChatgptProtectedStore({
    owner,
    checkOwner: guard,
    secureStore: native,
  });
  const directory = directoryModule.createNativeChatgptAccountDirectory({
    owner,
    checkOwner: guard,
    digest,
    revision: randomUUID,
    storage,
  });
  const connection = {
    id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: randomUUID(),
    client_id: "oaiapp_fixture",
  };
  const grant = {
    clientId: connection.client_id,
    accessToken: "private-access",
    refreshToken: "private-refresh",
    idToken: "private-id",
    scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
    sharingGranted: true,
    savedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };
  const original = JSON.stringify({
    version: retired ? 2 : 1,
    revision: randomUUID(),
    connection,
    grant: retired ? null : grant,
  });
  values.set(storage.legacyKey, original);
  return {
    values,
    native,
    storage,
    directory,
    connection,
    grant,
    original,
    stop: () => {
      active = false;
    },
    migrate: () =>
      migrationModule.migrateNativeChatgptSingleton({
        storage,
        directory,
        checkOwner: guard,
      }),
  };
}
test("singleton migration transfers exact credentials and signing alias without exposing tokens", async () => {
  const f = await fixture(),
    state = await f.migrate();
  assert.equal(state.selected, f.connection.id);
  assert.equal(f.values.has(f.storage.legacyKey), false);
  const slot = JSON.parse(f.values.get(f.storage.slotKey(f.connection.id))!);
  assert.deepEqual(slot.grant, f.grant);
  assert.equal(slot.signingAlias, f.storage.legacyKey.split(".").at(-1));
  assert.doesNotMatch(
    JSON.stringify(state),
    /private-access|private-refresh|private-id|grant/,
  );
  assert.deepEqual(await f.migrate(), state);
});
test("retired singleton stays unselected and token-free", async () => {
  const f = await fixture(true),
    state = await f.migrate();
  assert.equal(state.selected, null);
  assert.equal(state.accounts[0].status, "reconnect");
  assert.equal(
    JSON.parse(f.values.get(f.storage.slotKey(f.connection.id))!).grant,
    null,
  );
});
test("interrupted directory publication keeps original and resumes exact staged slot", async () => {
  const f = await fixture(),
    set = f.native.setItemAsync;
  f.native.setItemAsync = async (key, value) => {
    if (key === f.storage.directoryKey) throw new Error("secret failure");
    await set(key, value);
  };
  await assert.rejects(f.migrate(), /directory is unavailable/);
  assert.equal(f.values.get(f.storage.legacyKey), f.original);
  assert.equal(f.values.has(f.storage.slotKey(f.connection.id)), true);
  f.native.setItemAsync = set;
  await f.migrate();
  assert.equal(f.values.has(f.storage.legacyKey), false);
});
test("interrupted legacy erasure resumes after directory commit", async () => {
  const f = await fixture(),
    erase = f.native.deleteItemAsync;
  f.native.deleteItemAsync = async (key) => {
    if (key === f.storage.legacyKey) throw new Error("private erase");
    await erase(key);
  };
  await assert.rejects(f.migrate(), /storage is unavailable/);
  assert.equal((await f.directory.read()).selected, f.connection.id);
  assert.equal(f.values.get(f.storage.legacyKey), f.original);
  f.native.deleteItemAsync = erase;
  await f.migrate();
  assert.equal(f.values.has(f.storage.legacyKey), false);
});
test("populated different directory is preserved without staging singleton credentials", async () => {
  const f = await fixture();
  await f.directory.add(
    {
      ...f.connection,
      id: randomUUID(),
      subject: "other",
      client_id: "oaiapp_other",
    },
    null,
  );
  const before = f.values.get(f.storage.directoryKey);
  await assert.rejects(f.migrate(), /account changed/);
  assert.equal(f.values.get(f.storage.directoryKey), before);
  assert.equal(f.values.get(f.storage.legacyKey), f.original);
  assert.equal(f.values.has(f.storage.slotKey(f.connection.id)), false);
});
test("conflicting credential slot is never overwritten", async () => {
  const f = await fixture(),
    key = f.storage.slotKey(f.connection.id);
  f.values.set(key, "newer-protected-slot");
  await assert.rejects(f.migrate(), /account changed/);
  assert.equal(f.values.get(key), "newer-protected-slot");
  assert.equal(f.values.get(f.storage.legacyKey), f.original);
});
test("newer singleton written before cleanup survives exact compare-and-swap", async () => {
  const f = await fixture(),
    install = f.directory.importSingleton;
  f.directory.importSingleton = async (...args: any[]) => {
    const state = await install(...args);
    f.values.set(f.storage.legacyKey, "newer-record");
    return state;
  };
  await assert.rejects(f.migrate(), /account changed/);
  assert.equal(f.values.get(f.storage.legacyKey), "newer-record");
});
test("invalid credential binding and malformed legacy data are sanitized and preserved", async () => {
  for (const raw of [
    "secret-invalid-json",
    JSON.stringify({
      version: 1,
      revision: randomUUID(),
      connection: {
        id: randomUUID(),
        issuer: "https://auth.openai.com",
        subject: "subject",
        client_id: "oaiapp_wrong",
      },
      grant: { private: "credential" },
    }),
  ]) {
    const f = await fixture();
    f.values.set(f.storage.legacyKey, raw);
    await assert.rejects(
      f.migrate(),
      /^Error: The saved ChatGPT account migration is unavailable\. Try again\.$/,
    );
    assert.equal(f.values.get(f.storage.legacyKey), raw);
    assert.equal(f.values.size, 1);
  }
});
test("owner change during slot install preserves original and removes late staged credentials", async () => {
  const f = await fixture(),
    set = f.native.setItemAsync;
  f.native.setItemAsync = async (key, value) => {
    await set(key, value);
    if (key.startsWith("orbyn.chatgpt.slot.")) f.stop();
  };
  await assert.rejects(f.migrate(), /session changed/);
  assert.equal(f.values.get(f.storage.legacyKey), f.original);
  assert.equal(f.values.size, 1);
});
