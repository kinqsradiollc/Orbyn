import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
import {
  parseVersionedDocContent,
  versionedDocRead,
  versionedDocSave,
  parseDocContainers,
  docContainerBlocks,
} from "@orbyn/core";
const id = "00000000-0000-4000-8000-000000000001";
const document = { format: 1 as const, blocks: [] };

test("editor read gets metadata and complete ownership from one fresh request", async () => {
  const nodes = parseDocContainers("> - Words ^words\n^outer", {
    anchors: true,
  });
  let calls = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).pathname, `/docs/${id}`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-orbyn-doc-formats"), "1,2");
      assert.equal(headers.has("if-none-match"), false);
      return Response.json(
        {
          id,
          title: "Page",
          version: calls,
          content: docContainerBlocks(nodes),
          document: { format: 2, nodes },
          project_id: "project",
        },
        { headers: { etag: "fixture" } },
      );
    },
  });
  const first = await client.getDocForEditor(id);
  assert.equal(first.version, 1);
  assert.equal(first.project_id, "project");
  assert.deepEqual(first.document, { format: 2, nodes });
  assert.equal((await client.getDocForEditor(id)).version, 2);
  assert.equal(calls, 2);
});

test("editor reads reject missing ownership, unsupported format and mismatched projections", async () => {
  const nodes = parseDocContainers("> Words ^words", { anchors: true });
  const valid = {
    id,
    title: "Page",
    version: 1,
    content: docContainerBlocks(nodes),
    document: { format: 2, nodes },
  };
  let reply: unknown = valid;
  let calls = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async () => {
      calls++;
      return Response.json(reply);
    },
  });
  for (const malformed of [
    { ...valid, document: undefined },
    { ...valid, document: { format: 3, nodes } },
    { ...valid, content: [{ type: "paragraph", text: "Other" }] },
    { ...valid, id: "00000000-0000-4000-8000-000000000002" },
    { ...valid, version: -1 },
  ]) {
    reply = malformed;
    await assert.rejects(client.getDocForEditor(id));
  }
  assert.equal(calls, 5, "no second flat read or fallback request");
  await assert.rejects(client.getDocForEditor("../outside"));
  assert.equal(calls, 5);
});

test("normal editor saves metadata and complete ownership in one guarded request", async () => {
  const nodes = parseDocContainers("> Changed ^words", { anchors: true });
  let calls = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).pathname, `/docs/${id}`);
      assert.equal(init?.method, "PUT");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.title, "New title");
      assert.equal(body.version, 4);
      assert.deepEqual(body.document, { format: 2, nodes });
      assert.equal("content" in body, false);
      assert.equal(new Headers(init?.headers).get("x-orbyn-ticks-from"), "3");
      return Response.json({
        id,
        title: body.title,
        version: 5,
        document: body.document,
        content: docContainerBlocks(nodes),
        updated_at: "2026-10-06T00:00:00Z",
      });
    },
  });
  const saved = await client.updateDocForEditor(
    id,
    { title: "New title", version: 4, document: { format: 2, nodes } },
    { ticksFrom: 3 },
  );
  assert.equal(saved.version, 5);
  assert.equal(saved.updated_at, "2026-10-06T00:00:00Z");
  assert.equal(calls, 1);
  await assert.rejects(
    client.updateDocForEditor(id, {
      title: "New title",
      version: 4,
      document: { format: 2, nodes },
      content: [],
    } as any),
  );
  assert.equal(calls, 1);
});

test("normal editor save refuses a wrong revision or unsupported server without fallback", async () => {
  let version = 1,
    calls = 0,
    refused = false;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async () => {
      calls++;
      return refused
        ? Response.json({ message: "Unsupported" }, { status: 409 })
        : Response.json({ id, title: "Page", version, content: [], document });
    },
  });
  await assert.rejects(
    client.updateDocForEditor(id, { version: 1, document }),
    /revision/,
  );
  version = 2;
  assert.equal(
    (await client.updateDocForEditor(id, { version: 1, document })).version,
    2,
  );
  refused = true;
  await assert.rejects(
    client.updateDocForEditor(id, { version: 2, document }),
    { statusCode: 409 },
  );
  assert.equal(calls, 3);
});

test("content client declares capabilities and reads fresh revisions", async () => {
  let calls = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async (url, init) => {
      assert.equal(new URL(String(url)).pathname, `/docs/${id}/content`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-orbyn-doc-formats"), "1,2");
      assert.equal(headers.has("if-none-match"), false);
      return Response.json(
        { id, title: "Page", version: ++calls, document },
        { headers: { etag: "fixture" } },
      );
    },
  });
  assert.equal((await client.getDocContent(id)).version, 1);
  assert.equal((await client.getDocContent(id)).version, 2);
});

test("content client rejects wrong identity and saved revision", async () => {
  let result = {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Page",
    version: 2,
    document,
  };
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async () => Response.json(result),
  });
  await assert.rejects(client.getDocContent(id), /identity/);
  result = { ...result, id, version: 1 };
  await assert.rejects(client.updateDocContent(id, 1, document), /revision/);
  result.version = 2;
  assert.equal((await client.updateDocContent(id, 1, document)).version, 2);
  await assert.rejects(client.getDocContent("../another-page"));
});

test("unsupported structure never causes an automatic flat save", async () => {
  let calls = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async () => {
      calls++;
      return Response.json({ message: "Unsupported format" }, { status: 409 });
    },
  });
  await assert.rejects(
    client.updateDocContent(id, 1, { format: 2, nodes: [] }),
    { statusCode: 409 },
  );
  assert.equal(calls, 1);
});

test("privacy projections allow expanded text but stored validation stays strict", () => {
  const text = "Private page ".repeat(1000);
  const expanded = {
    format: 2 as const,
    nodes: [
      {
        kind: "quote" as const,
        children: [
          {
            kind: "block" as const,
            block: { type: "paragraph" as const, id: "words", text },
          },
        ],
      },
    ],
  };
  assert.throws(() => parseVersionedDocContent(expanded));
  assert.deepEqual(
    parseVersionedDocContent(expanded, { projected: true }),
    expanded,
  );
  assert.equal(
    versionedDocRead.parse({
      id,
      title: "Page",
      version: 1,
      document: expanded,
    }).document.format,
    2,
  );
  assert.equal(
    versionedDocSave.parse({ version: 1, document: expanded }).document.format,
    2,
  );
  assert.throws(() =>
    parseVersionedDocContent(
      { format: 1, blocks: [{ type: "paragraph", text, unknown: true }] },
      { projected: true },
    ),
  );
  assert.throws(() =>
    parseVersionedDocContent(
      { format: 1, blocks: [{ type: "paragraph", text: "x".repeat(480001) }] },
      { projected: true },
    ),
  );
});

test("content client forwards cancellation and rejects unexpected response fields", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | null | undefined;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async (_url, init) => {
      seen = init?.signal;
      return Response.json({
        id,
        title: "Page",
        version: 1,
        document,
        unknown: true,
      });
    },
  });
  await assert.rejects(client.getDocContent(id, { signal: controller.signal }));
  assert.ok(seen);
  assert.equal(seen.aborted, false);
  controller.abort("fixture cancelled");
  assert.equal(seen.aborted, true);
  assert.equal(seen.reason, "fixture cancelled");
});
