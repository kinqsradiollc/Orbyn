import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { createOpenAiIdentityVerifier } from "../src/modules/auth/openai-identity.js";
import { createOpenAiIdentityVerifier as sharedVerifier } from "@orbyn/api-client/openai-identity";
import { createOpenAiRefreshIdentityVerifier } from "@orbyn/api-client/openai-identity";

test("backend and desktop package entrypoint use the same verifier", () => {
  assert.equal(createOpenAiIdentityVerifier, sharedVerifier);
});

test("shared verifier validates ES256 identity signatures without backend imports", async () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = Math.floor(Date.now() / 1000);
  const proof = await new SignJWT({
    iss: "https://auth.openai.com",
    aud: "oaiapp_ec_fixture",
    sub: "ec-subject",
    iat: now,
    exp: now + 60,
    nonce: "ec-nonce-fixture-0123456789",
  })
    .setProtectedHeader({ alg: "ES256" })
    .sign(keys.privateKey);
  const verifier = sharedVerifier(async () => keys.publicKey);
  assert.deepEqual(
    await verifier(proof, {
      clientId: "oaiapp_ec_fixture",
      nonce: "ec-nonce-fixture-0123456789",
    }),
    {
      issuer: "https://auth.openai.com",
      subject: "ec-subject",
      clientId: "oaiapp_ec_fixture",
    },
  );
  await assert.rejects(
    verifier(proof, {
      clientId: "oaiapp_ec_fixture",
      nonce: "different-nonce-fixture",
    }),
    /could not be verified/,
  );
});

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

test("refresh identity checks the existing account without weakening nonce-bound sign-in", async () => {
  const refreshVerifier = createOpenAiRefreshIdentityVerifier(
    async () => signing.publicKey,
  );
  const refreshed = await token({ nonce: undefined });
  assert.deepEqual(
    await refreshVerifier(refreshed, {
      clientId: expected.clientId,
      subject: "verified-subject",
    }),
    {
      issuer: "https://auth.openai.com",
      subject: "verified-subject",
      clientId: expected.clientId,
    },
  );
  await assert.rejects(verify(refreshed, expected), /could not be verified/);
  await assert.rejects(
    refreshVerifier(refreshed, {
      clientId: expected.clientId,
      subject: "different-subject",
    }),
    /could not be verified/,
  );
});

test("refresh identity rejects wrong signatures, issuer, audience, expiry, age and authorized party", async () => {
  const refreshVerifier = createOpenAiRefreshIdentityVerifier(
    async () => signing.publicKey,
  );
  const account = { clientId: expected.clientId, subject: "verified-subject" };
  for (const over of [
    { iss: "https://fixture.invalid" },
    { aud: "wrong-client" },
    { sub: "wrong-account" },
    { exp: Math.floor(Date.now() / 1000) - 30 },
    { exp: undefined },
    { iat: undefined },
    { iat: Math.floor(Date.now() / 1000) + 60 },
    { iat: Math.floor(Date.now() / 1000) - 900 },
    { azp: "wrong-client" },
    { aud: [expected.clientId, "another-client"] },
  ])
    await assert.rejects(
      refreshVerifier(await token(over), account),
      /could not be verified/,
    );
  await assert.rejects(
    refreshVerifier(await token({}, stranger.privateKey), account),
    /could not be verified/,
  );
  await assert.rejects(
    refreshVerifier("private-fixture-token", account),
    (e: Error) =>
      e.message === "The refreshed ChatGPT identity could not be verified.",
  );
});
