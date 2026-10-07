import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import ts from "typescript";

test("API client sends the embedding revision to its separate read-only catalog route", async () => {
  const source = readFileSync(
    new URL("../../packages/api-client/src/client.ts", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "client.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let method: string | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isMethodDeclaration(node) &&
      node.name.getText(tree) === "listAiEmbeddingModels"
    )
      method = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(method);
  const code = ts.transpileModule(`({ ${method} }).listAiEmbeddingModels`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fn = runInNewContext(code);
  let request: any;
  fn.call(
    {
      request: (url: string, options: any) => {
        request = { url, options };
      },
    },
    "selected",
    "29",
  );
  assert.equal(request.url, "/ai/providers/selected/embedding-models");
  assert.equal(request.options.method, "POST");
  assert.equal(
    JSON.stringify(request.options.body),
    JSON.stringify({ expected_revision: "29" }),
  );
});

function harness(platform: string) {
  const source = readFileSync(
    new URL(
      `../../${platform}/src/hooks/useEmbeddingModelCatalog.ts`,
      import.meta.url,
    ),
    "utf8",
  );
  const slots: any[] = [];
  let cursor = 0;
  const effects: (() => void)[] = [];
  const requests: {
    id: string;
    revision: string;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  const hooks = {
    useRef(value: any) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useState(value: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = value;
      return [
        slots[i],
        (next: any) => {
          slots[i] = next;
        },
      ];
    },
    useEffect(fn: () => () => void, deps: any[]) {
      const i = cursor++;
      const old = slots[i];
      if (!old || deps.some((value, index) => value !== old.deps[index])) {
        effects.push(() => {
          old?.cleanup?.();
          slots[i] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const client = {
    listAiEmbeddingModels(id: string, revision: string) {
      return new Promise((resolve, reject) =>
        requests.push({ id, revision, resolve, reject }),
      );
    },
  };
  const module = { exports: {} as any };
  runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    exports: module.exports,
    module,
    require(name: string) {
      if (name === "react") return hooks;
      if (name.endsWith("/lib/api")) return { client };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    requests,
    render(provider: any) {
      cursor = 0;
      const result = module.exports.useEmbeddingModelCatalog(provider);
      while (effects.length) effects.shift()!();
      return result;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}
const provider = (id = "one", revision = "7", enabled = true) => ({
  id,
  embedding_revision: revision,
  enabled,
});
const catalog = (revision = "7") => ({
  provider_revision: revision,
  models: ["last-249"],
  catalog_kind: "unclassified",
});

for (const platform of ["desktop", "mobile"]) {
  test(`${platform} discovery sends only selected embedding identity and returns loading/catalog state`, async () => {
    const h = harness(platform);
    const p = provider();
    h.render(p);
    const pending = h.render(p).load();
    assert.equal(h.render(p).loading, true);
    assert.equal(h.requests[0].id, "one");
    assert.equal(h.requests[0].revision, "7");
    h.requests[0].resolve(catalog());
    await pending;
    assert.deepEqual(h.render(p).catalog?.models, ["last-249"]);
    assert.equal(h.render(p).loading, false);
  });
  for (const change of ["provider", "revision", "disable", "unmount"]) {
    test(`${platform} ignores catalog after ${change}`, async () => {
      const h = harness(platform);
      const p = provider();
      h.render(p);
      const pending = h.render(p).load();
      const next =
        change === "provider"
          ? provider("two")
          : change === "revision"
            ? provider("one", "8")
            : provider("one", "7", false);
      if (change === "unmount") h.unmount();
      else h.render(next);
      h.requests[0].resolve(catalog());
      await pending;
      assert.equal(h.render(next).catalog, undefined);
    });
  }
  test(`${platform} newer refresh wins and an obsolete failure cannot replace its catalog`, async () => {
    const h = harness(platform);
    const p = provider();
    h.render(p);
    const first = h.render(p).load();
    const second = h.render(p).load();
    h.requests[1].resolve(catalog());
    await second;
    h.requests[0].reject(new Error("obsolete error"));
    await first;
    assert.equal(h.render(p).error, undefined);
    assert.deepEqual(h.render(p).catalog?.models, ["last-249"]);
  });
  test(`${platform} mismatched revision never publishes models; disabled provider never dispatches`, async () => {
    const h = harness(platform);
    const p = provider();
    h.render(p);
    const pending = h.render(p).load();
    h.requests[0].resolve(catalog("8"));
    await pending;
    assert.equal(h.render(p).catalog, undefined);
    assert.ok(h.render(p).error);
    h.render(provider("one", "8", false));
    await h.render(provider("one", "8", false)).load();
    assert.equal(h.requests.length, 1);
  });
}
