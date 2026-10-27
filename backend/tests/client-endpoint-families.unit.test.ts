import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
import { HttpError } from "@orbyn/core";

test("the public client facade routes endpoint families through its authenticated transport", async () => {
  const requests: {
    path: string;
    method: string;
    authorization: string | null;
  }[] = [];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture-token",
    fetch: async (input, options) => {
      requests.push({
        path: new URL(String(input)).pathname,
        method: options?.method ?? "GET",
        authorization: new Headers(options?.headers).get("Authorization"),
      });
      return Response.json({});
    },
  });
  await client.listSessions();
  await client.getProject("project-fixture");
  await client.getItem("item-fixture");
  await client.listDocs();
  await client.listBlocks("2026-10-27", "2026-10-28");
  await client.listTeams();
  await client.listViews();
  await client.listNotifications();
  await client.listBookingPages();
  await client.publishingList();
  assert.deepEqual(
    requests.map((request) => request.path),
    [
      "/me/sessions",
      "/projects/project-fixture",
      "/items/item-fixture",
      "/docs",
      "/blocks",
      "/teams",
      "/views",
      "/notifications",
      "/booking-pages",
      "/admin/publishing",
    ],
  );
  assert.ok(
    requests.every(
      (request) =>
        request.method === "GET" &&
        request.authorization === "Bearer fixture-token",
    ),
  );
});

test("a borrowed public method retains its receiver and optional request arguments", async () => {
  const requests: { path: string; body: unknown }[] = [];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async (input, options) => {
      requests.push({
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(options?.body)),
      });
      return Response.json({});
    },
  });
  const method = OrbynClient.prototype.listAiModels;
  await method.call(client, "provider-fixture", "7");
  await method.call(client, "provider-fixture");
  assert.deepEqual(requests, [
    {
      path: "/ai/providers/provider-fixture/models",
      body: { expected_revision: "7" },
    },
    { path: "/ai/providers/provider-fixture/models", body: {} },
  ]);
});

test("endpoint extraction preserves transport error identity and cancellation", async () => {
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    fetch: async (_input, options) => {
      if (options?.signal?.aborted)
        throw new DOMException("aborted", "AbortError");
      return Response.json({ message: "fixture denied" }, { status: 403 });
    },
  });
  await assert.rejects(
    client.getProject("project-fixture"),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.request("/fixture", { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});
