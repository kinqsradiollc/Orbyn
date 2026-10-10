import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";

const document = {
  format: 2 as const,
  nodes: core.parseDocContainers("> Saved ^words", { anchors: true }),
};
const edited = {
  format: 2 as const,
  nodes: core.parseDocContainers("> Offline ^words", { anchors: true }),
};
const id = "00000000-0000-4000-8000-000000000001";
const remote = {
  id,
  title: "Page",
  version: 1,
  document,
  content: core.docContainerBlocks(document.nodes),
};
const save: core.PageSave = {
  id,
  title: "Page",
  content: core.docContainerBlocks(edited.nodes),
  document: edited,
  base: { title: "Page", version: 1, content: remote.content, document },
};
const source = readFileSync(
  new URL("../../mobile/src/lib/outbox.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function fixture(
  offline = false,
  write?: (key: string, value: string) => Promise<void>,
) {
  const calls: { name: string; args: unknown[] }[] = [];
  const stored: string[] = [];
  const client = {
    getDocForEditor: async (docId: string) => {
      calls.push({ name: "owned-read", args: [docId] });
      return remote;
    },
    getDoc: async (docId: string) => {
      calls.push({ name: "legacy-read", args: [docId] });
      return { ...remote, document: undefined };
    },
    once: async (_key: string, fn: () => Promise<unknown>) => fn(),
    updateDocForEditor: async (...args: unknown[]) => {
      calls.push({ name: "owned-write", args });
      if (offline) throw new TypeError("Failed to fetch");
      return { ...remote, document: edited, content: save.content, version: 2 };
    },
    updateDoc: async (...args: unknown[]) => {
      calls.push({ name: "legacy-write", args });
      return remote;
    },
  };
  const modules: Record<string, unknown> = {
    "@react-native-async-storage/async-storage": {
      getItem: async () => null,
      setItem: async (_key: string, value: string) => {
        if (write) await write(_key, value);
        stored.push(value);
      },
      removeItem: async () => {},
    },
    "@orbyn/core": core,
    "./api": { client },
    "./errors": { errorText: (e: unknown) => String(e) },
    "./pageCache": { rememberPage: async () => {} },
  };
  const exports: {
    run?: (op: core.OutboxOp) => Promise<unknown>;
    savePageOffline?: (save: core.PageSave) => Promise<void>;
    outboxState?: () => { entries: core.OutboxEntry[] };
  } = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unmocked module ${name}`);
      return modules[name];
    },
    setTimeout,
    clearTimeout,
  });
  return { calls, stored, exports };
}

test("actual native replay uses one owned read and atomic full-format write, without flat fallback", async () => {
  const f = fixture();
  await f.exports.run!({ type: "doc.save", save });
  assert.deepEqual(
    f.calls.map((call) => call.name),
    ["owned-read", "owned-write"],
  );
  const [docId, body] = f.calls[1].args as [string, core.DocEditorUpdate];
  assert.equal(docId, id);
  assert.deepEqual(body.document, edited);
  assert.equal(body.version, 1);
  assert.equal("content" in body, false);
  const options = f.calls[1].args[2] as { ticksFrom: number };
  assert.equal(options.ticksFrom, save.base.version);
  assert.deepEqual(Object.keys(options), ["ticksFrom"]);
});

test("offline page receipt waits for durable storage and rejects failed writes", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(false, async () => waiting);
  let settled = false;
  const queued = f.exports.savePageOffline!(save).then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.equal(f.stored.length, 0);
  release();
  await queued;
  assert.equal(settled, true);
  assert.equal(
    (JSON.parse(f.stored[0])[0].op as { save: core.PageSave }).save.document
      ?.format,
    2,
  );

  const rejected = fixture(false, async () => {
    throw new Error("Storage full");
  });
  await assert.rejects(rejected.exports.savePageOffline!(save), /Storage full/);
  assert.equal(rejected.stored.length, 0);
});

test("legacy queued pages retain their legacy transport", async () => {
  const f = fixture();
  const legacy: core.PageSave = {
    ...save,
    document: undefined,
    base: { ...save.base, document: undefined },
  };
  await f.exports.run!({ type: "doc.save", save: legacy });
  assert.deepEqual(
    f.calls.map((call) => call.name),
    ["legacy-read", "legacy-write"],
  );
});

test("an interrupted owned write keeps the whole edit pending without invoking a flat writer", async () => {
  const f = fixture(true);
  assert.equal(await f.exports.run!({ type: "doc.save", save }), null);
  assert.deepEqual(
    f.calls.map((call) => call.name),
    ["owned-read", "owned-write"],
  );
  assert.deepEqual(
    (f.exports.outboxState!().entries[0].op as { save: core.PageSave }).save,
    save,
  );
  assert.deepEqual(
    (JSON.parse(f.stored.at(-1)!)[0].op as { save: core.PageSave }).save
      .document,
    edited,
  );
});

test("persisting offline edits retains complete current and base trees, including mixed protocol queues", async () => {
  const f = fixture();
  const legacy: core.PageSave = {
    ...save,
    document: undefined,
    base: { ...save.base, document: undefined },
  };
  await f.exports.savePageOffline!(legacy);
  await f.exports.savePageOffline!(save);
  const entries = f.exports.outboxState!().entries;
  assert.equal(entries.length, 2);
  const queued = entries[1].op;
  assert.equal(queued.type, "doc.save");
  if (queued.type !== "doc.save") throw new Error("Wrong queue entry");
  assert.deepEqual(queued.save.document, edited);
  assert.deepEqual(queued.save.base.document, document);
  const stored = JSON.parse(f.stored.at(-1)!) as core.OutboxEntry[];
  assert.equal(stored.length, 2);
  assert.deepEqual((stored[1].op as { save: core.PageSave }).save, save);
});
