import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { chatgptModelBinding } from "@orbyn/core";

const ISSUER = "https://auth.openai.com";
const jwks = createRemoteJWKSet(
  new URL("https://auth.openai.com/.well-known/jwks.json"),
  {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  },
);
export type VerifiedOpenAiIdentity = {
  issuer: typeof ISSUER;
  subject: string;
  clientId: string;
};

/** Fixed-provider verification. Callers must consume a session-bound nonce once. */
export function createOpenAiIdentityVerifier(key: JWTVerifyGetKey = jwks) {
  return async (
    idToken: string,
    expected: { clientId: string; nonce: string },
  ): Promise<VerifiedOpenAiIdentity> => {
    try {
      const clientId = chatgptModelBinding.shape.client_id.parse(
        expected.clientId,
      );
      if (
        typeof idToken !== "string" ||
        !idToken ||
        idToken.length > 65_536 ||
        typeof expected.nonce !== "string" ||
        expected.nonce.length < 16 ||
        expected.nonce.length > 256
      )
        throw new Error("Invalid identity input.");
      const { payload } = await jwtVerify(idToken, key, {
        issuer: ISSUER,
        audience: clientId,
        requiredClaims: ["sub", "exp", "iat", "nonce"],
        clockTolerance: 5,
        maxTokenAge: "10m",
        algorithms: ["RS256", "ES256"],
      });
      if (
        payload.nonce !== expected.nonce ||
        typeof payload.sub !== "string" ||
        !payload.sub ||
        payload.sub.length > 512
      )
        throw new Error("Invalid identity claims.");
      if (
        (payload.azp !== undefined && payload.azp !== clientId) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== clientId)
      )
        throw new Error("Invalid authorized party.");
      return { issuer: ISSUER, subject: payload.sub, clientId };
    } catch {
      // Never expose token contents, claims, JWKS errors or provider details.
      throw new Error("ChatGPT identity could not be verified.");
    }
  };
}
