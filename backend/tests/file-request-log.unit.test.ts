import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import Fastify from "fastify";
import { serializeFileRequest } from "../src/lib/file-request-log.js";

test("Slack OAuth codes and state never enter the request URL serializer", () => {
  for (const prefix of ["", "/api"]) {
    const path = `${prefix}/agent-channels/slack/callback`;
    assert.equal(
      serializeFileRequest({
        url: `${path}?code=synthetic-private-code&state=synthetic-private-state`,
      }).url,
      path,
    );
    assert.equal(
      serializeFileRequest({
        url: `${path}?error=access_denied&state=synthetic-private-state`,
      }).url,
      path,
    );
  }
});

test("signed file paths and query tails are redacted while ordinary routes retain their fields", () => {
  for (const kind of ["u", "p", "r"]) {
    assert.equal(
      serializeFileRequest({
        url: `/files/${kind}/payload.signature?download=1`,
      }).url,
      `/files/${kind}/:token`,
    );
    assert.equal(
      serializeFileRequest({ url: `/files/${kind}%2fpayload.signature` }).url,
      `/files/${kind}/:token`,
    );
  }
  assert.deepEqual(
    serializeFileRequest({
      method: "GET",
      url: "/docs/page/export?format=pdf",
      headers: { "accept-version": "1" },
      host: "test",
      ip: "local",
      socket: { remotePort: 123 },
    }),
    {
      method: "GET",
      url: "/docs/page/export?format=pdf",
      version: "1",
      host: "test",
      remoteAddress: "local",
      remotePort: 123,
    },
  );
});

test("Fastify's actual request logs omit signed file tokens and token query values", async () => {
  const stream = new PassThrough();
  let output = "";
  stream.on("data", (value) => {
    output += value.toString();
  });
  const app = Fastify({
    logger: { stream, serializers: { req: serializeFileRequest } },
  });
  app.get("/files/r/:token", async (_r, reply) =>
    reply.code(403).send({ message: "Invalid link" }),
  );
  try {
    assert.equal(
      (
        await app.inject({
          url: "/files/r/private-capability.signature?extra=private-capability.signature",
        })
      ).statusCode,
      403,
    );
    assert.match(output, /\/files\/r\/:token/);
    assert.doesNotMatch(output, /private-capability|signature|extra=/);
  } finally {
    await app.close();
    stream.destroy();
  }
});

test("signed Slack interaction and event callback queries never enter request logs", () => {
  for (const prefix of ["", "/api"])
    for (const kind of ["interactions", "events"]) {
      const path = `${prefix}/agent-channels/slack/${kind}`;
      assert.equal(
        serializeFileRequest({
          url: `${path}?answer=private-text`,
          headers: { "x-slack-signature": "private-signature" },
        }).url,
        path,
      );
    }
});
