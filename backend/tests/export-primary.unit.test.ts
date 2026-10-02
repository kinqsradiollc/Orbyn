import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import {
  EXPORT_FORMATS,
  EXPORT_LABELS,
  exportName,
  fail,
  serializeDoc,
  type DocBlock,
} from "@orbyn/core";

/** Execute the actual export route with distinct primary/replica dependencies. */
function fixture({
  visible = true,
  status = 0,
  path = "/docs/:id/export",
  visibleAfterRender = visible,
  versionAfterRender = 8,
} = {}) {
  const source = ts.createSourceFile(
    "routes.ts",
    readFileSync(
      new URL("../src/modules/docs/routes.ts", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );
  let callback: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.arguments[0]?.getText(source) === JSON.stringify(path)
    )
      callback = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback, "The real export route must exist.");
  const content: DocBlock[] = [
    { type: "paragraph", text: "Current primary content" },
  ];
  let reads = 0;
  const dependencies: unknown[] = [];
  const pool = {
    query: async () => {
      reads++;
      return {
        rows: (reads > 1 ? visibleAfterRender : visible)
          ? [
              {
                title: "Current title",
                content,
                version: reads > 1 ? versionAfterRender : 8,
              },
            ]
          : [],
      };
    },
  };
  const exports: {
    handler?: (request: unknown, reply: unknown) => Promise<unknown>;
  } = {};
  const render = () => "Current exported content";
  runInNewContext(
    ts.transpileModule(
      `const handler = ${callback.getText(source)}; exports.handler = handler;`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    {
      exports,
      AbortController,
      Buffer,
      z,
      pool,
      EXPORT_FORMATS,
      EXPORT_LABELS,
      exportName,
      fail,
      serializeDoc,
      authenticate: async () => {
        if (status) fail(status, "Fixture denial");
        return { id: "owner" };
      },
      idParam: () => "page",
      VISIBLE: "visible-to-owner",
      // A stale replica would still report version7 and visibility after revocation.
      reader: () => {
        throw new Error("A file export must not consult the stale replica.");
      },
      withTaskState: async (db: unknown, _id: string, blocks: DocBlock[]) => {
        dependencies.push(db);
        return blocks;
      },
      readableLinks: async (db: unknown, _id: string, blocks: DocBlock[]) => {
        dependencies.push(db);
        return blocks;
      },
      blocksWithWebLinks: (blocks: DocBlock[]) => blocks,
      env: { APP_URL: "https://fixture.invalid" },
      docToDocx: render,
      exportRenderedPdf: render,
      exportImages: async (db: unknown) => {
        dependencies.push(db);
        return { fileUrl: () => null, revalidate: async () => {} };
      },
      docToHtml: render,
      docToText: render,
      docToMarkdown: render,
      createMathHtml: () => undefined,
      serializeDoc,
      contentDisposition: (_kind: string, name: string) => name,
    },
  );
  const run = async (query: unknown) => {
    const raw = new EventEmitter();
    const reply = {
      raw: new EventEmitter(),
      type: () => reply,
      header: () => reply,
      send: (body: unknown) => body,
    };
    try {
      return await exports.handler!({ query, headers: {}, raw }, reply);
    } finally {
      assert.equal(raw.listenerCount("aborted"), 0);
      assert.equal(reply.raw.listenerCount("close"), 0);
    }
  };
  return { run, reads: () => reads, dependencies, pool };
}

for (const format of EXPORT_FORMATS) {
  test(`${format} export uses current primary revision and helper reads without a consistency header`, async () => {
    const view = fixture();
    assert.equal(
      await view.run({ format, version: 8 }),
      "Current exported content",
    );
    assert.equal(view.reads(), format === "pdf" || format === "html" ? 2 : 1);
    assert.deepEqual(
      view.dependencies,
      format === "pdf" || format === "html"
        ? [view.pool, view.pool, view.pool]
        : [view.pool, view.pool],
    );
    assert.equal(await view.run({ format }), "Current exported content");
  });
  test(`${format} refuses a superseded revision even if the replica would match`, async () => {
    const view = fixture();
    await assert.rejects(view.run({ format, version: 7 }), { statusCode: 409 });
    assert.deepEqual(view.dependencies, []);
  });
}

test("revoked primary visibility takes precedence over matching replica revision", async () => {
  const view = fixture({ visible: false });
  await assert.rejects(view.run({ format: "html", version: 7 }), {
    statusCode: 404,
  });
  assert.deepEqual(view.dependencies, []);
});
for (const status of [401, 403, 429, 400]) {
  test(`export denial ${status} performs no primary or replica content reads`, async () => {
    const view = fixture({ status });
    await assert.rejects(view.run({ format: "html", version: 8 }), {
      statusCode: status,
    });
    assert.equal(view.reads(), 0);
  });
}

test("legacy Markdown file uses primary content and all primary helper reads", async () => {
  const view = fixture({ path: "/docs/:id/markdown" });
  assert.match(String(await view.run({})), /Current primary content/);
  assert.deepEqual(view.dependencies, [view.pool, view.pool]);
});

test("legacy Markdown export refuses stale replica visibility after revocation", async () => {
  const view = fixture({ path: "/docs/:id/markdown", visible: false });
  await assert.rejects(view.run({}), { statusCode: 404 });
  assert.deepEqual(view.dependencies, []);
});

for (const status of [401, 403, 429, 400]) {
  test(`legacy Markdown export denial ${status} reads no content`, async () => {
    const view = fixture({ path: "/docs/:id/markdown", status });
    await assert.rejects(view.run({}), { statusCode: status });
    assert.equal(view.reads(), 0);
  });
}

for (const format of ["html", "pdf"]) {
  test(`${format} fences access and revision after materializing its snapshot`, async () => {
    await assert.rejects(
      fixture({ visibleAfterRender: false }).run({ format }),
      { statusCode: 404 },
    );
    await assert.rejects(fixture({ versionAfterRender: 9 }).run({ format }), {
      statusCode: 409,
    });
  });
}
