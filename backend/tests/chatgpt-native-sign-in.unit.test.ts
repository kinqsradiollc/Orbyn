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
    changeSession?: "finish" | "store" | "delete";
    me?: string;
    browserCancel?: boolean;
    revoked?: boolean;
    revokeFailure?: boolean;
    holdCallback?: boolean;
    onRevoke?: () => Promise<void>;
    refreshedId?: boolean;
    refreshIdentity?: object;
    failRefreshProof?: boolean;
    onRefresh?: () => Promise<void>;
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
    revoked: [] as string[],
    refreshed: 0,
    refreshProof: [] as object[],
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
            if (options.changeSession === "delete")
              session.token = "other-session";
          },
        };
      if (id === "expo/fetch")
        return {
          fetch: async (url: string, init: any) => {
            calls.network++;
            if (url === "https://api.openai.com/v1/models") {
              assert.equal(
                init.headers.Authorization,
                calls.refreshed
                  ? "Bearer refreshed-access"
                  : "Bearer private-access",
              );
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
            if (init.body.get("grant_type") === "refresh_token") {
              calls.refreshed++;
              await options.onRefresh?.();
              return Response.json({
                ...tokens,
                access_token: "refreshed-access",
                refresh_token: "refreshed-refresh",
                id_token: options.refreshedId
                  ? "refreshed-identity"
                  : tokens.id_token,
                scope: options.scopes ?? tokens.scope,
              });
            }
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
            if (options.browserCancel || options.holdCallback)
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
            verifyChatgptRefreshIdentity: async (input: object) => {
              calls.refreshProof.push(input);
              if (options.failRefreshProof)
                throw new Error("Invalid identity proof");
              return { ...connection, ...options.refreshIdentity };
            },
            revokeChatgptConnection: async (id: string) => {
              calls.revoked.push(id);
              assert.equal(accounts(storage).length, 0);
              if (options.revokeFailure)
                throw new Error("private-refresh provider outage");
              await options.onRevoke?.();
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
    disconnect: (input = userId) => exports.disconnectNativeChatgpt(input),
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

test("native disconnect erases protected credentials before revoking exact server identity", async () => {
  const fixture = mount();
  await fixture.signIn();
  await fixture.disconnect();
  assert.equal(accounts(fixture.storage).length, 0);
  assert.deepEqual(fixture.calls.revoked, [connection.id]);
  assert.equal(
    [...fixture.storage.keys()].some((key) => key.includes(".host.")),
    true,
  );
  await assert.rejects(fixture.models(), /Connect ChatGPT/);
  await fixture.disconnect();
  assert.equal(fixture.calls.revoked.length, 1);
});
test("native disconnect cannot retain tokens when server revocation fails", async () => {
  const fixture = mount({ revokeFailure: true });
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(), (error: unknown) => {
    assert.match(String(error), /removed from this device/);
    assert.doesNotMatch(String(error), /private-refresh/);
    return true;
  });
  assert.equal(accounts(fixture.storage).length, 0);
});
test("corrupted native registrations can be erased without guessing a server connection", async () => {
  const fixture = mount();
  await fixture.signIn();
  const [key] = accounts(fixture.storage)[0];
  fixture.storage.set(key, "private-access invalid record");
  await fixture.disconnect();
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.revoked.length, 0);
});
test("disconnect rejects a foreign Orbyn owner and web without deleting credentials", async () => {
  const fixture = mount();
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(randomUUID()), /account changed/);
  assert.equal(accounts(fixture.storage).length, 1);
  assert.equal(fixture.calls.revoked.length, 0);
  await assert.rejects(
    mount({ platform: "web" }).disconnect(),
    /native ChatGPT/,
  );
});
test("disconnect serializes against sign-in and another disconnect", async () => {
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = mount({
    onRevoke: async () => {
      entered();
      await blocked;
    },
  });
  await fixture.signIn();
  const disconnect = fixture.disconnect();
  await reached;
  await assert.rejects(fixture.signIn(), /current ChatGPT action/);
  await assert.rejects(fixture.disconnect(), /already in progress/);
  await assert.rejects(fixture.models(), /changed/);
  release();
  await disconnect;
  await fixture.signIn();
  assert.equal(accounts(fixture.storage).length, 1);
});
test("disconnect cancels and awaits an active callback before reading local credentials", async () => {
  const fixture = mount({ holdCallback: true });
  const signIn = fixture.signIn();
  const rejected = assert.rejects(signIn);
  // Wait for the actual source service's listener to start, not an arbitrary delay.
  for (let index = 0; index < 100 && fixture.calls.started === 0; index++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(fixture.calls.started, 1);
  await fixture.disconnect();
  await rejected;
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.revoked.length, 0);
});

test("session change during local removal prevents revoking through another session", async () => {
  const fixture = mount({ changeSession: "delete" });
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(), /account changed/);
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.revoked.length, 0);
});

