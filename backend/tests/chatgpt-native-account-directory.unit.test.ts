import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as core from "@orbyn/core";

const output: any = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL(
        "../../mobile/src/lib/chatgpt-account-directory.ts",
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
    Set,
    Promise,
    require: (name: string) => {
      if (name === "zod") return { z };
      if (name === "@orbyn/core") return core;
      throw new Error("Unexpected dependency");
    },
  },
);
const connection = () => ({
  id: randomUUID(),
  issuer: "https://auth.openai.com",
  subject: randomUUID(),
  client_id: `oaiapp_${randomUUID()}`,
});
function fixture() {
  const storage = new Map<string, string>();
  let active = true;
  const options = {
    owner: {
      apiBaseUrl: "https://fixture.orbyn.invalid/api",
      userId: randomUUID(),
    },
    revision: randomUUID,
    digest: async (value: string) =>
      createHash("sha256").update(value).digest("hex"),
    checkOwner: () => {
      if (!active) throw new Error("The Orbyn session changed.");
    },
    storage: {
      read: async (key: string) => storage.get(key) ?? null,
      compareAndSwap: async (
        key: string,
        expected: string | null,
        replacement: string,
      ) => {
        if ((storage.get(key) ?? null) !== expected) return false;
        storage.set(key, replacement);
        return true;
      },
    },
  };
  return {
    options,
    storage,
    directory: output.createNativeChatgptAccountDirectory(options),
    stop: () => {
      active = false;
    },
  };
}
test("native directory keeps registrations separate and returns no credentials", async () => {
  const f = fixture(),
    a = connection(),
    b = connection();
  assert.equal(await f.directory.read(), null);
  let state = await f.directory.add(a, null);
  state = await f.directory.add(b, state.revision);
  assert.equal(state.accounts.length, 2);
  assert.equal(state.selected, null);
  state = await f.directory.select(a.id, state.revision);
  state = await f.directory.select(b.id, state.revision);
  assert.equal(state.selected, b.id);
  state.accounts[0].connection.subject = "mutated-output";
  assert.notEqual(
    (await f.directory.read()).accounts[0].connection.subject,
    "mutated-output",
  );
  assert.doesNotMatch(
    JSON.stringify([...f.storage.values()]),
    /access_token|refresh_token|id_token|grant|scopes/,
  );
});
test("native directory rejects stale and racing selection revisions", async () => {
  const f = fixture(),
    a = connection(),
    b = connection();
  const first = await f.directory.add(a, null);
  const state = await f.directory.add(b, first.revision);
  await assert.rejects(
    f.directory.select(a.id, first.revision),
    /selection changed/,
  );
  const results = await Promise.allSettled([
    f.directory.select(a.id, state.revision),
    f.directory.select(b.id, state.revision),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
test("retired native accounts retain mappings but cannot remain selected", async () => {
  const f = fixture(),
    a = connection();
  let state = await f.directory.add(a, null);
  state = await f.directory.select(a.id, state.revision);
  state = await f.directory.markUnavailable(a.id, "reconnect", state.revision);
  assert.equal(state.selected, null);
  assert.equal(state.accounts[0].connection.client_id, a.client_id);
  await assert.rejects(
    f.directory.select(a.id, state.revision),
    /selection changed/,
  );
  state = await f.directory.add(a, state.revision);
  state = await f.directory.select(a.id, state.revision);
  assert.equal(state.selected, a.id);
});
test("native directory rejects identity substitution and duplicate issued registrations", async () => {
  const f = fixture(),
    a = connection();
  const state = await f.directory.add(a, null);
  await assert.rejects(
    f.directory.add({ ...a, subject: "other" }, state.revision),
    /selection changed/,
  );
  await assert.rejects(
    f.directory.add({ ...a, id: randomUUID() }, state.revision),
  );
  assert.equal((await f.directory.read()).revision, state.revision);
});
test("native directory rejects another owner even after a storage-key collision", async () => {
  const f = fixture();
  await f.directory.add(connection(), null);
  const digest = [...f.storage.keys()][0].split(".").at(-1)!;
  const other = output.createNativeChatgptAccountDirectory({
    ...f.options,
    owner: { ...f.options.owner, userId: randomUUID() },
    digest: async () => digest,
  });
  await assert.rejects(other.read(), /directory is unavailable/);
});
test("malformed or credential-bearing directory records never enter diagnostics", async () => {
  const f = fixture();
  await f.directory.add(connection(), null);
  const [key, raw] = [...f.storage][0];
  for (const invalid of [
    "private-refresh",
    JSON.stringify({ ...JSON.parse(raw), grant: "private-refresh" }),
    JSON.stringify({ ...JSON.parse(raw), selected: randomUUID() }),
  ]) {
    f.storage.set(key, invalid);
    await assert.rejects(f.directory.read(), (error: unknown) => {
      assert.match(String(error), /directory is unavailable/);
      assert.doesNotMatch(String(error), /private-refresh/);
      return true;
    });
  }
});
test("native directory fences session replacement before returning or committing selection", async () => {
  const f = fixture();
  const read = f.options.storage.read;
  f.options.storage.read = async (key) => {
    const raw = await read(key);
    f.stop();
    return raw;
  };
  await assert.rejects(f.directory.add(connection(), null), /session changed/);
  assert.equal(f.storage.size, 0);
});
test("native directory sanitizes storage failures and rejects unsafe owners", async () => {
  const f = fixture();
  f.options.storage.read = async () => {
    throw new Error("private-refresh");
  };
  await assert.rejects(
    f.directory.read(),
    (error: unknown) => !String(error).includes("private-refresh"),
  );
  for (const base of [
    "https://user:secret@fixture.invalid/api",
    "ftp://public.invalid/api",
    "https://fixture.invalid/api?access_token=secret",
  ])
    assert.throws(() =>
      output.createNativeChatgptAccountDirectory({
        ...f.options,
        owner: { ...f.options.owner, apiBaseUrl: base },
      }),
    );
});

test("native directory bounds persisted size and account count without changing a valid revision", async () => {
  const f = fixture();
  let state = await f.directory.add(connection(), null);
  for (let i = 1; i < 100; i++)
    state = await f.directory.add(connection(), state.revision);
  await assert.rejects(f.directory.add(connection(), state.revision));
  assert.equal((await f.directory.read()).revision, state.revision);
  const key = [...f.storage.keys()][0];
  f.storage.set(key, "x".repeat(262145));
  await assert.rejects(f.directory.read(), /directory is unavailable/);
});
test("native directory sanitizes compare-and-swap and digest faults and can retry digest discovery", async () => {
  const f = fixture();
  let first = true;
  const digest = f.options.digest;
  f.options.digest = async (value) => {
    if (first) {
      first = false;
      throw new Error("private-refresh");
    }
    return digest(value);
  };
  await assert.rejects(
    f.directory.read(),
    (error: unknown) => !String(error).includes("private-refresh"),
  );
  assert.equal(await f.directory.read(), null);
  f.options.storage.compareAndSwap = async () => {
    throw new Error("private-refresh");
  };
  await assert.rejects(
    f.directory.add(connection(), null),
    (error: unknown) => !String(error).includes("private-refresh"),
  );
  assert.equal(f.storage.size, 0);
});

test("native directory rejects a reused revision before storing a mutation", async () => {
  const f = fixture(),
    a = connection();
  const state = await f.directory.add(a, null);
  f.options.revision = () => state.revision;
  await assert.rejects(
    f.directory.select(a.id, state.revision),
    /selection changed/,
  );
  assert.equal((await f.directory.read()).selected, null);
});
