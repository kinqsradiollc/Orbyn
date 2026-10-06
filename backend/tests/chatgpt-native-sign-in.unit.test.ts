import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import ts from "typescript";
import * as core from "@orbyn/core";
import * as api from "@orbyn/api-client";

const userId = "fbb2cfcc-7052-407f-9ee5-07a0be261382";
const connection = {
  id: "36675278-d840-4d35-86ba-6af604b3b52b",
  issuer: "https://auth.openai.com",
  subject: "fixture-subject",
  client_id: "oaiapp_fixture",
};
const tokens = {
  access_token: "private-access",
  refresh_token: "private-refresh",
  id_token: "identity-proof",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "openid resource.invoke chatgpt.tokens.use.direct offline_access",
};

function mount(
  options: {
    platform?: string;
    available?: boolean;
    scopes?: string;
    callback?: "wrong" | "denied";
    identity?: object;
    changeSession?: "finish" | "store";
    me?: string;
    browserCancel?: boolean;
    revoked?: boolean;
    changeDuringModels?: "session" | "registration";
  } = {},
) {
  const storage = new Map<string, string>();
  const session = { token: "owned-session" };
  const calls = {
    network: 0,
    proof: [] as any[],
    started: 0,
    stopped: 0,
    opened: [] as string[],
    dismissed: 0,
    freshMe: false,
  };
  let state = "",
    redirect = "http://127.0.0.1:1455/auth/callback";
  let dismiss!: (value: object) => void;
  let rejectWait: ((error: Error) => void) | null = null;
  const exports: any = {};
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../../mobile/src/lib/chatgpt-local-sign-in.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  runInNewContext(compiled, {
    exports,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    require(id: string) {
      if (id === "@orbyn/core") return core;
      if (id === "@orbyn/api-client") return api;
      if (id === "zod") return { z };
      if (id === "react-native")
        return { Platform: { OS: options.platform ?? "ios" } };
      if (id === "./session") return { session };
      if (id === "expo-crypto")
        return {
          randomUUID,
          getRandomBytesAsync: async (size: number) => randomBytes(size),
          CryptoDigestAlgorithm: { SHA256: "sha256" },
          CryptoEncoding: { BASE64: "base64" },
          digestStringAsync: async (
            _algorithm: string,
            value: string,
            encoding: any,
          ) =>
            createHash("sha256")
              .update(value)
              .digest(encoding?.encoding ?? "hex"),
        };
      if (id === "expo-secure-store")
        return {
          WHEN_UNLOCKED_THIS_DEVICE_ONLY: "protected-device-only",
          getItemAsync: async (key: string) => storage.get(key) ?? null,
          setItemAsync: async (key: string, value: string, config: any) => {
            assert.equal(config.keychainAccessible, "protected-device-only");
            storage.set(key, value);
            if (options.changeSession === "store" && key.includes(".account."))
              session.token = "other-session";
          },
          deleteItemAsync: async (key: string) => {
            storage.delete(key);
          },
        };
      if (id === "expo/fetch")
        return {
          fetch: async (url: string, init: any) => {
            calls.network++;
            if (url === "https://api.openai.com/v1/models") {
              assert.equal(init.headers.Authorization, "Bearer private-access");
              if (options.changeDuringModels === "session")
                session.token = "other-session";
              if (options.changeDuringModels === "registration") {
                for (const [key, value] of storage)
                  if (key.includes(".account."))
                    storage.set(
                      key,
                      JSON.stringify({
                        ...JSON.parse(value),
                        revision: randomUUID(),
                      }),
                    );
              }
              return Response.json({
                models: [
                  {
                    slug: "native-model",
                    display_name: "Native model",
                    visibility: "list",
                  },
                ],
              });
            }
            assert.equal(
              url,
              "https://auth.openai.com/api/accounts/oauth/token",
            );
            assert.equal(init.body.get("client_id"), "oaiapp_fixture");
            return Response.json({
              ...tokens,
              scope: options.scopes ?? tokens.scope,
            });
          },
        };
      if (id === "expo-web-browser")
        return {
          WebBrowserResultType: { OPENED: "opened" },
          openBrowserAsync: (url: string) => {
            calls.opened.push(url);
            if (options.browserCancel)
              return Promise.resolve({ type: "cancel" });
            return new Promise((resolve) => {
              dismiss = resolve;
            });
          },
          dismissBrowser: () => {
            calls.dismissed++;
            dismiss?.({ type: "dismiss" });
          },
        };
      if (id === "../../modules/orbyn-chatgpt")
        return {
          nativeChatgptCallbackAvailable: () => options.available !== false,
          startNativeChatgptCallback: async (_id: string, value: string) => {
            calls.started++;
            state = value;
            return redirect;
          },
          waitNativeChatgptCallback: async () => {
            if (options.browserCancel)
              return new Promise((_resolve, reject) => {
                rejectWait = reject;
              });
            return (
              redirect +
              "?" +
              new URLSearchParams({
                state: options.callback === "wrong" ? "wrong" : state,
                code: "fixture-code",
                client_id: "oaiapp_fixture",
                ...(options.callback === "denied"
                  ? { error: "access_denied" }
                  : {}),
              })
            );
          },
          cancelNativeChatgptCallback: async () => {
            calls.stopped++;
            rejectWait?.(new Error("cancelled"));
          },
        };
      if (id === "./api")
        return {
          client: {
            baseUrl: "https://orbyn.example/api",
            me: async (settings: any) => {
              calls.freshMe = settings.fresh;
              return { id: options.me ?? userId };
            },
            chatgptConnections: async () =>
              options.revoked ? [] : [connection],
            startChatgptConnection: async () => ({
              id: randomUUID(),
              nonce: "n".repeat(43),
              expires_at: new Date(Date.now() + 600000).toISOString(),
            }),
            finishChatgptConnection: async (proof: any) => {
              calls.proof.push(proof);
              if (options.changeSession === "finish")
                session.token = "other-session";
              return { ...connection, ...options.identity };
            },
          },
        };
      throw new Error("Unexpected module " + id);
    },
  });
  return {
    signIn: (input = userId) => exports.signInNativeChatgpt(input),
    cancel: () => exports.cancelNativeChatgptSignIn(),
    models: (input = userId, signal?: AbortSignal) =>
      exports.readNativeChatgptModels(input, { signal }),
    storage,
    session,
    calls,
  };
}
import { z } from "zod";
const accounts = (storage: Map<string, string>) =>
  [...storage].filter(([key]) => key.includes(".account."));

