import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatgptLocalAuthorizationUrl,
  parseChatgptLocalCallback,
  chatgptLoopbackUri,
} from "@orbyn/core";

const attempt = {
  redirectUri: "http://127.0.0.1:1455/auth/callback",
  state: "s".repeat(43),
  nonce: "n".repeat(43),
  challenge: "c".repeat(43),
  hostId: "urn:uuid:fixture-host",
};
const callback = (extra: Record<string, string> = {}) => {
  const uri = new URL(attempt.redirectUri);
  uri.search = new URLSearchParams({
    state: attempt.state,
    code: "fixture-code",
    client_id: "oaiapp_fixture",
    ...extra,
  }).toString();
  return uri.href;
};
test("local first registration needs no pre-issued client, secret or API key", () => {
  const uri = new URL(chatgptLocalAuthorizationUrl(attempt));
  assert.equal(uri.origin, "https://auth.openai.com");
  assert.equal(uri.pathname, "/api/accounts/authorize");
  assert.equal(uri.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(uri.searchParams.get("agent_name_hint"), "Orbyn");
  assert.equal(uri.searchParams.get("redirect_uri"), attempt.redirectUri);
  assert.equal(uri.searchParams.get("ext_agent_host_id"), attempt.hostId);
  assert.equal(uri.searchParams.get("resource"), "https://api.openai.com/v1");
  assert.equal(uri.searchParams.get("code_challenge_method"), "S256");
  assert.ok(
    uri.searchParams.get("scope")!.includes("chatgpt.tokens.use.direct"),
  );
  assert.equal(uri.searchParams.has("client_secret"), false);
});
test("reauthorization preserves issued registration and never creates a new identity", () => {
  const uri = new URL(
    chatgptLocalAuthorizationUrl({
      ...attempt,
      clientId: "oaiapp_fixture",
      idTokenHint: "fixture-hint",
    }),
  );
  assert.equal(uri.searchParams.get("client_id"), "oaiapp_fixture");
  assert.equal(uri.searchParams.get("id_token_hint"), "fixture-hint");
  assert.equal(uri.searchParams.has("agent_name_hint"), false);
  assert.throws(() =>
    chatgptLocalAuthorizationUrl({ ...attempt, idTokenHint: "unbound-hint" }),
  );
});
test("callback must remain a real loopback listener and exact path", () => {
  for (const uri of [
    "http://localhost:1455/auth/callback",
    "https://127.0.0.1:1455/auth/callback",
    "orbyn://chatgpt",
    "https://orbyn.dev/auth/callback",
    "http://127.0.0.1:1455/callback",
    attempt.redirectUri + "?code=x",
    attempt.redirectUri + "#x",
    "http://user@127.0.0.1:1455/auth/callback",
  ])
    assert.throws(() => chatgptLoopbackUri(uri));
});
test("first callback retains the returned issued client ID; callback scopes do not prove a plan grant", () => {
  assert.deepEqual(
    parseChatgptLocalCallback(
      callback({ scope: "chatgpt.tokens.use.direct" }),
      attempt,
    ),
    { code: "fixture-code", clientId: "oaiapp_fixture" },
  );
  for (const client_id of ["", "dynamic_agent_client", "bad client"])
    assert.throws(() =>
      parseChatgptLocalCallback(callback({ client_id }), attempt),
    );
  const uri = new URL(callback());
  uri.searchParams.delete("client_id");
  assert.throws(() => parseChatgptLocalCallback(uri.href, attempt));
});
test("returning callback may omit client ID but cannot replace the saved registration", () => {
  const uri = new URL(callback());
  uri.searchParams.delete("client_id");
  assert.deepEqual(
    parseChatgptLocalCallback(uri.href, {
      ...attempt,
      clientId: "oaiapp_fixture",
    }),
    { code: "fixture-code", clientId: "oaiapp_fixture" },
  );
  assert.throws(() =>
    parseChatgptLocalCallback(callback({ client_id: "oaiapp_other" }), {
      ...attempt,
      clientId: "oaiapp_fixture",
    }),
  );
});
test("foreign state/origin/port/path, duplicate parameters and provider errors never yield a code", () => {
  for (const uri of [
    callback({ state: "wrong" }),
    callback({ error: "access_denied" }),
    callback().replace(":1455", ":1456"),
    callback().replace("127.0.0.1", "localhost"),
    callback().replace("/auth/callback", "/callback"),
    callback() + "&state=" + attempt.state,
    callback() + "&code=second",
    callback() + "#fragment",
  ])
    assert.throws(() => parseChatgptLocalCallback(uri, attempt));
});
test("malformed and oversized codes and attempts are rejected", () => {
  for (const code of ["", "white space", "x\nsecret", "x".repeat(4097)])
    assert.throws(() => parseChatgptLocalCallback(callback({ code }), attempt));
  for (const property of ["state", "nonce", "challenge"])
    assert.throws(() =>
      chatgptLocalAuthorizationUrl({ ...attempt, [property]: "bad" }),
    );
});
