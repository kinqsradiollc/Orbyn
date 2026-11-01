import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import Fastify from "fastify";
import { serializeFileRequest } from "../src/lib/file-request-log.js";

test("scoped publication capability tokens never enter request URL logs", () => {
  for (const prefix of ["", "/api"])
    for (const suffix of [
      "/secret-token",
      "/secret-token/media/file?x=secret-token",
      "%2fsecret-token",
    ])
      assert.equal(
        serializeFileRequest({ url: `${prefix}/s${suffix}` }).url,
        `${prefix}/s/:token`,
      );
});

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

test("Teams OAuth codes and state never enter request URL serialization", () => {
  for (const prefix of ["", "/api"]) {
    const path = `${prefix}/agent-channels/teams/callback`;
    assert.equal(
      serializeFileRequest({
        url: `${path}?code=private-teams-code&state=private-teams-state`,
      }).url,
      path,
    );
    assert.equal(
      serializeFileRequest({
        url: `${path}/?error=private-error&state=private-state`,
      }).url,
      `${path}/`,
    );
  }
});

test("private booking, invite and RSVP capabilities never enter URL logs", () => {
  for (const prefix of ["", "/api"])
    for (const path of [
      "/book/confirm",
      "/book/cancel",
      "/book/manage",
      "/invite",
      "/rsvp",
    ])
      for (const suffix of [
        "/synthetic-private-capability",
        "/synthetic-private-capability/slots?extra=synthetic-private-capability",
        "%2Fsynthetic-private-capability",
      ])
        assert.equal(
          serializeFileRequest({ url: `${prefix}${path}${suffix}` }).url,
          `${prefix}${path}/:token`,
        );
  for (const url of [
    "/book/sprint-review?timezone=UTC",
    "/api/bookings/booking-id/approve",
    "/api/open-invites/invite-id",
    "/rsvps/summary",
  ])
    assert.equal(serializeFileRequest({ url }).url, url);
});

test("Fastify's actual booking request logs omit private link and query tokens", async () => {
  const stream = new PassThrough();
  let output = "";
  stream.on("data", (value) => {
    output += value.toString();
  });
  const app = Fastify({
    logger: { stream, serializers: { req: serializeFileRequest } },
  });
  app.post("/book/confirm/:token", async (_r, reply) =>
    reply.code(403).send({ message: "Invalid link" }),
  );
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/book/confirm/synthetic-private-booking-capability?extra=synthetic-private-booking-capability",
        })
      ).statusCode,
      403,
    );
    assert.match(output, /\/book\/confirm\/:token/);
    assert.doesNotMatch(output, /synthetic-private-booking-capability|extra=/);
  } finally {
    await app.close();
    stream.destroy();
  }
});