test("actual native sign-in service authorizes locally, verifies only ID proof remotely and stores protected credentials", async () => {
  const fixture = mount();
  const result = await fixture.signIn();
  assert.equal(result.sharingGranted, true);
  assert.equal(result.connection.id, connection.id);
  assert.equal(fixture.calls.freshMe, true);
  assert.equal(fixture.calls.started, 1);
  assert.equal(fixture.calls.network, 1);
  assert.equal(fixture.calls.proof.length, 1);
  assert.deepEqual(Object.keys(fixture.calls.proof[0]).sort(), [
    "challenge_id",
    "client_id",
    "id_token",
  ]);
  const url = new URL(fixture.calls.opened[0]);
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.get("agent_name_hint"), "Orbyn");
  assert.equal(url.searchParams.get("nonce"), "n".repeat(43));
  assert.equal(accounts(fixture.storage).length, 1);
  assert.equal(
    JSON.parse(accounts(fixture.storage)[0][1]).grant.accessToken,
    "private-access",
  );
  assert.equal("grant" in result, false);
  assert.equal(fixture.calls.dismissed, 1);
  assert.ok(fixture.calls.stopped >= 1);
});
test("native reconnect reuses the issued registration, host and verified identity", async () => {
  const fixture = mount();
  await fixture.signIn();
  await fixture.signIn();
  const first = new URL(fixture.calls.opened[0]),
    second = new URL(fixture.calls.opened[1]);
  assert.equal(second.searchParams.get("client_id"), "oaiapp_fixture");
  assert.equal(
    second.searchParams.get("ext_agent_host_id"),
    first.searchParams.get("ext_agent_host_id"),
  );
  assert.equal(second.searchParams.get("id_token_hint"), "identity-proof");
  assert.equal(second.searchParams.has("agent_name_hint"), false);
});
test("web, missing native build and foreign Orbyn account do not queue a desktop request", async () => {
  for (const options of [
    { platform: "web" },
    { available: false },
    { me: randomUUID() },
  ]) {
    const fixture = mount(options);
    await assert.rejects(fixture.signIn());
    assert.equal(fixture.calls.started, 0);
    assert.equal(fixture.calls.network, 0);
    assert.equal(accounts(fixture.storage).length, 0);
  }
});
test("wrong state and denied callback never exchange credentials", async () => {
  for (const callback of ["wrong", "denied"] as const) {
    const fixture = mount({ callback });
    await assert.rejects(fixture.signIn());
    assert.equal(fixture.calls.network, 0);
    assert.equal(fixture.calls.proof.length, 0);
    assert.equal(accounts(fixture.storage).length, 0);
    assert.ok(fixture.calls.stopped >= 1);
  }
});
test("scope denial and changed verified identity cannot install a provider", async () => {
  for (const options of [
    { scopes: "openid" },
    { identity: { client_id: "oaiapp_other" } },
  ]) {
    const fixture = mount(options);
    await assert.rejects(fixture.signIn());
    assert.equal(accounts(fixture.storage).length, 0);
  }
});
test("session change during remote proof or secure write cannot keep the new credentials", async () => {
  for (const changeSession of ["finish", "store"] as const) {
    const fixture = mount({ changeSession });
    await assert.rejects(fixture.signIn());
    assert.equal(accounts(fixture.storage).length, 0);
  }
});
test("native browser cancellation aborts the exact listener without writing credentials", async () => {
  const fixture = mount({ browserCancel: true });
  await assert.rejects(fixture.signIn());
  assert.equal(fixture.calls.network, 0);
  assert.equal(accounts(fixture.storage).length, 0);
  assert.ok(fixture.calls.stopped >= 1);
});

