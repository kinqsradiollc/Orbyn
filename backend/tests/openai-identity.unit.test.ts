import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { createOpenAiIdentityVerifier } from "../src/modules/auth/openai-identity.js";

const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const expected = {
  clientId: "oaiapp_identity_fixture",
  nonce: "nonce-fixture-0123456789",
};
const verify = createOpenAiIdentityVerifier(async () => signing.publicKey);
async function token(
  over: Record<string, unknown> = {},
  privateKey = signing.privateKey,
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: "https://auth.openai.com",
    aud: expected.clientId,
    sub: "verified-subject",
    iat: now,
    exp: now + 60,
    nonce: expected.nonce,
    email: "matching-email@example.com",
    ...over,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .sign(privateKey);
}
test("verified identity returns only issuer, subject and issued registration", async () => {
  assert.deepEqual(await verify(await token(), expected), {
    issuer: "https://auth.openai.com",
    subject: "verified-subject",
    clientId: expected.clientId,
  });
});
test("signature, issuer, audience, expiry, nonce and missing required claims reject", async () => {
  for (const over of [
    { iss: "https://fixture.invalid" },
    { aud: "another-client" },
    { exp: Math.floor(Date.now() / 1000) - 30 },
    { nonce: "another-nonce" },
    { sub: "" },
    { sub: undefined },
    { iat: undefined },
    { iat: Math.floor(Date.now() / 1000) + 60 },
    { iat: Math.floor(Date.now() / 1000) - 900 },
    { exp: undefined },
    { nonce: undefined },
  ])
    await assert.rejects(
      verify(await token(over), expected),
      /could not be verified/,
    );
  await assert.rejects(
    verify(await token({}, stranger.privateKey), expected),
    /could not be verified/,
  );
});
test("multiple audiences require the matching authorized party", async () => {
  await assert.rejects(
    verify(
      await token({ aud: [expected.clientId, "another-client"] }),
      expected,
    ),
  );
  await assert.rejects(
    verify(await token({ azp: "another-client" }), expected),
  );
  assert.equal(
    (
      await verify(
        await token({
          aud: [expected.clientId, "another-client"],
          azp: expected.clientId,
        }),
        expected,
      )
    ).subject,
    "verified-subject",
  );
});
test("registration placeholders and oversized or malformed tokens never echo private input", async () => {
  for (const raw of ["secret-fixture-token", "x".repeat(65_537)])
    await assert.rejects(
      verify(raw, expected),
      (error: Error) =>
        error.message === "ChatGPT identity could not be verified.",
    );
  await assert.rejects(
    verify(await token(), { ...expected, clientId: "dynamic_agent_client" }),
  );
});