function expireSoon(fixture: ReturnType<typeof mount>) {
  const [key, json] = accounts(fixture.storage)[0];
  const saved = JSON.parse(json);
  saved.grant.expiresAt = Date.now() + 1000;
  fixture.storage.set(key, JSON.stringify(saved));
  return fixture.storage.get(key);
}
test("native near-expiry model discovery rotates local tokens after verifying changed identity", async () => {
  const fixture = mount({ refreshedId: true });
  await fixture.signIn();
  expireSoon(fixture);
  await fixture.models();
  assert.equal(fixture.calls.refreshed, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls.refreshProof)), [
    { connection_id: connection.id, id_token: "refreshed-identity" },
  ]);
  const saved = JSON.parse(accounts(fixture.storage)[0][1]);
  assert.equal(saved.grant.accessToken, "refreshed-access");
  assert.equal(saved.grant.refreshToken, "refreshed-refresh");
  await fixture.models();
  assert.equal(fixture.calls.refreshed, 1);
});
test("unchanged refresh identity needs no new sign-in proof but retains the original account", async () => {
  const fixture = mount();
  await fixture.signIn();
  expireSoon(fixture);
  await fixture.models();
  assert.equal(fixture.calls.refreshProof.length, 0);
  assert.equal(fixture.calls.refreshed, 1);
  assert.deepEqual(
    JSON.parse(accounts(fixture.storage)[0][1]).connection,
    connection,
  );
});
test("altered or unverified refreshed identity never rotates protected credentials", async () => {
  for (const options of [
    { refreshedId: true, refreshIdentity: { subject: "foreign-subject" } },
    { refreshedId: true, failRefreshProof: true },
  ]) {
    const fixture = mount(options);
    await fixture.signIn();
    const original = expireSoon(fixture);
    await assert.rejects(fixture.models());
    assert.equal(accounts(fixture.storage)[0][1], original);
  }
});
test("refresh scope reduction persists rotated tokens but cannot request a model catalog", async () => {
  const options: { scopes?: string } = {};
  const fixture = mount(options);
  await fixture.signIn();
  expireSoon(fixture);
  options.scopes = "openid offline_access";
  const before = fixture.calls.network;
  await assert.rejects(fixture.models());
  assert.equal(fixture.calls.network, before + 1);
  const saved = JSON.parse(accounts(fixture.storage)[0][1]);
  assert.equal(saved.grant.sharingGranted, false);
  assert.equal(saved.grant.refreshToken, "refreshed-refresh");
});

test("disconnect aborts pending refresh and cannot reinstall credentials afterward", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = mount({
    onRefresh: async () => {
      entered();
      await pending;
    },
  });
  await fixture.signIn();
  expireSoon(fixture);
  const models = fixture.models();
  const rejected = assert.rejects(models);
  await started;
  await fixture.disconnect();
  await rejected;
  release();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.refreshProof.length, 0);
});
test("session changes during refreshed secure write restore only the prior registration", async () => {
  const options: { changeSession?: "finish" | "store" } = {};
  const fixture = mount(options);
  await fixture.signIn();
  const original = expireSoon(fixture);
  options.changeSession = "store";
  await assert.rejects(fixture.models(), /changed/);
  assert.equal(accounts(fixture.storage)[0][1], original);
});