test("concurrent native sign-in cannot replace the winning attempt", async () => {
  const fixture = mount();
  const first = fixture.signIn();
  await assert.rejects(fixture.signIn());
  await first;
  assert.equal(fixture.calls.started, 1);
  assert.equal(accounts(fixture.storage).length, 1);
});
test("cancelled secure replacement restores the prior account record", async () => {
  const options: { changeSession?: "finish" | "store" } = {};
  const fixture = mount(options);
  await fixture.signIn();
  const original = accounts(fixture.storage)[0][1];
  options.changeSession = "store";
  await assert.rejects(fixture.signIn());
  assert.equal(accounts(fixture.storage)[0][1], original);
});
test("corrupt protected records are preserved and never copied into diagnostic errors", async () => {
  const fixture = mount();
  await fixture.signIn();
  const key = accounts(fixture.storage)[0][0];
  const corrupt = "private-access-malformed-json";
  fixture.storage.set(key, corrupt);
  await assert.rejects(fixture.signIn(), (error: unknown) => {
    const message = String(error);
    return (
      message.includes("saved ChatGPT connection is unavailable") &&
      !message.includes(corrupt)
    );
  });
  assert.equal(fixture.storage.get(key), corrupt);
});

test("native models use only a protected, currently owned and live connection", async () => {
  const fixture = mount();
  await fixture.signIn();
  const result = await fixture.models();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    connection,
    models: [{ slug: "native-model", display_name: "Native model" }],
  });
  assert.equal(JSON.stringify(result).includes("private-access"), false);
});
test("native model discovery rejects revoked server identity before requesting models", async () => {
  const fixture = mount({ revoked: true });
  await fixture.signIn();
  const before = fixture.calls.network;
  await assert.rejects(fixture.models(), /Reconnect/);
  assert.equal(fixture.calls.network, before);
});
test("native models discard late results after session or protected registration changes", async () => {
  for (const changeDuringModels of ["session", "registration"] as const) {
    const fixture = mount({ changeDuringModels });
    await fixture.signIn();
    await assert.rejects(fixture.models(), /changed/);
  }
});
test("native models reject missing registration, wrong owner, cancellation and web runtime", async () => {
  await assert.rejects(mount().models(), /Connect ChatGPT/);
  const fixture = mount();
  await fixture.signIn();
  await assert.rejects(fixture.models(randomUUID()), /account changed/);
  await assert.rejects(fixture.models(userId, AbortSignal.abort()), /changed/);
  await assert.rejects(mount({ platform: "web" }).models(), /native ChatGPT/);
});
