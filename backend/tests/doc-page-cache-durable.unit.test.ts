import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";

const source = readFileSync(
  new URL("../../mobile/src/lib/pageCache.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const doc = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 2,
  title: "Offline page",
  content: [{ type: "paragraph", text: "Recovered" }],
  updated_at: "2026-10-10T00:00:00.000Z",
} as core.Doc;

function fixture(
  storage: Map<string, string>,
  write?: (value: string) => Promise<void>,
) {
  const exports: {
    rememberPageDurable?: (value: core.Doc) => Promise<void>;
    keptPage?: (id: string) => Promise<core.Doc | null>;
  } = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "@orbyn/core") return core;
      if (name === "@react-native-async-storage/async-storage")
        return {
          getItem: async (key: string) => storage.get(key) ?? null,
          setItem: async (key: string, value: string) => {
            await write?.(value);
            storage.set(key, value);
          },
          removeItem: async (key: string) => {
            storage.delete(key);
          },
        };
      throw new Error(`Unmocked module ${name}`);
    },
  });
  return exports;
}

test("durable page cache waits for storage and survives a new process", async () => {
  const storage = new Map<string, string>();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = fixture(storage, async () => pending);
  let settled = false;
  const saving = first.rememberPageDurable!(doc).then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.equal(storage.size, 0);
  release();
  await saving;
  assert.equal(settled, true);
  const restarted = fixture(storage);
  assert.equal(
    (await restarted.keptPage!(doc.id))?.content[0].text,
    "Recovered",
  );
});

test("durable page cache reports storage rejection", async () => {
  const storage = new Map<string, string>();
  const cache = fixture(storage, async () => {
    throw new Error("Storage full");
  });
  await assert.rejects(cache.rememberPageDurable!(doc), /Storage full/);
  assert.equal(storage.size, 0);
});
