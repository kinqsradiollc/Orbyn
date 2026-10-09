import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db/pool.js";
import { verifyChatgptConnectionRefreshIdentity } from "../src/modules/auth/chatgpt-connections.js";

const binding = { userId: randomUUID(), sessionId: randomUUID() };
const connection = {
  id: randomUUID(),
  issuer: "https://auth.openai.com" as const,
  subject: "owned-subject",
  client_id: "oaiapp_fixture",
};
const input = { connection_id: connection.id, id_token: "identity-proof-only" };
const status = (code: number) => (error: unknown) =>
  (error as { statusCode: number }).statusCode === code;

test("refresh identity verification reads exact owner twice, does not write or relink, and rejects races", async () => {
  let revoked = false,
    disabled = false,
    expired = false,
    changed = false;
  let proofs = 0;
  const queries: string[] = [];
  const query = async (sql: string, args: unknown[] = []) => {
    queries.push(sql);
    assert.ok(!/INSERT|UPDATE|DELETE/.test(sql));
    if (sql.includes("FROM users"))
      return { rows: [{ disabled, email_verified: true }], rowCount: 1 };
    if (sql.includes("FROM sessions"))
      return {
        rows: expired ? [] : [{ id: binding.sessionId }],
        rowCount: expired ? 0 : 1,
      };
    if (sql.includes("FROM chatgpt_identity_connections")) {
      assert.deepEqual(args, [connection.id, binding.userId]);
      assert.match(sql, /revoked_at IS NULL FOR SHARE/);
      return {
        rows: revoked
          ? []
          : [
              {
                ...connection,
                ...(changed ? { subject: "other-subject" } : {}),
              },
            ],
        rowCount: revoked ? 0 : 1,
      };
    }
    return { rows: [], rowCount: 0 };
  };
  mock.method(pool, "connect", async () => ({ query, release() {} }));
  const verifier = async (
    token: string,
    expected: { clientId: string; subject: string },
  ) => {
    proofs++;
    assert.equal(token, input.id_token);
    assert.deepEqual(expected, {
      clientId: connection.client_id,
      subject: connection.subject,
    });
    return {
      issuer: connection.issuer,
      subject: connection.subject,
      clientId: connection.client_id,
    };
  };
  try {
    assert.deepEqual(
      await verifyChatgptConnectionRefreshIdentity(binding, input, verifier),
      connection,
    );
    assert.equal(
      queries.filter((sql) => sql.includes("FROM chatgpt_identity_connections"))
        .length,
      2,
    );
    revoked = true;
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(binding, input, verifier),
      status(404),
    );
    assert.equal(proofs, 1);
    revoked = false;
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(
        binding,
        input,
        async (...args) => {
          revoked = true;
          return verifier(...args);
        },
      ),
      status(404),
    );
    revoked = false;
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(
        binding,
        input,
        async (...args) => {
          disabled = true;
          return verifier(...args);
        },
      ),
      status(403),
    );
    disabled = false;
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(
        binding,
        input,
        async (...args) => {
          expired = true;
          return verifier(...args);
        },
      ),
      status(401),
    );
    expired = false;
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(
        binding,
        input,
        async (...args) => {
          changed = true;
          return verifier(...args);
        },
      ),
      status(409),
    );
    changed = false;
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(binding, input, async () => ({
        issuer: connection.issuer,
        subject: "foreign",
        clientId: connection.client_id,
      })),
      status(400),
    );
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(binding, input, async () => {
        throw new Error("private-token details");
      }),
      (error) => status(400)(error) && !String(error).includes("private-token"),
    );
    await assert.rejects(
      verifyChatgptConnectionRefreshIdentity(
        binding,
        { ...input, access_token: "forbidden" },
        verifier,
      ),
    );
  } finally {
    mock.restoreAll();
  }
});
