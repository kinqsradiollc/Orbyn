import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";

test("export client binds a requested document revision and preserves existing callers", async () => {
  const calls: URL[] = [];
  let stale = false;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture-session",
    fetch: async (url, init) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture-session",
      );
      calls.push(new URL(String(url)));
      if (stale)
        return Response.json(
          { message: "This page changed." },
          { status: 409 },
        );
      return new Response("saved page", {
        headers: { "content-disposition": 'attachment; filename="saved.html"' },
      });
    },
  });
  const current = await client.exportDoc("page", "html", { version: 7 });
  assert.equal(calls[0].searchParams.get("version"), "7");
  assert.equal(await current.blob.text(), "saved page");
  assert.equal(current.name, "saved.html");
  await client.exportDoc("page", "md");
  assert.equal(calls[1].searchParams.has("version"), false);
  stale = true;
  await assert.rejects(client.exportDoc("page", "html", { version: 6 }), {
    statusCode: 409,
  });
  assert.equal(
    calls.length,
    3,
    "A stale revision is never silently retried as a new snapshot.",
  );
});
