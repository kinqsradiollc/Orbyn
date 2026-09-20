import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";

// Passkeys (WebAuthn). The relying-party id is the app's domain and the
// expected origin is APP_URL, so this only works once APP_URL is the address
// people actually open. Password sign-in is untouched — passkeys are extra.

const rpID = (() => {
  try {
    return new URL(env.APP_URL).hostname;
  } catch {
    return "localhost";
  }
})();
const origin = env.APP_URL.replace(/\/$/, "");
const RP_NAME = "Orbyn";

export type StoredCredential = {
  id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
};

async function credentialsOf(userId: string): Promise<StoredCredential[]> {
  return (
    await pool.query<StoredCredential>(
      "SELECT id, public_key, counter, transports FROM webauthn_credentials WHERE user_id = $1",
      [userId],
    )
  ).rows;
}

async function saveChallenge(
  handle: string,
  userId: string | null,
  challenge: string,
) {
  await pool.query(
    `INSERT INTO webauthn_challenges (handle, user_id, challenge)
       VALUES ($1, $2, $3)
       ON CONFLICT (handle) DO UPDATE SET challenge = $3, user_id = $2,
         expires_at = now() + interval '5 minutes'`,
    [handle, userId, challenge],
  );
}
async function takeChallenge(handle: string) {
  return (
    await pool.query<{ user_id: string | null; challenge: string }>(
      "DELETE FROM webauthn_challenges WHERE handle = $1 AND expires_at > now() RETURNING user_id, challenge",
      [handle],
    )
  ).rows[0];
}

/** Options to add a passkey to the signed-in account. */
export async function registrationOptions(userId: string, email: string) {
  const existing = await credentialsOf(userId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(userId),
    userName: email,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports as never,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  await saveChallenge(userId, userId, options.challenge);
  return options;
}

/** Verify a new passkey and store it. Returns true on success. */
export async function verifyRegistration(
  userId: string,
  response: Parameters<typeof verifyRegistrationResponse>[0]["response"],
  name: string,
): Promise<boolean> {
  const claim = await takeChallenge(userId);
  if (!claim || claim.user_id !== userId) return false;
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: claim.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    // A malformed or mismatched attestation throws; treat it as "not verified".
    return false;
  }
  if (!result.verified || !result.registrationInfo) return false;
  const c = result.registrationInfo.credential;
  await pool.query(
    `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
    [
      c.id,
      userId,
      Buffer.from(c.publicKey),
      String(c.counter),
      c.transports ?? [],
      name.slice(0, 60) || "Passkey",
    ],
  );
  return true;
}

/** Options to sign in with a passkey; `handle` is returned to send back. */
export async function authenticationOptions(email?: string) {
  let allow: { id: string; transports: string[] }[] = [];
  if (email) {
    const row = (
      await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email.trim().toLowerCase()],
      )
    ).rows[0];
    if (row)
      allow = (await credentialsOf(row.id)).map((c) => ({
        id: c.id,
        transports: c.transports,
      }));
  }
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: allow.map((c) => ({
      id: c.id,
      transports: c.transports as never,
    })),
  });
  const handle = randomBytes(18).toString("base64url");
  await saveChallenge(handle, null, options.challenge);
  return { handle, options };
}

/** Verify a sign-in assertion; returns the user id on success, else null. */
export async function verifyAuthentication(
  handle: string,
  response: Parameters<typeof verifyAuthenticationResponse>[0]["response"],
): Promise<string | null> {
  const claim = await takeChallenge(handle);
  if (!claim) return null;
  const cred = (
    await pool.query<StoredCredential & { user_id: string }>(
      "SELECT id, user_id, public_key, counter, transports FROM webauthn_credentials WHERE id = $1",
      [response.id],
    )
  ).rows[0];
  if (!cred) return null;
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: claim.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.public_key),
        counter: Number(cred.counter),
        transports: cred.transports as never,
      },
    });
  } catch {
    return null;
  }
  if (!result.verified) return null;
  await pool.query(
    "UPDATE webauthn_credentials SET counter = $2, last_used_at = now() WHERE id = $1",
    [cred.id, String(result.authenticationInfo.newCounter)],
  );
  return cred.user_id;
}

/** The signed-in user's passkeys, for the settings list. */
export async function listPasskeys(userId: string) {
  return (
    await pool.query<{
      id: string;
      name: string;
      created_at: Date;
      last_used_at: Date | null;
    }>(
      "SELECT id, name, created_at, last_used_at FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at",
      [userId],
    )
  ).rows.map((c) => ({
    id: c.id,
    name: c.name,
    created_at: c.created_at.toISOString(),
    last_used_at: c.last_used_at?.toISOString() ?? null,
  }));
}
